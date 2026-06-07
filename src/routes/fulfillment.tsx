import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmtMoney, fmtDateTime } from "@/lib/utils-money";
import {
  CheckCircle2, AlertTriangle, Clock, Truck, Sparkles, Search,
  Package, ChevronDown, ChevronUp, ArrowRight, FlaskConical, Info, ClipboardList, Save,
} from "lucide-react";
import { ColorSwatch } from "@/components/color-swatch";
import { toast } from "sonner";
import {
  computeSuggestions, reasonLabel, INCOMING_PO_STATUSES,
  type Suggestion, type Tier, type DeliveryMode,
  type FInvoice, type FInvItem, type FDeliveredRow, type FProductRow, type FPOItemRow, type FPORow,
} from "@/lib/fulfillment-engine";
import { logFulfillmentAction, bulkLogFulfillment } from "@/lib/fulfillment-audit";


export const Route = createFileRoute("/fulfillment")({
  component: () => (
    <AppShell>
      <FulfillmentPage />
    </AppShell>
  ),
});

function FulfillmentPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [invoices, setInvoices] = useState<FInvoice[]>([]);
  const [items, setItems] = useState<FInvItem[]>([]);
  const [deliveredRows, setDeliveredRows] = useState<FDeliveredRow[]>([]);
  const [products, setProducts] = useState<Map<string, FProductRow>>(new Map());
  const [poItems, setPoItems] = useState<FPOItemRow[]>([]);
  const [pos, setPos] = useState<Map<string, FPORow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [onlyCloseable, setOnlyCloseable] = useState(false);
  const [mode, setMode] = useState<DeliveryMode>("any");

  async function load() {
    if (!user) return;
    setLoading(true);

    const { data: invs } = await supabase
      .from("invoices")
      .select("id, invoice_number, customer_name, customer_phone, total, created_at, delivery_status, status")
      .eq("user_id", user.id)
      .eq("status", "completed")
      .or("delivery_status.is.null,delivery_status.neq.delivered")
      .order("created_at", { ascending: true })
      .limit(50000);
    const invList = (invs ?? []) as FInvoice[];
    setInvoices(invList);

    const invIds = invList.map((i) => i.id);
    if (invIds.length === 0) {
      setItems([]); setDeliveredRows([]);
    } else {
      // Paginate: Supabase Data API caps rows per request. With 117+ invoices and
      // many delivery receipts the result set easily exceeds 1000 rows, which
      // previously caused most invoices to silently disappear from the engine.
      const fetchAllByIn = async <T,>(
        table: string, columns: string, key: string, ids: string[],
      ): Promise<T[]> => {
        const out: T[] = [];
        const chunkIds = 200; // keep IN-list small
        for (let i = 0; i < ids.length; i += chunkIds) {
          const slice = ids.slice(i, i + chunkIds);
          let from = 0;
          const PAGE = 1000;
          // page through results for this slice
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { data, error } = await supabase
              .from(table as any)
              .select(columns)
              .in(key, slice)
              .range(from, from + PAGE - 1);
            if (error) throw error;
            const rows = (data ?? []) as T[];
            out.push(...rows);
            if (rows.length < PAGE) break;
            from += PAGE;
          }
        }
        return out;
      };

      const itemList = await fetchAllByIn<FInvItem>(
        "invoice_items",
        "id, invoice_id, product_id, product_name, serial_number, color, quantity, unit_price",
        "invoice_id",
        invIds,
      );
      setItems(itemList);

      const itemIds = itemList.map((i) => i.id);
      if (itemIds.length) {
        const drs = await fetchAllByIn<FDeliveredRow>(
          "delivery_receipt_items",
          "invoice_item_id, quantity, note",
          "invoice_item_id",
          itemIds,
        );
        setDeliveredRows(drs);
      } else {
        setDeliveredRows([]);
      }
    }

    const { data: prods } = await supabase
      .from("products")
      .select("id, name, stock_quantity, serial_number, color")
      .eq("user_id", user.id)
      .limit(20000);
    const pMap = new Map<string, FProductRow>();
    for (const p of (prods ?? []) as FProductRow[]) pMap.set(p.id, p);
    setProducts(pMap);

    const { data: poList } = await supabase
      .from("purchase_orders")
      .select("id, po_number, status, expected_arrival_at")
      .eq("user_id", user.id)
      .in("status", Array.from(INCOMING_PO_STATUSES))
      .limit(2000);
    const poMap = new Map<string, FPORow>();
    for (const p of (poList ?? []) as FPORow[]) poMap.set(p.id, p);
    setPos(poMap);
    const poIds = Array.from(poMap.keys());
    if (poIds.length) {
      // Page PO items too — large procurement projects can blow past 1000.
      const allPoItems: FPOItemRow[] = [];
      const chunkIds = 200;
      for (let i = 0; i < poIds.length; i += chunkIds) {
        const slice = poIds.slice(i, i + chunkIds);
        let from = 0;
        const PAGE = 1000;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { data, error } = await supabase
            .from("purchase_order_items")
            .select("po_id, product_id, quantity, received_qty")
            .in("po_id", slice)
            .range(from, from + PAGE - 1);
          if (error) break;
          const rows = (data ?? []) as FPOItemRow[];
          allPoItems.push(...rows);
          if (rows.length < PAGE) break;
          from += PAGE;
        }
      }
      setPoItems(allPoItems);
    } else {
      setPoItems([]);
    }


    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);
  useRealtimeTable("invoices", load, [user?.id]);
  useRealtimeTable("invoice_items", load, [user?.id]);
  useRealtimeTable("delivery_receipt_items", load, [user?.id]);
  useRealtimeTable("products", load, [user?.id]);
  useRealtimeTable("purchase_orders", load, [user?.id]);
  useRealtimeTable("purchase_order_items", load, [user?.id]);

  const suggestions = useMemo<Suggestion[]>(
    () => computeSuggestions({ invoices, items, deliveredRows, products, poItems, pos, mode }),
    [invoices, items, deliveredRows, products, poItems, pos, mode],
  );

  // Transition watch: if an invoice that WAS closeable 100% is no longer, warn the user.
  const prevNowFullRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const nowFull = new Set(suggestions.filter((s) => s.tier === "now_full").map((s) => s.invoice.id));
    const prev = prevNowFullRef.current;
    if (prev) {
      const dropped: string[] = [];
      for (const id of prev) if (!nowFull.has(id)) dropped.push(id);
      if (dropped.length) {
        const names = dropped
          .map((id) => suggestions.find((s) => s.invoice.id === id)?.invoice.invoice_number)
          .filter(Boolean)
          .slice(0, 3)
          .join(", ");
        toast.warning(
          isAr
            ? `⚠️ تغيّر المخزون — ${dropped.length} فاتورة لم تعد قابلة للإقفال 100% (${names}${dropped.length > 3 ? "…" : ""})`
            : `⚠️ Stock changed — ${dropped.length} invoice(s) no longer closeable 100% (${names}${dropped.length > 3 ? "…" : ""})`,
          { duration: 8000 },
        );
      }
    }
    prevNowFullRef.current = nowFull;
  }, [suggestions, isAr]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suggestions;
    return suggestions.filter((s) =>
      s.invoice.invoice_number.toLowerCase().includes(q) ||
      (s.invoice.customer_name || "").toLowerCase().includes(q) ||
      s.needs.some((n) => n.product_name.toLowerCase().includes(q))
    );
  }, [suggestions, search]);

  const byTier = useMemo(() => {
    const g: Record<Tier, Suggestion[]> = {
      now_full: [], now_partial: [], incoming_full: [], incoming_partial: [], blocked: [],
    };
    const src = onlyCloseable ? filtered.filter((s) => s.tier === "now_full") : filtered;
    for (const s of src) g[s.tier].push(s);
    return g;
  }, [filtered, onlyCloseable]);

  return (
    <div className="space-y-6" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Sparkles className="h-6 w-6 text-primary" />
            {isAr ? "اقتراحات الإقفال الذكية" : "Smart Fulfillment Suggestions"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAr
              ? "ترتيب ذكي للفواتير حسب إمكانية الإقفال — الفواتير القابلة للإقفال الكامل من المخزون الحالي أولاً، ثم باستخدام الشحنات القادمة."
              : "Smart ranking — invoices fully closeable from current stock first, then those needing incoming POs."}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Link to="/fulfillment-audit">
            <Button type="button" variant="ghost" size="sm" className="gap-2">
              <ClipboardList className="h-4 w-4" />
              {isAr ? "سجل التدقيق" : "Audit log"}
            </Button>
          </Link>
          <Link to="/fulfillment-tests">
            <Button type="button" variant="ghost" size="sm" className="gap-2">
              <FlaskConical className="h-4 w-4" />
              {isAr ? "اختبارات" : "Tests"}
            </Button>
          </Link>

          <Select value={mode} onValueChange={(v) => setMode(v as DeliveryMode)}>
            <SelectTrigger className="w-full sm:w-[230px]" title={isAr ? "نوع التسليم المعتبر" : "Delivery counting mode"}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">{isAr ? "أي تسليم يُحتسب (افتراضي)" : "Any delivery counts (default)"}</SelectItem>
              <SelectItem value="strict_full">{isAr ? "المُسلَّم كامل فقط" : "Fully delivered only"}</SelectItem>
              <SelectItem value="mixer_ok">{isAr ? "المكسّر فقط يكفي" : "Mixer-only counts"}</SelectItem>
              <SelectItem value="trim_ok">{isAr ? "الظاهر فقط يكفي" : "Trim-only counts"}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant={onlyCloseable ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyCloseable((v) => !v)}
            className="gap-2"
            title={isAr ? "اعرض فقط الفواتير القابلة للإقفال 100% الآن" : "Show only invoices closeable 100% now"}
          >
            <CheckCircle2 className="h-4 w-4" />
            {isAr ? "قابلة للإقفال 100% الآن" : "Closeable 100% now"}
            {onlyCloseable && (
              <Badge variant="secondary" className="ms-1">{byTier.now_full.length}</Badge>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!user?.id || byTier.now_full.length === 0}
            onClick={async () => {
              if (!user?.id) return;
              const list = byTier.now_full;
              if (list.length === 0) { toast.info(isAr ? "لا توجد فواتير قابلة للإقفال الآن" : "No closeable invoices"); return; }
              const t = toast.loading(isAr ? `جارٍ تسجيل ${list.length} فاتورة…` : `Logging ${list.length} invoices…`);
              const r = await bulkLogFulfillment(user.id, list, mode, "snapshot",
                isAr ? "تدقيق جماعي" : "Bulk audit");
              toast.dismiss(t);
              toast.success(
                isAr
                  ? `✅ سُجّلت ${r.count}/${list.length} — مخزون:${r.totalFromStock} شحنات:${r.totalFromIncoming} يدوي:${r.manualCount} ناقص:${r.totalShortfall}${r.failed ? ` · فشل:${r.failed}` : ""}`
                  : `✅ Logged ${r.count}/${list.length} — stock:${r.totalFromStock} incoming:${r.totalFromIncoming} manual:${r.manualCount} short:${r.totalShortfall}${r.failed ? ` · failed:${r.failed}` : ""}`,
                { duration: 8000 },
              );
            }}
            className="gap-2"
            title={isAr ? "سجّل تدقيق جماعي لكل الفواتير القابلة للإقفال الآن" : "Bulk audit-log all currently closeable invoices"}
          >
            <ClipboardList className="h-4 w-4" />
            {isAr ? "تدقيق جماعي" : "Bulk audit"}
            {byTier.now_full.length > 0 && <Badge variant="secondary" className="ms-1">{byTier.now_full.length}</Badge>}
          </Button>
          <div className="relative w-full sm:w-72">
            <Search className={`absolute top-1/2 -translate-y-1/2 ${isAr ? "right-3" : "left-3"} h-4 w-4 text-muted-foreground`} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isAr ? "ابحث برقم الفاتورة أو العميل أو المنتج…" : "Search invoice / customer / product…"}
              className={isAr ? "pr-9" : "pl-9"}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryChip label={isAr ? "جاهزة للإقفال الآن" : "Close now (full)"} count={byTier.now_full.length} icon={<CheckCircle2 className="h-4 w-4" />} color="emerald" />
        <SummaryChip label={isAr ? "جزئي من المخزون" : "Partial from stock"} count={byTier.now_partial.length} icon={<Package className="h-4 w-4" />} color="sky" />
        <SummaryChip label={isAr ? "إقفال كامل بعد الوصول" : "Full after arrival"} count={byTier.incoming_full.length} icon={<Truck className="h-4 w-4" />} color="violet" />
        <SummaryChip label={isAr ? "جزئي بعد الوصول" : "Partial after arrival"} count={byTier.incoming_partial.length} icon={<Clock className="h-4 w-4" />} color="amber" />
        <SummaryChip label={isAr ? "محجوبة" : "Blocked"} count={byTier.blocked.length} icon={<AlertTriangle className="h-4 w-4" />} color="rose" />
      </div>

      {loading && (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-muted-foreground">
          {isAr ? "جارٍ التحليل…" : "Analyzing…"}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-muted-foreground">
          {isAr ? "لا توجد فواتير مفتوحة لاقتراحها." : "No open invoices to suggest."}
        </div>
      )}

      {(["now_full", "now_partial", "incoming_full", "incoming_partial", "blocked"] as Tier[]).map((tier) =>
        byTier[tier].length === 0 ? null : (
          <section key={tier} className="space-y-2">
            <TierHeader tier={tier} count={byTier[tier].length} isAr={isAr} />
            <div className="grid gap-3">
              {byTier[tier].map((s) => (
                <SuggestionCard
                  key={s.invoice.id}
                  s={s}
                  isAr={isAr}
                  mode={mode}
                  userId={user?.id ?? null}
                  open={openCard === s.invoice.id}
                  onToggle={() => setOpenCard(openCard === s.invoice.id ? null : s.invoice.id)}
                />
              ))}

            </div>
          </section>
        )
      )}
    </div>
  );
}

function SummaryChip({ label, count, icon, color }: {
  label: string; count: number; icon: React.ReactNode;
  color: "emerald" | "sky" | "violet" | "amber" | "rose";
}) {
  const map: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    sky: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
    violet: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  };
  return (
    <Card className={`flex items-center gap-3 border p-3 ${map[color]}`}>
      <div className="rounded-md bg-background/40 p-2">{icon}</div>
      <div>
        <div className="text-xs opacity-80">{label}</div>
        <div className="text-xl font-bold">{count}</div>
      </div>
    </Card>
  );
}

function TierHeader({ tier, count, isAr }: { tier: Tier; count: number; isAr: boolean }) {
  const titles: Record<Tier, { ar: string; en: string; icon: React.ReactNode; cls: string }> = {
    now_full: { ar: "🟢 جاهزة للإقفال بالكامل الآن", en: "🟢 Ready to close fully NOW", icon: <CheckCircle2 className="h-4 w-4" />, cls: "text-emerald-700 dark:text-emerald-400" },
    now_partial: { ar: "🔵 إقفال جزئي من المخزون الحالي", en: "🔵 Partial close from current stock", icon: <Package className="h-4 w-4" />, cls: "text-sky-700 dark:text-sky-400" },
    incoming_full: { ar: "🟣 إقفال كامل بعد وصول الشحنات", en: "🟣 Full close after incoming POs arrive", icon: <Truck className="h-4 w-4" />, cls: "text-violet-700 dark:text-violet-400" },
    incoming_partial: { ar: "🟡 إقفال جزئي بعد الشحنات القادمة", en: "🟡 Partial close after incoming POs", icon: <Clock className="h-4 w-4" />, cls: "text-amber-700 dark:text-amber-400" },
    blocked: { ar: "🔴 محجوبة — لا يوجد مخزون ولا شحنات قادمة", en: "🔴 Blocked — no stock and no incoming POs", icon: <AlertTriangle className="h-4 w-4" />, cls: "text-rose-700 dark:text-rose-400" },
  };
  const t = titles[tier];
  return (
    <div className={`flex items-center gap-2 text-sm font-semibold ${t.cls}`}>
      {t.icon}
      <span>{isAr ? t.ar : t.en}</span>
      <Badge variant="outline" className="text-xs">{count}</Badge>
    </div>
  );
}

function SuggestionCard({ s, isAr, mode, userId, open, onToggle }: {
  s: Suggestion; isAr: boolean; mode: DeliveryMode; userId: string | null; open: boolean; onToggle: () => void;
}) {
  const [logging, setLogging] = useState(false);
  async function handleLog(action: "closed" | "partial_close" | "snapshot") {
    if (!userId) { toast.error(isAr ? "يلزم تسجيل الدخول" : "Sign in required"); return; }
    setLogging(true);
    try {
      await logFulfillmentAction(userId, s, mode, action);
      toast.success(isAr ? "تم تسجيل الإقفال في سجل التدقيق" : "Closure recorded in audit log");
    } catch (e: any) {
      toast.error(e?.message || "Error");
    } finally { setLogging(false); }
  }
  const pct = s.confidence;
  const canCreateDR = s.totalFromStock > 0 || s.totalNeeded === 0;

  const confColor =
    pct >= 100 ? "text-emerald-700 dark:text-emerald-400"
    : pct >= 60 ? "text-amber-700 dark:text-amber-400"
    : "text-rose-700 dark:text-rose-400";
  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 p-4 text-start hover:bg-muted/40">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{s.invoice.invoice_number}</span>
            <span className="text-sm text-muted-foreground">·</span>
            <span className="truncate text-sm">{s.invoice.customer_name || (isAr ? "بدون اسم" : "Unnamed")}</span>
            <Badge variant="outline" className="text-[10px]">{fmtMoney(s.invoiceValue, "EGP", isAr ? "ar" : "en")}</Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {isAr ? "تاريخ" : "Date"}: {fmtDateTime(s.invoice.created_at, isAr ? "ar" : "en")}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md bg-muted px-2 py-0.5">{isAr ? "مطلوب" : "Needed"}: <b>{s.totalNeeded}</b></span>
            {s.totalFromStock > 0 && <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">{isAr ? "من المخزون" : "From stock"}: <b>{s.totalFromStock}</b></span>}
            {s.totalFromIncoming > 0 && <span className="rounded-md bg-violet-500/15 px-2 py-0.5 text-violet-700 dark:text-violet-400">{isAr ? "من الشحنات" : "From incoming"}: <b>{s.totalFromIncoming}</b></span>}
            {s.totalShortfall > 0 && <span className="rounded-md bg-rose-500/15 px-2 py-0.5 text-rose-700 dark:text-rose-400">{isAr ? "ناقص" : "Short"}: <b>{s.totalShortfall}</b></span>}
            {s.manualCount > 0 && <span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-sky-700 dark:text-sky-400">{isAr ? "بنود يدوية" : "Manual"}: <b>{s.manualCount}</b></span>}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Progress value={Math.min(100, pct)} className="h-1.5 flex-1" />
            <span className={`text-xs font-bold ${confColor}`}>{pct}%</span>
          </div>
          {s.reasons.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {s.reasons.map((r, i) => (
                <Badge key={i} variant="outline" className="gap-1 text-[10px] font-normal">
                  <Info className="h-3 w-3" />
                  {reasonLabel(r.code, isAr)}{r.detail ? ` · ${r.detail}` : ""}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0">{open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</div>
      </button>

      {open && (
        <div className="border-t border-border bg-muted/20 p-4">
          <div className="space-y-2">
            {s.needs.length === 0 && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
                {isAr ? "كل البنود مُسلَّمة بالكامل وفق فلتر التسليم الحالي." : "All items already delivered under the current delivery mode."}
              </div>
            )}
            {s.needs.map((n) => (
              <div key={n.product_id} className="rounded-md border border-border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{n.product_name}</span>
                  {n.serial && <span className="font-mono text-xs text-muted-foreground">#{n.serial}</span>}
                  {n.color && <ColorSwatch value={n.color} size="sm" />}
                  {n.isManual && <Badge variant="outline" className="border-sky-500/40 text-sky-700 dark:text-sky-400 text-[10px]">{isAr ? "بند يدوي" : "Manual"}</Badge>}
                  <span className="ms-auto text-xs text-muted-foreground">{isAr ? "مطلوب" : "Need"}: <b>{n.needed}</b></span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {n.fromStock > 0 && <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">{isAr ? (n.isManual ? "بند يدوي مُحتسب" : "متاح من المخزون") : (n.isManual ? "Manual satisfied" : "From stock")}: {n.fromStock}</Badge>}
                  {n.fromIncoming > 0 && <Badge variant="outline" className="border-violet-500/40 text-violet-700 dark:text-violet-400">{isAr ? "من الشحنات" : "From incoming"}: {n.fromIncoming}</Badge>}
                  {n.shortfall > 0 && <Badge variant="outline" className="border-rose-500/40 text-rose-700 dark:text-rose-400">{isAr ? "ناقص" : "Short"}: {n.shortfall}</Badge>}
                </div>
                {n.incomingPOs.length > 0 && (
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {n.incomingPOs.map((p, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Truck className="h-3 w-3" />
                        <span className="font-mono">{p.po_number}</span>
                        <span>×{p.qty}</span>
                        {p.eta && <span>· {isAr ? "وصول متوقع" : "ETA"}: {fmtDateTime(p.eta, isAr ? "ar" : "en")}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {s.earliestEta
                ? (isAr ? `أقرب موعد وصول للشحنات: ${fmtDateTime(s.earliestEta, "ar")}` : `Earliest incoming ETA: ${fmtDateTime(s.earliestEta, "en")}`)
                : (isAr ? "كل المطلوب متاح في المخزون" : "All required units are in stock")}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button" variant="ghost" size="sm" disabled={logging}
                onClick={() => handleLog(s.tier === "now_full" ? "closed" : "snapshot")}
                className="gap-1"
                title={isAr ? "سجّل سبب الإقفال والأرقام في سجل التدقيق" : "Record closure reason & numbers in audit log"}
              >
                <Save className="h-3 w-3" />
                {isAr ? "سجّل في التدقيق" : "Log to audit"}
              </Button>
              <Link to="/invoices/$id" params={{ id: s.invoice.id }}>
                <Button variant="outline" size="sm">{isAr ? "فتح الفاتورة" : "Open invoice"}</Button>
              </Link>
              {canCreateDR && (
                <Link to="/delivery-receipts/new" search={{ invoiceId: s.invoice.id }}>
                  <Button size="sm" className="gap-1">
                    {isAr ? "إنشاء إذن تسليم" : "Create delivery receipt"}
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              )}
            </div>

          </div>
        </div>
      )}
    </Card>
  );
}
