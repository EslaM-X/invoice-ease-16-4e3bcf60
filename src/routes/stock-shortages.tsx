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
  ClipboardList, Send,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";


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
  net_shortage: number;
  invoices: ShortageInvoice[];
};

type SortKey = "priority" | "shortage" | "oldest" | "name";

const dayMs = 1000 * 60 * 60 * 24;

function StockShortagesPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const navigate = useNavigate();

  const [rows, setRows] = useState<ShortageRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [sortBy, setSortBy] = useState<SortKey>("priority");
  const [urgencyOnly, setUrgencyOnly] = useState<"all" | "critical" | "waiting">("all");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_stock_shortages" as any);
    if (error) {
      toast.error(error.message);
      setRows([]);
    } else {
      setRows((data as any) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  useBatchedRealtimeTables(
    ["invoice_po_reservations", "purchase_order_items", "products"],
    () => load(),
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
      const net = Math.max(0, r.needed_qty - r.incoming_qty);
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
  }, [enriched, q, sortBy, urgencyOnly]);

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
              <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
                {ar
                  ? "أولوية تلقائية حسب النقص × عمر الفاتورة — اضغط إنشاء أمر شراء لتعبئة المنتجات فورًا."
                  : "Auto-prioritized by shortage × invoice age — click Create PO to prefill items instantly."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="h-4 w-4 me-2" /> {ar ? "تحديث" : "Refresh"}
            </Button>
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
            <Search className="h-4 w-4 absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
            <Input
              className="ps-9"
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
          {filtered.filter((r) => r.net > 0).length > 0 && (
            <Button variant="ghost" size="sm" onClick={toggleSelectAllShort} className="text-amber-300 hover:text-amber-200">
              {selectedIds.length > 0 && filtered.filter((r) => r.net > 0).every((r) => selected[r.product_id])
                ? <><CheckSquare className="h-4 w-4 me-1.5" />{ar ? "إلغاء التحديد" : "Clear selection"}</>
                : <><Square className="h-4 w-4 me-1.5" />{ar ? "تحديد الكل" : "Select all"}</>}
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
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ShortageCard({
  row, ar, isOpen, onToggle, selected, onSelectChange,
}: {
  row: ShortageRow & { net: number; ageDays: number; urgency: "critical" | "waiting" | "covered" };
  ar: boolean;
  isOpen: boolean;
  onToggle: () => void;
  selected: boolean;
  onSelectChange: (v: boolean) => void;
}) {
  const urgencyRing =
    row.urgency === "critical"
      ? "border-red-500/40 bg-red-500/[0.03] hover:border-red-500/60"
      : row.urgency === "waiting"
        ? "border-amber-500/25 hover:border-amber-500/50"
        : "border-emerald-500/25 hover:border-emerald-500/40";

  return (
    <div className={`relative overflow-hidden rounded-2xl border p-3 md:p-4 bg-neutral-950/40 backdrop-blur-sm transition-colors ${urgencyRing}`}>
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
              <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
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
            </div>
          </div>

          <button
            className="mt-2.5 text-xs text-amber-400 hover:text-amber-300 inline-flex items-center gap-1"
            onClick={onToggle}
          >
            {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {isOpen
              ? ar ? "إخفاء الفواتير" : "Hide invoices"
              : ar ? `عرض ${row.invoices.length} فاتورة` : `Show ${row.invoices.length} invoice${row.invoices.length === 1 ? "" : "s"}`}
          </button>

          {isOpen && (
            <div className="mt-2 rounded-lg border border-amber-500/15 divide-y divide-amber-500/10 overflow-hidden">
              {row.invoices.map((inv) => (
                <Link
                  key={inv.invoice_id}
                  to="/invoices/$id"
                  params={{ id: inv.invoice_id }}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-amber-500/5"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-amber-100 truncate">{inv.invoice_number}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {inv.customer_name ?? (ar ? "بدون عميل" : "No customer")} ·{" "}
                      {new Date(inv.created_at).toLocaleDateString(ar ? "ar-EG-u-nu-latn" : "en-GB")}
                    </div>
                  </div>
                  <div className="text-end shrink-0">
                    <div className="font-semibold text-rose-300 tabular-nums">
                      {inv.quantity} {ar ? "قطعة" : inv.quantity === 1 ? "unit" : "units"}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{inv.status}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
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

function KPI({ label, value, tone }: { label: string; value: number; tone: "amber" | "rose" | "emerald" | "red" }) {
  const toneMap: Record<string, string> = {
    amber: "text-amber-300 border-amber-500/25 bg-amber-500/5",
    rose: "text-rose-300 border-rose-500/25 bg-rose-500/5",
    emerald: "text-emerald-300 border-emerald-500/25 bg-emerald-500/5",
    red: "text-red-400 border-red-500/30 bg-red-500/5",
  };
  return (
    <div className={`rounded-xl border p-3 ${toneMap[tone]}`}>
      <div className="text-[10px] md:text-[11px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
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
        active ? activeClasses : "border-amber-500/15 text-muted-foreground hover:border-amber-500/30 hover:text-amber-200"
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
