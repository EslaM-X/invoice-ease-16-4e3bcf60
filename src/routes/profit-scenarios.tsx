import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useRole } from "@/lib/use-role";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtMoney, fmtDateTime } from "@/lib/utils-money";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calculator, Search, TrendingUp, TrendingDown, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/profit-scenarios")({
  component: () => (
    <AppShell>
      <SavedScenariosPage />
    </AppShell>
  ),
});

type Row = {
  id: string;
  po_id: string;
  discount_mode: "percent" | "fixed";
  discount_value: number;
  selling_overrides: Record<string, { unit_sell_price?: number }>;
  notes: string | null;
  updated_at: string;
  updated_by_email: string | null;
  // joined
  po_number: string;
  supplier_name: string | null;
  total_egp: number;
  total_usd: number;
  total_qty: number;
  // computed
  totalSell: number;
  discountEgp: number;
  salesAfterDiscount: number;
  netProfit: number;
  margin: number;
};

function SavedScenariosPage() {
  const { lang } = useI18n();
  const { isAdmin, isCFO, loading: roleLoading } = useRole();
  const navigate = useNavigate();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!roleLoading && !isAdmin && !isCFO) {
      toast.error(isAr ? "غير مصرح" : "Not authorized");
      navigate({ to: "/dashboard" });
    }
  }, [roleLoading, isAdmin, isCFO, navigate, isAr]);

  const load = async () => {
    setLoading(true);
    const { data: scenarios } = await (supabase.from as any)("po_profit_scenarios")
      .select("*")
      .order("updated_at", { ascending: false });
    const list = (scenarios as any[]) ?? [];
    if (list.length === 0) { setRows([]); setLoading(false); return; }

    const poIds = list.map((s) => s.po_id);
    const [{ data: pos }, { data: items }] = await Promise.all([
      supabase.from("purchase_orders").select("id,po_number,supplier_name,total_egp,total_usd,total_qty").in("id", poIds),
      supabase.from("purchase_order_items").select("id,po_id,product_id,quantity,line_total_usd").in("po_id", poIds),
    ]);
    const productIds = Array.from(new Set((items ?? []).map((i: any) => i.product_id).filter(Boolean)));
    const { data: prods } = productIds.length
      ? await supabase.from("products").select("id,price").in("id", productIds)
      : { data: [] as any[] };
    const priceMap: Record<string, number> = {};
    (prods ?? []).forEach((p: any) => { priceMap[p.id] = Number(p.price) || 0; });
    const poMap: Record<string, any> = {};
    (pos ?? []).forEach((p: any) => { poMap[p.id] = p; });
    const itemsByPo: Record<string, any[]> = {};
    (items ?? []).forEach((it: any) => { (itemsByPo[it.po_id] ||= []).push(it); });

    const computed: Row[] = list.map((sc) => {
      const po = poMap[sc.po_id];
      const its = itemsByPo[sc.po_id] || [];
      const overrides = (sc.selling_overrides || {}) as Record<string, { unit_sell_price?: number }>;
      const totalSell = its.reduce((s, it) => {
        const ov = overrides[it.id]?.unit_sell_price;
        const sell = ov != null ? Number(ov) : (priceMap[it.product_id] ?? 0);
        return s + sell * (Number(it.quantity) || 0);
      }, 0);
      const totalEgp = Number(po?.total_egp) || 0;
      const dInput = Math.max(0, Number(sc.discount_value) || 0);
      const dVal = sc.discount_mode === "percent" ? Math.min(100, dInput) : dInput;
      const discountEgp = sc.discount_mode === "percent"
        ? (totalSell * dVal) / 100
        : Math.min(totalSell, dVal);
      const salesAfterDiscount = Math.max(0, totalSell - discountEgp);
      const netProfit = salesAfterDiscount - totalEgp;
      const margin = salesAfterDiscount > 0 ? (netProfit / salesAfterDiscount) * 100 : 0;
      return {
        id: sc.id,
        po_id: sc.po_id,
        discount_mode: sc.discount_mode,
        discount_value: Number(sc.discount_value) || 0,
        selling_overrides: overrides,
        notes: sc.notes,
        updated_at: sc.updated_at,
        updated_by_email: sc.updated_by_email,
        po_number: po?.po_number ?? "—",
        supplier_name: po?.supplier_name ?? null,
        total_egp: totalEgp,
        total_usd: Number(po?.total_usd) || 0,
        total_qty: Number(po?.total_qty) || 0,
        totalSell,
        discountEgp,
        salesAfterDiscount,
        netProfit,
        margin,
      };
    });
    setRows(computed);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useRealtimeTable("po_profit_scenarios", load, []);
  useRealtimeTable("purchase_orders", load, []);
  useRealtimeTable("purchase_order_items", load, []);
  useRealtimeTable("products", load, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.po_number.toLowerCase().includes(q) ||
      (r.supplier_name ?? "").toLowerCase().includes(q) ||
      (r.notes ?? "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totals = useMemo(() => {
    const sumProfit = filtered.reduce((s, r) => s + r.netProfit, 0);
    const sumSales = filtered.reduce((s, r) => s + r.salesAfterDiscount, 0);
    const avgMargin = sumSales > 0 ? (sumProfit / sumSales) * 100 : 0;
    return { sumProfit, sumSales, avgMargin, count: filtered.length };
  }, [filtered]);

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-500/10 via-primary/5 to-transparent p-5">
        <div className="absolute -end-12 -top-12 h-44 w-44 rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="relative">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/15 text-emerald-700 shadow-sm">
              <Calculator className="h-5 w-5" />
            </span>
            {isAr ? "السيناريوهات المحفوظة" : "Saved Scenarios"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {isAr
              ? "كل السيناريوهات اللي حفظتها من حاسبة الربح. تحديث لحظي وتقدر تفتح أي واحد فيهم."
              : "All scenarios saved from the Profit Calculator. Live updates, click any to open."}
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{isAr ? "عدد السيناريوهات" : "Scenarios"}</div>
          <div className="mt-1 text-xl font-bold tabular-nums">{totals.count}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{isAr ? "إجمالي البيع بعد الخصم" : "Total sales after discount"}</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-primary">{fmtMoney(totals.sumSales, "EGP", lang)}</div>
        </Card>
        <Card className={`p-4 border-2 ${totals.sumProfit >= 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
          <div className="text-xs text-muted-foreground">{isAr ? "إجمالي صافي الربح" : "Total net profit"}</div>
          <div className={`mt-1 text-xl font-extrabold tabular-nums ${totals.sumProfit >= 0 ? "text-emerald-700" : "text-destructive"}`}>
            {fmtMoney(totals.sumProfit, "EGP", lang)}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {isAr ? "متوسط هامش" : "Avg margin"} {totals.avgMargin.toFixed(2)}%
          </div>
        </Card>
      </div>

      {/* Search */}
      <Card className="p-3">
        <div className="relative">
          <Search className="absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? "ابحث برقم PO أو المورد أو الملاحظات…" : "Search by PO, supplier, or notes…"}
            className="h-9 ps-7 text-xs"
          />
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{isAr ? "جارٍ التحميل…" : "Loading…"}</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {isAr ? "لا توجد سيناريوهات محفوظة بعد." : "No saved scenarios yet."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="p-2 text-start">{isAr ? "أمر الشراء" : "PO"}</th>
                  <th className="p-2 text-start">{isAr ? "المورد" : "Supplier"}</th>
                  <th className="p-2 text-end">{isAr ? "تكلفة PO" : "PO cost"}</th>
                  <th className="p-2 text-end">{isAr ? "الخصم" : "Discount"}</th>
                  <th className="p-2 text-end">{isAr ? "البيع بعد الخصم" : "Sales after disc."}</th>
                  <th className="p-2 text-end">{isAr ? "صافي الربح" : "Net profit"}</th>
                  <th className="p-2 text-end">{isAr ? "هامش" : "Margin"}</th>
                  <th className="p-2 text-start">{isAr ? "آخر تحديث" : "Last update"}</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => {
                  const positive = r.netProfit >= 0;
                  return (
                    <tr
                      key={r.id}
                      className="cursor-pointer transition hover:bg-accent/40"
                      onClick={() => navigate({ to: "/profit-calculator", search: { po: r.po_id } as any })}
                    >
                      <td className="p-2 font-mono font-bold">{r.po_number}</td>
                      <td className="p-2">{r.supplier_name || <span className="text-muted-foreground">—</span>}</td>
                      <td className="p-2 text-end tabular-nums">{fmtMoney(r.total_egp, "EGP", lang)}</td>
                      <td className="p-2 text-end tabular-nums text-emerald-700">
                        {r.discount_mode === "percent" ? `${r.discount_value}%` : fmtMoney(r.discount_value, "EGP", lang)}
                        <div className="text-[10px] text-muted-foreground">− {fmtMoney(r.discountEgp, "EGP", lang)}</div>
                      </td>
                      <td className="p-2 text-end font-semibold tabular-nums text-primary">{fmtMoney(r.salesAfterDiscount, "EGP", lang)}</td>
                      <td className={`p-2 text-end font-bold tabular-nums ${positive ? "text-emerald-700" : "text-destructive"}`}>
                        <div className="inline-flex items-center gap-1 justify-end">
                          {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {fmtMoney(r.netProfit, "EGP", lang)}
                        </div>
                      </td>
                      <td className="p-2 text-end">
                        <Badge className={positive ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" : "bg-destructive/15 text-destructive border-destructive/30"}>
                          {r.margin.toFixed(2)}%
                        </Badge>
                      </td>
                      <td className="p-2">
                        <div>{fmtDateTime(r.updated_at, lang)}</div>
                        {r.updated_by_email && <div className="text-[10px] text-muted-foreground">{r.updated_by_email}</div>}
                      </td>
                      <td className="p-2 text-end">
                        <ArrowUpRight className="inline h-4 w-4 text-muted-foreground" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
