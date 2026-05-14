import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRole } from "@/lib/use-role";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtMoney, fmtDateTime } from "@/lib/utils-money";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calculator, TrendingUp, TrendingDown, Save, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/profit-calculator")({
  validateSearch: (s: Record<string, unknown>) => ({ po: typeof s.po === "string" ? s.po : undefined }),
  component: () => (
    <AppShell>
      <ProfitCalculatorPage />
    </AppShell>
  ),
});

type PO = {
  id: string;
  po_number: string;
  supplier_name: string | null;
  status: string;
  total_usd: number;
  total_qty: number;
  total_egp: number | null;
  usd_rate: number | null;
  customs_mode: string | null; customs_value: number | null;
  taxes_mode: string | null; taxes_value: number | null;
  shipping_mode: string | null; shipping_value: number | null;
  other_mode: string | null; other_value: number | null;
  created_at: string;
  cfo_priced_at: string | null;
};

type POItem = {
  id: string;
  product_id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  image_url: string | null;
  quantity: number;
  unit_cost_usd: number;
  line_total_usd: number;
};

type Mode = "percent" | "fixed";

type Scenario = {
  id?: string;
  po_id: string;
  user_id: string;
  discount_mode: Mode;
  discount_value: number;
  selling_overrides: Record<string, { unit_sell_price?: number }>;
  notes: string | null;
};

function ProfitCalculatorPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const { isAdmin, isCFO, loading: roleLoading } = useRole();
  const navigate = useNavigate();
  const isAr = lang === "ar";

  const search_ = Route.useSearch();
  const [pos, setPos] = useState<PO[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(search_.po ?? null);

  useEffect(() => {
    if (search_.po && search_.po !== selectedId) setSelectedId(search_.po);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search_.po]);

  // Access guard
  useEffect(() => {
    if (!roleLoading && !isAdmin && !isCFO) {
      toast.error(isAr ? "غير مصرح" : "Not authorized");
      navigate({ to: "/dashboard" });
    }
  }, [roleLoading, isAdmin, isCFO, navigate, isAr]);

  const loadPOs = async () => {
    const { data } = await supabase
      .from("purchase_orders")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(300);
    setPos((data as any) ?? []);
  };

  useEffect(() => { loadPOs(); }, []);
  useRealtimeTable("purchase_orders", loadPOs, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pos;
    return pos.filter((p) =>
      p.po_number.toLowerCase().includes(q) ||
      (p.supplier_name ?? "").toLowerCase().includes(q)
    );
  }, [pos, search]);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-500/10 via-primary/5 to-transparent p-5">
        <div className="absolute -end-12 -top-12 h-44 w-44 rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="relative">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/15 text-emerald-700 shadow-sm">
              <Calculator className="h-5 w-5" />
            </span>
            {isAr ? "حاسبة الربح" : "Profit Calculator"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {isAr
              ? "اختر أمر شراء، جرّب نسبة/قيمة خصم نهائية وأسعار البيع، وشوف صافي الربح فوراً. تحديثات أمر الشراء تظهر لحظياً."
              : "Pick a PO, try a final discount and selling prices, and see the net profit instantly. PO updates sync live."}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* PO list */}
        <Card className="overflow-hidden">
          <div className="border-b bg-muted/40 px-3 py-2">
            <div className="relative">
              <Search className="absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isAr ? "ابحث عن أمر شراء…" : "Search PO…"}
                className="h-8 ps-7 text-xs"
              />
            </div>
          </div>
          <div className="max-h-[70vh] divide-y overflow-y-auto">
            {filtered.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground">
                {isAr ? "لا توجد أوامر شراء" : "No purchase orders"}
              </div>
            )}
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`block w-full p-3 text-start text-xs transition hover:bg-accent/40 ${
                  selectedId === p.id ? "bg-emerald-500/10" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold">{p.po_number}</span>
                  {p.cfo_priced_at && (
                    <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-[9px]">
                      {isAr ? "مسعّر" : "Priced"}
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {p.supplier_name || (isAr ? "بدون مورد" : "No supplier")}
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">${(Number(p.total_usd) || 0).toFixed(0)} · {p.total_qty}u</span>
                  {p.total_egp != null && (
                    <span className="font-semibold tabular-nums text-primary">
                      {fmtMoney(Number(p.total_egp), "EGP", lang)}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </Card>

        {/* Detail */}
        <div>
          {selectedId ? (
            <ScenarioPanel poId={selectedId} userId={user?.id || ""} userEmail={user?.email || ""} lang={lang} />
          ) : (
            <Card className="grid place-items-center p-12 text-center text-sm text-muted-foreground">
              <div>
                <Sparkles className="mx-auto mb-2 h-8 w-8 text-emerald-500/60" />
                {isAr ? "اختر أمر شراء من القائمة لبدء حساب الربح" : "Pick a PO from the list to start"}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── Scenario panel ─────────────────────── */

function ScenarioPanel({
  poId, userId, userEmail, lang,
}: {
  poId: string; userId: string; userEmail: string; lang: "ar" | "en";
}) {
  const isAr = lang === "ar";
  const [po, setPo] = useState<PO | null>(null);
  const [items, setItems] = useState<POItem[]>([]);
  const [productPrices, setProductPrices] = useState<Record<string, number>>({});
  const [productCostUsd, setProductCostUsd] = useState<Record<string, number>>({});
  const [usdSource, setUsdSource] = useState<"po" | "current">("current");
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [discountMode, setDiscountMode] = useState<Mode>("percent");
  const [discountValue, setDiscountValue] = useState<string>("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: poData }, { data: itemsData }, { data: scData }] = await Promise.all([
      supabase.from("purchase_orders").select("*").eq("id", poId).maybeSingle(),
      supabase.from("purchase_order_items").select("*").eq("po_id", poId).order("created_at"),
      (supabase.from as any)("po_profit_scenarios").select("*").eq("po_id", poId).maybeSingle(),
    ]);
    setPo((poData as any) ?? null);
    const its = (itemsData as any as POItem[]) ?? [];
    setItems(its);

    // Fetch latest selling + cost prices
    const ids = its.map((i) => i.product_id).filter(Boolean);
    if (ids.length > 0) {
      const { data: prods } = await supabase.from("products").select("id,price,cost_price_usd").in("id", ids);
      const priceMap: Record<string, number> = {};
      const costMap: Record<string, number> = {};
      (prods ?? []).forEach((p: any) => {
        priceMap[p.id] = Number(p.price) || 0;
        costMap[p.id] = Number(p.cost_price_usd) || 0;
      });
      setProductPrices(priceMap);
      setProductCostUsd(costMap);
    } else {
      setProductPrices({});
      setProductCostUsd({});
    }

    if (scData) {
      const sc = scData as any as Scenario;
      setScenario(sc);
      setDiscountMode((sc.discount_mode as Mode) || "percent");
      setDiscountValue(sc.discount_value ? String(sc.discount_value) : "");
      const ovStr: Record<string, string> = {};
      Object.entries(sc.selling_overrides || {}).forEach(([k, v]) => {
        if (v?.unit_sell_price != null) ovStr[k] = String(v.unit_sell_price);
      });
      setOverrides(ovStr);
      setNotes(sc.notes || "");
    } else {
      setScenario(null);
      setDiscountMode("percent");
      setDiscountValue("");
      setOverrides({});
      setNotes("");
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [poId]);
  useRealtimeTable("purchase_orders", () => { load(); }, [poId]);
  useRealtimeTable("purchase_order_items", () => { load(); }, [poId]);
  useRealtimeTable("po_profit_scenarios", () => { load(); }, [poId]);
  useRealtimeTable("products", () => { load(); }, [poId]);

  // Calculations
  const totalEgp = Number(po?.total_egp) || 0;
  const totalQty = po?.total_qty || 0;
  const costPerUnitEgp = totalQty > 0 ? totalEgp / totalQty : 0;

  // Effective USD per line based on source toggle
  const effItems = items.map((it) => {
    const poUnitUsd = Number(it.unit_cost_usd) || 0;
    const currentUnitUsd = productCostUsd[it.product_id] ?? poUnitUsd;
    const usedUnitUsd = usdSource === "current" ? currentUnitUsd : poUnitUsd;
    const usedLineUsd = usedUnitUsd * (Number(it.quantity) || 0);
    return { it, poUnitUsd, currentUnitUsd, usedUnitUsd, usedLineUsd };
  });
  const sumUsedUsd = effItems.reduce((s, e) => s + e.usedLineUsd, 0);

  const itemCalc = effItems.map(({ it, poUnitUsd, currentUnitUsd, usedUnitUsd, usedLineUsd }) => {
    const lineCostEgp = sumUsedUsd > 0 ? totalEgp * (usedLineUsd / sumUsedUsd) : 0;
    const unitCostEgp = it.quantity > 0 ? lineCostEgp / it.quantity : 0;
    const overrideStr = overrides[it.id];
    const sellPrice = overrideStr !== undefined && overrideStr !== ""
      ? Number(overrideStr) || 0
      : (productPrices[it.product_id] ?? 0);
    const lineSell = sellPrice * it.quantity;
    const lineProfit = lineSell - lineCostEgp;
    return { it, poUnitUsd, currentUnitUsd, usedUnitUsd, unitCostEgp, lineCostEgp, sellPrice, lineSell, lineProfit };
  });

  const totalSell = itemCalc.reduce((s, x) => s + x.lineSell, 0);

  // Discount applies to EXPECTED SALES, not to PO cost.
  const dInput = Math.max(0, Number(discountValue) || 0);
  const dVal = discountMode === "percent" ? Math.min(100, dInput) : dInput;
  const discountEgp = discountMode === "percent"
    ? (totalSell * dVal) / 100
    : Math.min(totalSell, dVal);
  const salesAfterDiscount = Math.max(0, totalSell - discountEgp);
  const totalProfit = salesAfterDiscount - totalEgp;
  const margin = salesAfterDiscount > 0 ? (totalProfit / salesAfterDiscount) * 100 : 0;

  const save = async () => {
    if (!po) return;
    setSaving(true);
    try {
      const ovObj: Record<string, { unit_sell_price: number }> = {};
      Object.entries(overrides).forEach(([k, v]) => {
        if (v !== "" && Number(v) >= 0) ovObj[k] = { unit_sell_price: Number(v) };
      });
      const payload = {
        po_id: poId,
        user_id: userId,
        discount_mode: discountMode,
        discount_value: dVal,
        selling_overrides: ovObj,
        notes: notes || null,
        updated_by: userId,
        updated_by_email: userEmail,
      };
      const { error } = await (supabase.from as any)("po_profit_scenarios").upsert(payload, { onConflict: "po_id" });
      if (error) throw error;
      toast.success(isAr ? "تم حفظ السيناريو" : "Scenario saved");
      load();
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !po) {
    return <Card className="p-8 text-center text-sm text-muted-foreground">{isAr ? "جارٍ التحميل…" : "Loading…"}</Card>;
  }

  const profitPositive = totalProfit >= 0;

  return (
    <div className="space-y-4">
      {/* PO summary */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-base font-bold">{po.po_number}</div>
            <div className="text-xs text-muted-foreground">
              {po.supplier_name || (isAr ? "بدون مورد" : "No supplier")} · {fmtDateTime(po.created_at, lang)}
            </div>
          </div>
          <div className="text-end text-xs">
            <div className="text-muted-foreground">{isAr ? "إجمالي تكلفة PO (EGP)" : "PO total (EGP)"}</div>
            <div className="text-lg font-bold tabular-nums text-primary">{fmtMoney(totalEgp, "EGP", lang)}</div>
            <div className="text-[10px] text-muted-foreground">
              ${(Number(po.total_usd) || 0).toFixed(2)} · {totalQty} {isAr ? "قطعة" : "units"} · ≈ {fmtMoney(costPerUnitEgp, "EGP", lang)}/{isAr ? "قطعة" : "u"}
            </div>
          </div>
        </div>
      </Card>

      {/* Discount */}
      <Card className="p-4 border-2 border-emerald-500/30 bg-emerald-500/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Label className="text-sm font-semibold">
            {isAr ? "خصم نهائي على فاتورة المورد" : "Final supplier-invoice discount"}
          </Label>
          <div className="flex items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border">
              <button
                type="button"
                onClick={() => setDiscountMode("percent")}
                className={`px-3 py-1 text-xs font-semibold transition ${discountMode === "percent" ? "bg-emerald-600 text-white" : "bg-background hover:bg-accent"}`}
              >%</button>
              <button
                type="button"
                onClick={() => setDiscountMode("fixed")}
                className={`px-3 py-1 text-xs font-semibold transition ${discountMode === "fixed" ? "bg-emerald-600 text-white" : "bg-background hover:bg-accent"}`}
              >EGP</button>
            </div>
            <div className="relative w-36">
              <Input
                type="number" step="any" min={0}
                max={discountMode === "percent" ? 100 : undefined}
                className="h-9 pe-12 text-end font-bold tabular-nums"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder="0"
              />
              <span className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-muted-foreground">
                {discountMode === "percent" ? "%" : "EGP"}
              </span>
            </div>
          </div>
        </div>
        <div className="mt-2 flex justify-between text-xs">
          <span className="text-muted-foreground">{isAr ? "قيمة الخصم على البيع" : "Discount on sales"}</span>
          <span className="font-semibold tabular-nums text-emerald-700">− {fmtMoney(discountEgp, "EGP", lang)}</span>
        </div>
      </Card>

      {/* Result cards */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-3 sm:p-4 min-w-0 overflow-hidden">
          <div className="text-[11px] text-muted-foreground truncate">{isAr ? "إجمالي تكلفة PO (EGP)" : "PO total cost (EGP)"}</div>
          <div className="mt-1 text-base sm:text-lg font-bold tabular-nums break-words">{fmtMoney(totalEgp, "EGP", lang)}</div>
        </Card>
        <Card className="p-3 sm:p-4 min-w-0 overflow-hidden">
          <div className="text-[11px] text-muted-foreground truncate">{isAr ? "إجمالي البيع المتوقع" : "Expected total sales"}</div>
          <div className="mt-1 text-base sm:text-lg font-bold tabular-nums text-primary break-words">{fmtMoney(totalSell, "EGP", lang)}</div>
        </Card>
        <Card className="p-3 sm:p-4 min-w-0 overflow-hidden">
          <div className="text-[11px] text-muted-foreground truncate">{isAr ? "إجمالي البيع المتوقع بعد الخصم" : "Expected sales after discount"}</div>
          <div className="mt-1 text-base sm:text-lg font-bold tabular-nums text-primary break-words">{fmtMoney(salesAfterDiscount, "EGP", lang)}</div>
        </Card>
        <Card className={`p-3 sm:p-4 min-w-0 overflow-hidden border-2 ${profitPositive ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">{isAr ? "صافي الربح" : "Net profit"}</span>
            {profitPositive ? <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <TrendingDown className="h-3.5 w-3.5 shrink-0 text-destructive" />}
          </div>
          <div className={`mt-1 text-lg sm:text-xl font-extrabold tabular-nums break-words ${profitPositive ? "text-emerald-700" : "text-destructive"}`}>
            {fmtMoney(totalProfit, "EGP", lang)}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
            {isAr ? "هامش" : "Margin"} {margin.toFixed(2)}%
          </div>
        </Card>
      </div>

      {/* Items */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider">
            {isAr ? "البنود وأسعار البيع المتوقعة" : "Items & expected selling prices"}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">{isAr ? "مصدر سعر USD:" : "USD cost source:"}</span>
            <div className="inline-flex overflow-hidden rounded-md border">
              <button
                type="button"
                onClick={() => setUsdSource("po")}
                className={`px-2.5 py-1 text-[11px] font-semibold transition ${usdSource === "po" ? "bg-emerald-600 text-white" : "bg-background hover:bg-accent"}`}
              >{isAr ? "سعر PO الأصلي" : "PO original"}</button>
              <button
                type="button"
                onClick={() => setUsdSource("current")}
                className={`px-2.5 py-1 text-[11px] font-semibold transition ${usdSource === "current" ? "bg-emerald-600 text-white" : "bg-background hover:bg-accent"}`}
           >{isAr ? "سعر المنتج الحالي" : "Current product"}</button>
            </div>
            <button
              type="button"
              onClick={() => {
                const next: Record<string, string> = {};
                items.forEach((it) => {
                  const p = productPrices[it.product_id];
                  if (p != null) next[it.id] = String(p);
                });
                setOverrides(next);
                toast.success(isAr ? "تم تطبيق سعر المنتج الحالي على كل البنود" : "Applied current product price to all items");
              }}
              className="rounded-md border bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition hover:opacity-90"
              title={isAr ? "املأ كل بنود البيع بسعر المنتج الحالي (يمكن التعديل بعدها)" : "Fill all sell prices with current product price (editable after)"}
            >
              {isAr ? "تطبيق سعر المنتج على الكل" : "Apply product price to all"}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/30">
              <tr>
                <th className="p-2 text-start">{isAr ? "المنتج" : "Product"}</th>
                <th className="p-2 text-end">{isAr ? "كمية" : "Qty"}</th>
                <th className="p-2 text-end">{isAr ? "USD/وحدة" : "USD/unit"}</th>
                <th className="p-2 text-end">{isAr ? "تكلفة الوحدة (EGP)" : "Unit cost EGP"}</th>
                <th className="p-2 text-end">{isAr ? "سعر بيع الوحدة" : "Unit sell price"}</th>
                <th className="p-2 text-end">{isAr ? "إجمالي البيع" : "Line sell"}</th>
                <th className="p-2 text-end">{isAr ? "ربح البند" : "Line profit"}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {itemCalc.map(({ it, poUnitUsd, currentUnitUsd, usedUnitUsd, unitCostEgp, lineSell, lineProfit }) => {
                const ov = overrides[it.id];
                const hasOverride = ov !== undefined && ov !== "";
                const usdDiffer = Math.abs(poUnitUsd - currentUnitUsd) > 0.001;
                return (
                  <tr key={it.id}>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        {it.image_url ? (
                          <img src={it.image_url} alt={it.product_name} className="h-9 w-9 rounded border object-cover" />
                        ) : (
                          <div className="h-9 w-9 rounded border bg-muted" />
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium">{it.product_name}</div>
                          <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                            {it.serial_number && <span className="font-mono">{it.serial_number}</span>}
                            {it.color && <span>{it.color}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-2 text-end tabular-nums">{it.quantity}</td>
                    <td className="p-2 text-end tabular-nums">
                      <div className="font-semibold">${usedUnitUsd.toFixed(2)}</div>
                      {usdDiffer && (
                        <div className="text-[9px] text-muted-foreground">
                          {usdSource === "current"
                            ? <>PO: ${poUnitUsd.toFixed(2)}</>
                            : <span className={currentUnitUsd > poUnitUsd ? "text-amber-600" : "text-emerald-600"}>{isAr ? "حالي" : "Now"}: ${currentUnitUsd.toFixed(2)}</span>}
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-end tabular-nums">{fmtMoney(unitCostEgp, "EGP", lang)}</td>
                    <td className="p-2 text-end">
                      <div className="flex items-center justify-end gap-1">
                        <Input
                          type="number" step="any" min={0}
                          className="h-7 w-24 text-end tabular-nums"
                          value={ov ?? String(productPrices[it.product_id] ?? "")}
                          onChange={(e) => setOverrides((prev) => ({ ...prev, [it.id]: e.target.value }))}
                        />
                        {hasOverride && (
                          <button
                            type="button"
                            title={isAr ? "إعادة لسعر المنتج" : "Reset to product price"}
                            onClick={() => setOverrides((prev) => { const n = { ...prev }; delete n[it.id]; return n; })}
                            className="rounded px-1 text-[10px] text-muted-foreground hover:text-foreground"
                          >↺</button>
                        )}
                      </div>
                      <div className="mt-0.5 text-[9px] text-muted-foreground">
                        {isAr ? "سعر المنتج الحالي:" : "Current price:"} {fmtMoney(productPrices[it.product_id] ?? 0, "EGP", lang)}
                      </div>
                    </td>
                    <td className="p-2 text-end font-semibold tabular-nums">{fmtMoney(lineSell, "EGP", lang)}</td>
                    <td className={`p-2 text-end font-bold tabular-nums ${lineProfit >= 0 ? "text-emerald-700" : "text-destructive"}`}>
                      {fmtMoney(lineProfit, "EGP", lang)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Result cards moved up — see under discount card */}

      {/* Notes + save */}
      <Card className="p-4">
        <Label className="text-xs font-semibold">{isAr ? "ملاحظات" : "Notes"}</Label>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
        <div className="mt-3 flex items-center justify-between">
          <div className="text-[11px] text-muted-foreground">
            {scenario?.id
              ? (isAr ? "آخر حفظ يستبدل السيناريو السابق." : "Saving overwrites the previous scenario.")
              : (isAr ? "لا يوجد سيناريو محفوظ بعد." : "No scenario saved yet.")}
          </div>
          <Button onClick={save} disabled={saving} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? (isAr ? "جارٍ الحفظ…" : "Saving…") : (isAr ? "حفظ السيناريو" : "Save scenario")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
