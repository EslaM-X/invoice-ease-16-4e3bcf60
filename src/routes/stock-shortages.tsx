import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useBatchedRealtimeTables } from "@/lib/realtime";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle, Package, TruckIcon, RefreshCw, Search, Copy, Download,
  ShoppingCart, ChevronDown, ChevronUp, Flame, Clock, CheckSquare, Square,
  ClipboardList, Send, ShieldCheck, Code2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useIsExecutive } from "@/lib/use-executive";


export const Route = createFileRoute("/stock-shortages")({
  component: () => (
    <AppShell>
      <StockShortagesPage />
    </AppShell>
  ),
});

type ShortageInvoice = {
  invoice_id: string;
  invoice_number: string;
  customer_name: string | null;
  quantity: number;
  created_at: string;
  status: string;
  delivery_status: string | null;
};

type IncomingPO = {
  po_id: string;
  po_number: string;
  supplier_name: string | null;
  status: string;
  shipment_code: string | null;
  expected_arrival_at: string | null;
  qty: number;
};

type ShortageRow = {
  product_id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  collection: string | null;
  image_url: string | null;
  is_spare_part: boolean | null;
  stock_quantity: number;
  incoming_qty: number;
  needed_qty: number;
  from_stock: number;
  from_incoming: number;
  net_shortage: number;
  severity: "critical" | "shortfall" | "awaiting" | "covered";
  invoices: ShortageInvoice[];
  incoming_pos: IncomingPO[];
};

type SortKey = "priority" | "shortage" | "oldest" | "name";

const dayMs = 1000 * 60 * 60 * 24;

function StockShortagesPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const navigate = useNavigate();
  const { user } = useAuth();
  const isExec = useIsExecutive();

  const [rows, setRows] = useState<ShortageRow[] | null>(null);
  const [rawById, setRawById] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const [auditMode, setAuditMode] = useState(false);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [sortBy, setSortBy] = useState<SortKey>("priority");
  const [urgencyOnly, setUrgencyOnly] = useState<"all" | "critical" | "waiting">("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Existing open shortage requests, keyed by product_id — used to badge cards.
  const [openReqs, setOpenReqs] = useState<Record<string, number>>({});
  const [reqTarget, setReqTarget] = useState<null | {
    product_id: string;
    product_name: string;
    invoice_id?: string;
    invoice_number?: string;
    quantity: number;
  }>(null);
  const [reqQty, setReqQty] = useState<number>(0);
  const [reqNote, setReqNote] = useState("");
  const [reqSaving, setReqSaving] = useState(false);



  const [includeAwaiting, setIncludeAwaiting] = useState(false);
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());
  const [deliveryFilters, setDeliveryFilters] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_inventory_shortage_alerts" as any);
    if (error) {
      toast.error(error.message);
      setRows([]);
    } else {
      const arr = (data as any[]) ?? [];
      const rawMap: Record<string, any> = {};
      const mapped: ShortageRow[] = arr.map((r) => {
        rawMap[r.product_id] = r;
        return {
          product_id: r.product_id,
          product_name: r.product_name,
          serial_number: r.serial_number,
          color: r.color,
          collection: r.collection,
          image_url: r.image_url,
          is_spare_part: r.is_spare_part,
          stock_quantity: Number(r.stock_quantity || 0),
          incoming_qty: Number(r.incoming_qty || 0),
          needed_qty: Number(r.needed_qty || 0),
          from_stock: Number(r.from_stock || 0),
          from_incoming: Number(r.from_incoming || 0),
          net_shortage: Number(r.net_shortage || 0),
          severity: r.severity,
          invoices: ((r.sources as any[]) ?? []).map((s) => ({
            invoice_id: s.invoice_id,
            invoice_number: s.invoice_number,
            customer_name: s.customer_name,
            quantity: Number(s.reserved_qty ?? s.quantity ?? 0),
            created_at: s.created_at,
            status: s.status ?? "",
            delivery_status: s.delivery_status ?? null,
          })),
          incoming_pos: ((r.incoming_pos as any[]) ?? []) as IncomingPO[],
        };
      });
      setRows(mapped);
      setRawById(rawMap);
      setLastLoaded(new Date());
    }
    setLoading(false);
  };


  const loadRequests = async () => {
    const { data } = await supabase
      .from("shortage_requests" as any)
      .select("product_id,status")
      .in("status", ["open", "ordered"]);
    const map: Record<string, number> = {};
    for (const r of (data as any[]) ?? []) {
      map[r.product_id] = (map[r.product_id] ?? 0) + 1;
    }
    setOpenReqs(map);
  };

  useEffect(() => {
    load();
    loadRequests();
  }, []);

  useBatchedRealtimeTables(
    ["invoice_po_reservations", "purchase_order_items", "products", "shortage_requests"],
    () => { load(); loadRequests(); },
    [],
    { debounceMs: 400 },
  );


  // ----- Derived priority / age -----
  const enriched = useMemo(() => {
    if (!rows) return [];
    const now = Date.now();
    return rows.map((r) => {
      const oldest = r.invoices.reduce((m, i) => Math.min(m, new Date(i.created_at).getTime()), now);
      const ageDays = Math.max(0, Math.floor((now - oldest) / dayMs));
      const net = Math.max(0, Number(r.net_shortage || 0));
      // Score: aged shortages weigh more; each day adds pressure.
      const priorityScore = net * (1 + ageDays / 3);
      const urgency: "critical" | "waiting" | "covered" =
        net > 0 && ageDays >= 7 ? "critical" : net > 0 ? "waiting" : "covered";
      return { ...r, net, oldestMs: oldest, ageDays, priorityScore, urgency };
    });
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = enriched;
    if (urgencyOnly !== "all") list = list.filter((r) => r.urgency === urgencyOnly);

    // Default: only true shortages (net > 0). Toggle to also include awaiting-arrival rows.
    if (!includeAwaiting) list = list.filter((r) => r.net > 0);

    // Invoice status filters (financial + delivery). Empty set = no filter.
    const dateFromMs = dateFrom ? new Date(dateFrom + "T00:00:00").getTime() : null;
    const dateToMs = dateTo ? new Date(dateTo + "T23:59:59.999").getTime() : null;
    const applyFilters = dateFromMs !== null || dateToMs !== null || statusFilters.size > 0 || deliveryFilters.size > 0;
    if (applyFilters) {
      list = list
        .map((r) => {
          const invs = r.invoices.filter((i) => {
            if (statusFilters.size > 0 && !statusFilters.has(i.status || "")) return false;
            if (deliveryFilters.size > 0 && !deliveryFilters.has(i.delivery_status || "pending")) return false;
            const t = new Date(i.created_at).getTime();
            if (dateFromMs !== null && t < dateFromMs) return false;
            if (dateToMs !== null && t > dateToMs) return false;
            return true;
          });
          if (invs.length === 0) return null;
          const needed = invs.reduce((s, i) => s + (i.quantity || 0), 0);
          const net = Math.max(0, needed - (Number(r.stock_quantity || 0) + Number(r.incoming_qty || 0)));
          return { ...r, invoices: invs, needed_qty: needed, net };
        })
        .filter(Boolean) as typeof list;
    }


    if (needle) {
      list = list.filter(
        (r) =>
          r.product_name.toLowerCase().includes(needle) ||
          (r.serial_number ?? "").toLowerCase().includes(needle) ||
          (r.color ?? "").toLowerCase().includes(needle) ||
          (r.collection ?? "").toLowerCase().includes(needle) ||
          r.invoices.some(
            (i) =>
              (i.invoice_number ?? "").toLowerCase().includes(needle) ||
              (i.customer_name ?? "").toLowerCase().includes(needle),
          ),
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case "shortage": return b.net - a.net;
        case "oldest": return a.oldestMs - b.oldestMs;
        case "name": return a.product_name.localeCompare(b.product_name);
        case "priority":
        default: return b.priorityScore - a.priorityScore;
      }
    });
    return sorted;
  }, [enriched, q, sortBy, urgencyOnly, dateFrom, dateTo, includeAwaiting, statusFilters, deliveryFilters]);

  // ----- Grouped by collection for smart display -----
  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const r of filtered) {
      const key = r.collection || (ar ? "بدون كولكشن" : "Uncategorized");
      if (!map.has(key)) map.set(key, [] as any);
      (map.get(key) as any).push(r);
    }
    return Array.from(map.entries());
  }, [filtered, ar]);

  const totals = useMemo(() => {
    const src = filtered;
    return {
      lines: src.length,
      needed: src.reduce((s, r) => s + (r.needed_qty || 0), 0),
      shortage: src.reduce((s, r) => s + r.net, 0),
      incoming: src.reduce((s, r) => s + (r.incoming_qty || 0), 0),
      critical: src.filter((r) => r.urgency === "critical").length,
    };
  }, [filtered]);

  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const selectedRows = useMemo(
    () => filtered.filter((r) => selected[r.product_id] && r.net > 0),
    [filtered, selected],
  );

  const toggleSelectAllShort = () => {
    const shortRows = filtered.filter((r) => r.net > 0);
    if (shortRows.every((r) => selected[r.product_id])) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      for (const r of shortRows) next[r.product_id] = true;
      setSelected(next);
    }
  };

  const createPOFromSelection = () => {
    const rows = selectedRows.length > 0 ? selectedRows : filtered.filter((r) => r.net > 0);
    if (rows.length === 0) {
      toast.error(ar ? "لا توجد منتجات ناقصة للاختيار" : "No shortage items to order");
      return;
    }
    const prefill: Record<string, number> = {};
    for (const r of rows) prefill[r.product_id] = r.net;
    try {
      localStorage.setItem("po_prefill_v1", JSON.stringify(prefill));
    } catch { /* noop */ }
    toast.success(
      ar
        ? `تم تجهيز ${rows.length} منتج في أمر شراء جديد`
        : `Prepared ${rows.length} product${rows.length === 1 ? "" : "s"} in a new PO`,
    );
    navigate({ to: "/purchase-orders" });
  };

  const openRequest = (
    product_id: string,
    product_name: string,
    quantity: number,
    invoice?: { id: string; number: string },
  ) => {
    setReqTarget({
      product_id,
      product_name,
      invoice_id: invoice?.id,
      invoice_number: invoice?.number,
      quantity,
    });
    setReqQty(Math.max(1, quantity));
    setReqNote("");
  };

  const submitRequest = async () => {
    if (!reqTarget || !user) return;
    if (!Number.isFinite(reqQty) || reqQty <= 0) {
      toast.error(ar ? "الكمية غير صالحة" : "Invalid quantity");
      return;
    }
    setReqSaving(true);
    const { error } = await supabase.from("shortage_requests" as any).insert({
      product_id: reqTarget.product_id,
      invoice_id: reqTarget.invoice_id ?? null,
      quantity: reqQty,
      notes: reqNote || null,
      requested_by: user.id,
    } as any);
    setReqSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(ar ? "تم تسجيل طلب النقص" : "Shortage request logged");
    setReqTarget(null);
    loadRequests();
  };


  const copySummary = async () => {
    const lines = filtered.map((r) => {
      const bits: string[] = [r.product_name];
      if (r.serial_number) bits.push(`SN: ${r.serial_number}`);
      if (r.color) bits.push(r.color);
      if (r.collection) bits.push(r.collection);
      bits.push(`${ar ? "مطلوب" : "Needed"}: ${r.needed_qty}`);
      bits.push(`${ar ? "قادم" : "Incoming"}: ${r.incoming_qty}`);
      bits.push(`${ar ? "نقص" : "Shortage"}: ${r.net}`);
      bits.push(`${ar ? "أقدم فاتورة" : "Oldest"}: ${r.ageDays}${ar ? "ي" : "d"}`);
      return bits.join(" | ");
    });
    await navigator.clipboard.writeText(lines.join("\n"));
    toast.success(ar ? "تم النسخ" : "Copied");
  };

  const downloadCsv = () => {
    const header = ["Product", "Serial", "Color", "Collection", "Stock", "Incoming", "Needed", "Shortage", "Age(days)"];
    const rowsCsv = filtered.map((r) =>
      [
        r.product_name, r.serial_number ?? "", r.color ?? "", r.collection ?? "",
        r.stock_quantity, r.incoming_qty, r.needed_qty, r.net, r.ageDays,
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
    );
    const blob = new Blob([[header.join(","), ...rowsCsv].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-shortages-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 md:space-y-6" dir={ar ? "rtl" : "ltr"}>
      {/* Header (real bordered card, NOT the 1px .gold-hairline utility) */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/25 bg-gradient-to-br from-neutral-950/80 via-neutral-900/80 to-neutral-950/80 p-5 md:p-6 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.7)]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-700/10 border border-amber-500/30 p-2.5 shrink-0">
              <AlertTriangle className="h-6 w-6 text-amber-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-amber-100 truncate">
                {ar ? "تقرير النواقص الذكي" : "Smart Stock Shortages"}
              </h1>
              <p className="text-xs md:text-sm text-amber-100/70 mt-0.5">
                {ar
                  ? "أولوية تلقائية حسب النقص × عمر الفاتورة — اضغط إنشاء أمر شراء لتعبئة المنتجات فورًا."
                  : "Auto-prioritized by shortage × invoice age — click Create PO to prefill items instantly."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {lastLoaded && (
              <span className="text-[11px] text-amber-100/60 tabular-nums">
                {ar ? "آخر تحديث" : "Updated"}: {lastLoaded.toLocaleTimeString(ar ? "ar-EG-u-nu-latn" : "en-GB")}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 me-2 ${loading ? "animate-spin" : ""}`} /> {ar ? "إعادة حساب الآن" : "Recompute now"}
            </Button>
            {isExec && (
              <>
                <Button
                  variant={auditMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAuditMode((v) => !v)}
                  className={auditMode ? "bg-emerald-600 hover:bg-emerald-500 text-white" : ""}
                >
                  <Code2 className="h-4 w-4 me-2" /> {ar ? "وضع التدقيق" : "Audit mode"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate({ to: "/inventory-consistency" })}>
                  <ShieldCheck className="h-4 w-4 me-2" /> {ar ? "فحص الاتساق" : "Consistency"}
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={copySummary} disabled={filtered.length === 0}>
              <Copy className="h-4 w-4 me-2" /> {ar ? "نسخ" : "Copy"}
            </Button>
            <Button variant="outline" size="sm" onClick={downloadCsv} disabled={filtered.length === 0}>
              <Download className="h-4 w-4 me-2" /> CSV
            </Button>
            <Button
              size="sm"
              onClick={createPOFromSelection}
              disabled={filtered.filter((r) => r.net > 0).length === 0}
              className="bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 shadow-md"
            >
              <ShoppingCart className="h-4 w-4 me-2" />
              {selectedRows.length > 0
                ? ar ? `أمر شراء (${selectedRows.length})` : `Create PO (${selectedRows.length})`
                : ar ? "أمر شراء لكل النواقص" : "PO for all shortages"}
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3 mt-5">
          <KPI label={ar ? "منتجات في نقص" : "Products short"} value={totals.lines} tone="amber" />
          <KPI label={ar ? "حرجة (7 أيام+)" : "Critical (7+ days)"} value={totals.critical} tone="red" />
          <KPI label={ar ? "إجمالي المطلوب" : "Total needed"} value={totals.needed} tone="rose" />
          <KPI label={ar ? "قادم في PO" : "Incoming in POs"} value={totals.incoming} tone="emerald" />
          <KPI label={ar ? "نقص فعلي" : "Net shortage"} value={totals.shortage} tone="red" />
        </div>

        {/* Controls */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="h-4 w-4 absolute top-1/2 -translate-y-1/2 start-3 text-amber-200/50" />
            <Input
              className="ps-9 bg-black/40 border-amber-500/25 text-amber-100 placeholder:text-amber-100/40"
              placeholder={ar ? "ابحث بالمنتج، سيريال، لون، فاتورة، عميل…" : "Search product, serial, color, invoice, customer…"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <SegBtn active={urgencyOnly === "all"} onClick={() => setUrgencyOnly("all")}>
            {ar ? "الكل" : "All"}
          </SegBtn>
          <SegBtn active={urgencyOnly === "critical"} onClick={() => setUrgencyOnly("critical")} tone="red">
            <Flame className="h-3.5 w-3.5 me-1" /> {ar ? "حرجة" : "Critical"}
          </SegBtn>
          <SegBtn active={urgencyOnly === "waiting"} onClick={() => setUrgencyOnly("waiting")} tone="amber">
            <Clock className="h-3.5 w-3.5 me-1" /> {ar ? "قيد الانتظار" : "Waiting"}
          </SegBtn>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="text-xs bg-black/40 border border-amber-500/25 rounded-md px-2 py-1.5 text-amber-100 focus:outline-none focus:border-amber-500/60"
          >
            <option value="priority">{ar ? "الأولوية (ذكي)" : "Priority (smart)"}</option>
            <option value="shortage">{ar ? "الأكبر نقصًا" : "Biggest shortage"}</option>
            <option value="oldest">{ar ? "الأقدم فاتورة" : "Oldest invoice"}</option>
            <option value="name">{ar ? "الاسم" : "Name"}</option>
          </select>
          <div className="flex items-center gap-1.5 text-xs text-amber-100">
            <span className="text-amber-100/60">{ar ? "من" : "From"}</span>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 w-[140px] bg-black/40 border-amber-500/25 text-amber-100 [color-scheme:dark]"
            />
            <span className="text-amber-100/60">{ar ? "إلى" : "To"}</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 w-[140px] bg-black/40 border-amber-500/25 text-amber-100 [color-scheme:dark]"
            />
            {(dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setDateFrom(""); setDateTo(""); }}
                className="h-8 px-2 text-amber-300 hover:text-amber-200"
              >
                {ar ? "مسح" : "Clear"}
              </Button>
            )}
          </div>
          {filtered.filter((r) => r.net > 0).length > 0 && (
            <Button variant="ghost" size="sm" onClick={toggleSelectAllShort} className="text-amber-300 hover:text-amber-200">
              {selectedIds.length > 0 && filtered.filter((r) => r.net > 0).every((r) => selected[r.product_id])
                ? <><CheckSquare className="h-4 w-4 me-1.5" />{ar ? "إلغاء التحديد" : "Clear selection"}</>
                : <><Square className="h-4 w-4 me-1.5" />{ar ? "تحديد الكل" : "Select all"}</>}
            </Button>
          )}
        </div>

        {/* Invoice-status audit filters */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-500/15 bg-black/20 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-amber-500/70 font-semibold">
            {ar ? "فلترة/تدقيق حالة الفواتير" : "Invoice status audit"}
          </span>
          <FilterChipGroup
            label={ar ? "المالية" : "Financial"}
            options={[
              { key: "pending", label: ar ? "معلقة" : "Pending" },
              { key: "completed", label: ar ? "مكتملة" : "Completed" },
              { key: "paid", label: ar ? "مدفوعة" : "Paid" },
            ]}
            active={statusFilters}
            onToggle={(k) => setStatusFilters((prev) => {
              const next = new Set(prev);
              if (next.has(k)) next.delete(k); else next.add(k);
              return next;
            })}
          />
          <FilterChipGroup
            label={ar ? "التسليم" : "Delivery"}
            options={[
              { key: "pending", label: ar ? "لم يبدأ" : "Not started" },
              { key: "partial", label: ar ? "جزئي" : "Partial" },
              { key: "delivered", label: ar ? "مسلّم بالكامل" : "Delivered" },
            ]}
            active={deliveryFilters}
            onToggle={(k) => setDeliveryFilters((prev) => {
              const next = new Set(prev);
              if (next.has(k)) next.delete(k); else next.add(k);
              return next;
            })}
          />
          <label className="inline-flex items-center gap-1.5 text-xs text-amber-100/80 cursor-pointer">
            <input
              type="checkbox"
              checked={includeAwaiting}
              onChange={(e) => setIncludeAwaiting(e.target.checked)}
              className="accent-amber-500"
            />
            {ar ? "أظهر أيضًا المنتجات المغطاة بالقادم فقط" : "Include awaiting-arrival items"}
          </label>
          {(statusFilters.size > 0 || deliveryFilters.size > 0 || includeAwaiting) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setStatusFilters(new Set()); setDeliveryFilters(new Set()); setIncludeAwaiting(false); }}
              className="h-7 px-2 text-amber-300 hover:text-amber-200"
            >
              {ar ? "إعادة ضبط" : "Reset"}
            </Button>
          )}
        </div>
      </div>


      {/* Body */}
      {loading && !rows ? (
        <SkeletonBlock ar={ar} />
      ) : filtered.length === 0 ? (
        <EmptyState ar={ar} />
      ) : (
        <div className="space-y-6">
          {grouped.map(([groupName, groupRows]) => (
            <section key={groupName} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className="text-[11px] uppercase tracking-[0.2em] text-amber-500/70 font-semibold">
                  {groupName}
                </span>
                <span className="h-px flex-1 bg-gradient-to-r from-amber-500/40 to-transparent" />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {groupRows.length} {ar ? "منتج" : groupRows.length === 1 ? "item" : "items"}
                </span>
              </div>
              <div className="space-y-2.5">
                {groupRows.map((r) => (
                  <ShortageCard
                    key={r.product_id}
                    row={r}
                    ar={ar}
                    isOpen={!!expanded[r.product_id]}
                    onToggle={() => setExpanded((p) => ({ ...p, [r.product_id]: !p[r.product_id] }))}
                    selected={!!selected[r.product_id]}
                    onSelectChange={(v) => setSelected((p) => ({ ...p, [r.product_id]: v }))}
                    openRequests={openReqs[r.product_id] ?? 0}
                    onRequest={(inv) => openRequest(r.product_id, r.product_name, r.net, inv)}
                    auditMode={auditMode}
                    raw={rawById[r.product_id]}
                  />
                ))}

              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={!!reqTarget} onOpenChange={(v) => { if (!v) setReqTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-200">
              <ClipboardList className="h-5 w-5" />
              {ar ? "طلب الكمية الناقصة" : "Request missing quantity"}
            </DialogTitle>
            <DialogDescription>
              {ar
                ? "سجّل طلبًا واضحًا للكمية الناقصة مع ربطه بالفاتورة لمتابعته في تقرير النواقص."
                : "Log a clear request for the missing quantity, linked to its invoice for follow-up."}
            </DialogDescription>
          </DialogHeader>
          {reqTarget && (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm">
                <div className="text-[10px] uppercase tracking-wider text-amber-500/80">
                  {ar ? "المنتج" : "Product"}
                </div>
                <div className="mt-0.5 font-semibold text-amber-100">{reqTarget.product_name}</div>
                {reqTarget.invoice_number && (
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    {ar ? "مرتبطة بالفاتورة" : "Linked invoice"}:{" "}
                    <span className="font-mono text-amber-300">{reqTarget.invoice_number}</span>
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {ar ? "الكمية المطلوبة" : "Requested quantity"}
                </label>
                <Input
                  type="number"
                  min={1}
                  value={reqQty}
                  onChange={(e) => setReqQty(Math.max(0, parseInt(e.target.value || "0", 10)))}
                  className="mt-1 tabular-nums"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {ar ? "ملاحظات (اختياري)" : "Notes (optional)"}
                </label>
                <Textarea
                  rows={3}
                  value={reqNote}
                  onChange={(e) => setReqNote(e.target.value)}
                  placeholder={ar ? "مثال: عاجل — العميل ينتظر التسليم…" : "e.g. urgent — customer awaiting delivery…"}
                  className="mt-1"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReqTarget(null)}>
              {ar ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={submitRequest}
              disabled={reqSaving || reqQty <= 0}
              className="bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500"
            >
              <Send className="h-4 w-4 me-2" />
              {ar ? "تسجيل الطلب" : "Submit request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function ShortageCard({
  row, ar, isOpen, onToggle, selected, onSelectChange, openRequests, onRequest,
}: {
  row: ShortageRow & { net: number; ageDays: number; urgency: "critical" | "waiting" | "covered" };
  ar: boolean;
  isOpen: boolean;
  onToggle: () => void;
  selected: boolean;
  onSelectChange: (v: boolean) => void;
  openRequests: number;
  onRequest: (invoice?: { id: string; number: string }) => void;
}) {

  const urgencyRing =
    row.urgency === "critical"
      ? "border-red-500/40 bg-red-500/[0.03] hover:border-red-500/60"
      : row.urgency === "waiting"
        ? "border-amber-500/25 hover:border-amber-500/50"
        : "border-emerald-500/25 hover:border-emerald-500/40";

  return (
    <div className={`relative overflow-hidden rounded-2xl border p-3 md:p-4 bg-gradient-to-br from-neutral-950/95 via-neutral-900/95 to-neutral-950/95 backdrop-blur-sm transition-colors ${urgencyRing}`}>
      {row.urgency === "critical" && (
        <span className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-red-500/70 to-transparent" />
      )}
      <div className="flex items-start gap-3 md:gap-4">
        {row.net > 0 && (
          <button
            aria-label="select"
            onClick={() => onSelectChange(!selected)}
            className="mt-1 shrink-0 text-amber-400/80 hover:text-amber-300"
          >
            {selected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
          </button>
        )}
        {row.image_url ? (
          <img
            src={row.image_url}
            alt=""
            loading="lazy"
            className="h-16 w-16 md:h-20 md:w-20 rounded-lg object-cover border border-amber-500/20 shrink-0"
          />
        ) : (
          <div className="h-16 w-16 md:h-20 md:w-20 rounded-lg border border-amber-500/20 flex items-center justify-center text-muted-foreground bg-black/30 shrink-0">
            <Package className="h-7 w-7" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-amber-100 truncate">{row.product_name}</div>
              <div className="text-xs text-amber-100/60 mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                {row.serial_number && <span className="tabular-nums">SN: {row.serial_number}</span>}
                {row.color && <span>{row.color}</span>}
                {row.is_spare_part && (
                  <span className="px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-300">
                    {ar ? "قطعة غيار" : "Spare part"}
                  </span>
                )}
                <UrgencyBadge urgency={row.urgency} ageDays={row.ageDays} ar={ar} />
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              <Chip label={ar ? "المخزون" : "Stock"} value={row.stock_quantity} tone="slate" />
              <Chip label={ar ? "قادم" : "Incoming"} value={row.incoming_qty} tone="emerald" icon={<TruckIcon className="h-3 w-3" />} />
              <Chip label={ar ? "مطلوب" : "Needed"} value={row.needed_qty} tone="amber" />
              <Chip label={ar ? "نقص" : "Short"} value={row.net} tone={row.net > 0 ? "red" : "emerald"} bold />
              {openRequests > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[11px] font-semibold text-sky-300">
                  <ClipboardList className="h-3 w-3" />
                  {ar ? `طلبات مفتوحة: ${openRequests}` : `Open reqs: ${openRequests}`}
                </span>
              )}
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <button
              className="text-xs text-amber-400 hover:text-amber-300 inline-flex items-center gap-1"
              onClick={onToggle}
            >
              {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {isOpen
                ? ar ? "إخفاء الفواتير" : "Hide invoices"
                : ar ? `عرض ${row.invoices.length} فاتورة` : `Show ${row.invoices.length} invoice${row.invoices.length === 1 ? "" : "s"}`}
            </button>
            {row.net > 0 && (
              <button
                onClick={() => onRequest()}
                className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/5 px-2.5 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/10"
              >
                <Send className="h-3 w-3" />
                {ar ? `طلب الكمية الناقصة (${row.net})` : `Request missing qty (${row.net})`}
              </button>
            )}
          </div>


          {isOpen && (() => {
            const totalAcross = row.invoices.reduce((s, i) => s + (i.quantity || 0), 0);
            return (
              <div className="mt-2 rounded-lg border border-amber-500/15 overflow-hidden">
                {/* Header with grand total across all invoices */}
                <div className="flex items-center justify-between gap-3 px-3 py-2 bg-amber-500/5 border-b border-amber-500/15">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-amber-400/80 font-semibold">
                    {ar ? "الإجمالي عبر كل الفواتير" : "Total across all invoices"}
                  </div>
                  <div className="text-sm font-bold text-amber-100 tabular-nums">
                    {totalAcross} {ar ? "قطعة" : totalAcross === 1 ? "unit" : "units"}
                    <span className="text-[11px] text-amber-100/50 font-normal ms-2">
                      · {row.invoices.length} {ar ? "فاتورة" : row.invoices.length === 1 ? "invoice" : "invoices"}
                    </span>
                  </div>
                </div>
                <div className="divide-y divide-amber-500/10">
                  {row.invoices.map((inv) => (
                    <div
                      key={inv.invoice_id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-amber-500/5"
                    >
                      <Link
                        to="/invoices/$id"
                        params={{ id: inv.invoice_id }}
                        className="min-w-0 flex-1"
                      >
                        <div className="font-medium text-amber-100 truncate">{inv.invoice_number}</div>
                        <div className="text-xs text-amber-100/60 truncate">
                          {inv.customer_name ?? (ar ? "بدون عميل" : "No customer")} ·{" "}
                          {new Date(inv.created_at).toLocaleDateString(ar ? "ar-EG-u-nu-latn" : "en-GB")}
                        </div>
                      </Link>
                      <div className="text-end shrink-0">
                        <div className="font-semibold text-rose-300 tabular-nums">
                          {inv.quantity} {ar ? "قطعة" : inv.quantity === 1 ? "unit" : "units"}
                        </div>
                        <div className="mt-0.5 flex items-center justify-end gap-1">
                          <span className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 border border-amber-500/25 text-amber-200/80 bg-amber-500/5">
                            {inv.status || "—"}
                          </span>
                          <DeliveryStatusBadge status={inv.delivery_status} ar={ar} />
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          onRequest({ id: inv.invoice_id, number: inv.invoice_number })
                        }
                        title={ar ? "طلب الكمية لهذه الفاتورة" : "Request qty for this invoice"}
                        className="shrink-0 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/20 inline-flex items-center gap-1"
                      >
                        <Send className="h-3 w-3" />
                        {ar ? "طلب" : "Request"}
                      </button>
                    </div>
                  ))}
                </div>
                {/* Footer echo for long lists */}
                {row.invoices.length > 4 && (
                  <div className="flex items-center justify-between gap-3 px-3 py-2 bg-amber-500/[0.04] border-t border-amber-500/15 text-xs">
                    <span className="text-amber-100/60">{ar ? "المجموع" : "Sum"}</span>
                    <span className="font-bold text-amber-100 tabular-nums">
                      {totalAcross} {ar ? "قطعة" : totalAcross === 1 ? "unit" : "units"}
                    </span>
                  </div>
                )}
                {/* Coverage breakdown */}
                <div className="px-3 py-2 border-t border-amber-500/15 bg-black/20 text-[11px] text-amber-100/80 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{ar ? "تغطية من المخزون:" : "From stock:"} <b className="text-emerald-300 tabular-nums">{row.from_stock}</b></span>
                  <span>{ar ? "من الشحنات القادمة:" : "From incoming:"} <b className="text-blue-300 tabular-nums">{row.from_incoming}</b></span>
                  <span>{ar ? "نقص صافي:" : "Net short:"} <b className={`tabular-nums ${row.net_shortage > 0 ? "text-red-300" : "text-emerald-300"}`}>{row.net_shortage}</b></span>
                </div>
                {row.incoming_pos.length > 0 && (
                  <div className="border-t border-amber-500/15 bg-blue-500/[0.03]">
                    <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-blue-300/80 font-semibold border-b border-blue-500/15">
                      {ar ? "أوامر شراء قادمة تغطي هذا المنتج" : "Incoming POs covering this item"}
                    </div>
                    <div className="divide-y divide-blue-500/10">
                      {row.incoming_pos.map((po) => (
                        <div key={po.po_id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-blue-100 truncate">
                              {po.po_number}
                              {po.shipment_code && <span className="ms-2 text-blue-100/50">· {po.shipment_code}</span>}
                            </div>
                            <div className="text-[10px] text-blue-100/60 truncate">
                              {po.supplier_name ?? "—"}
                              {po.expected_arrival_at && ` · ETA ${new Date(po.expected_arrival_at).toLocaleDateString(ar ? "ar-EG-u-nu-latn" : "en-GB")}`}
                              <span className="ms-1 uppercase">· {po.status}</span>
                            </div>
                          </div>
                          <div className="text-end shrink-0 font-semibold text-blue-200 tabular-nums">
                            +{po.qty}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}


        </div>
      </div>
    </div>
  );
}

function DeliveryStatusBadge({ status, ar }: { status: string | null; ar: boolean }) {
  const s = (status || "pending").toLowerCase();
  const meta =
    s === "delivered" || s === "completed"
      ? { cls: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10", label: ar ? "مسلّم" : "Delivered" }
      : s === "partial"
      ? { cls: "border-amber-500/40 text-amber-300 bg-amber-500/10", label: ar ? "جزئي" : "Partial" }
      : { cls: "border-slate-500/40 text-slate-300 bg-slate-500/10", label: ar ? "لم يبدأ" : "Pending" };
  return (
    <span className={`text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 border ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function UrgencyBadge({
  urgency, ageDays, ar,
}: { urgency: "critical" | "waiting" | "covered"; ageDays: number; ar: boolean }) {
  if (urgency === "critical") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/40 text-red-300">
        <Flame className="h-3 w-3" />
        {ar ? `عاجل · ${ageDays} يوم` : `Critical · ${ageDays}d`}
      </span>
    );
  }
  if (urgency === "waiting") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">
        <Clock className="h-3 w-3" />
        {ar ? `منتظر · ${ageDays} يوم` : `Waiting · ${ageDays}d`}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
      {ar ? "مغطى" : "Covered"}
    </span>
  );
}

function FilterChipGroup({
  label, options, active, onToggle,
}: {
  label: string;
  options: { key: string; label: string }[];
  active: Set<string>;
  onToggle: (k: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] uppercase tracking-wider text-amber-100/50 me-1">{label}:</span>
      {options.map((o) => {
        const on = active.has(o.key);
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onToggle(o.key)}
            className={`px-2 py-0.5 rounded-md border text-[11px] transition ${
              on
                ? "bg-amber-500/15 border-amber-500/50 text-amber-100"
                : "border-amber-500/20 text-amber-100/60 hover:border-amber-500/40 hover:text-amber-100"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function KPI({ label, value, tone }: { label: string; value: number; tone: "amber" | "rose" | "emerald" | "red" }) {
  const toneMap: Record<string, string> = {
    amber: "text-amber-300 border-amber-500/25 bg-amber-500/5",
    rose: "text-rose-300 border-rose-500/25 bg-rose-500/5",
    emerald: "text-emerald-300 border-emerald-500/25 bg-emerald-500/5",
    red: "text-red-400 border-red-500/30 bg-red-500/5",
  };
  return (
    <div className={`rounded-xl border p-3 ${toneMap[tone]}`}>
      <div className="text-[10px] md:text-[11px] uppercase tracking-wider opacity-80 truncate">{label}</div>
      <div className="text-xl md:text-2xl font-bold mt-1 tabular-nums">{value.toLocaleString("en-GB")}</div>
    </div>
  );
}

function Chip({
  label, value, tone, icon, bold,
}: {
  label: string; value: number; tone: "slate" | "emerald" | "amber" | "red";
  icon?: React.ReactNode; bold?: boolean;
}) {
  const toneMap: Record<string, string> = {
    slate: "border-slate-500/30 text-slate-200 bg-slate-500/5",
    emerald: "border-emerald-500/30 text-emerald-300 bg-emerald-500/5",
    amber: "border-amber-500/30 text-amber-300 bg-amber-500/5",
    red: "border-red-500/40 text-red-300 bg-red-500/10",
  };
  return (
    <div className={`px-2 py-1 rounded-md border text-xs flex items-center gap-1 ${toneMap[tone]}`}>
      {icon}
      <span className="text-[10px] uppercase tracking-wider opacity-80">{label}</span>
      <span className={`tabular-nums ${bold ? "font-bold" : "font-semibold"}`}>{value.toLocaleString("en-GB")}</span>
    </div>
  );
}

function SegBtn({
  active, onClick, children, tone,
}: {
  active: boolean; onClick: () => void; children: React.ReactNode;
  tone?: "red" | "amber";
}) {
  const activeClasses =
    tone === "red"
      ? "bg-red-500/15 border-red-500/50 text-red-300"
      : tone === "amber"
        ? "bg-amber-500/15 border-amber-500/50 text-amber-200"
        : "bg-amber-500/15 border-amber-500/50 text-amber-100";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center px-2.5 py-1.5 rounded-md text-xs border transition ${
        active ? activeClasses : "border-amber-500/20 text-amber-100/70 hover:border-amber-500/40 hover:text-amber-100"
      }`}
    >
      {children}
    </button>
  );
}

function SkeletonBlock({ ar }: { ar: boolean }) {
  return (
    <div className="rounded-2xl border border-amber-500/20 bg-neutral-950/40 p-10 text-center text-muted-foreground">
      {ar ? "جاري التحميل…" : "Loading…"}
    </div>
  );
}

function EmptyState({ ar }: { ar: boolean }) {
  return (
    <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-950/30 to-neutral-950/40 p-10 text-center">
      <Package className="h-10 w-10 mx-auto mb-3 text-emerald-400" />
      <div className="font-semibold text-emerald-100">
        {ar ? "لا يوجد نواقص" : "No shortages"}
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {ar
          ? "كل الفواتير المفتوحة مغطاة بالمخزون أو بأوامر الشراء الحالية."
          : "Every open invoice is covered by stock or an existing PO."}
      </div>
    </div>
  );
}
