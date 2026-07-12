import { swatchStyle } from "@/lib/color-swatch";
import { ColorSwatch } from "@/components/color-swatch";
import { createFileRoute } from "@tanstack/react-router";
import React, { Fragment, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable, useBatchedRealtimeTables } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtMoney, fmtNumber, fmtDate } from "@/lib/utils-money";
import { collectionBadgeClass, collectionDotClass } from "@/lib/collection-styles";
import { toast } from "sonner";
import { Download, Save, TrendingUp, TrendingDown, Minus, Flame, Wallet, Coins, Percent, RefreshCw, History, Info, ChevronDown, ChevronUp, Undo2, X, Filter, BookOpen, Layers, ShieldCheck, Receipt, Clock, AlertTriangle, Sparkles, ArrowRight, Truck, Ban, Divide, Calculator, LineChart as LineChartIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { List, type RowComponentProps } from "react-window";

import type { Product } from "@/lib/data";
import { summarizeProduct, summarizeMany, sortLotsByDateDesc, filterLots, type PoCostLot } from "@/lib/po-cost-history";
import { useRole } from "@/lib/use-role";

type CostSource = "wac" | "latest_po" | "current" | "override";

type CostBookLot = {
  po_id: string;
  shipment_code: string | null;
  shipment_date: string | null;
  status: string;
  qty: number;
  unit_usd: number;
  usd_rate: number;
  unit_egp: number;
  line_total_egp: number;
};
type CostBookEntry = {
  total_qty: number;
  wac_usd: number;
  wac_egp: number;
  min_usd: number;
  max_usd: number;
  latest_usd: number;
  latest_egp: number;
  lots: CostBookLot[];
};
type CostBook = {
  default_rate: number;
  products: Record<string, CostBookEntry>;
};

type Range = "day" | "month" | "year" | "all" | "custom";

type RawItem = {
  invoice_id: string;
  product_id: string | null;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  line_total: number;
  invoices: {
    invoice_number: string;
    status: string;
    created_at: string;
    customer_name: string | null;
    subtotal: number;
    discount: number;
    total: number;
  } | null;
};

const SHIPPING_NAMES = new Set([
  "رسوم شحن",
  "رسوم خدمة / Service Fee",
  "رسوم خدمة",
  "Service Fee",
]);
const isShippingLine = (it: { product_id: string | null; product_name: string }) =>
  it.product_id === null && SHIPPING_NAMES.has(it.product_name);

function rangeBounds(r: Range, day: string, month: string, year: string, from: string, to: string) {
  const now = new Date();
  if (r === "all") return { startISO: null, endISO: null };
  if (r === "day") {
    const d = new Date(day || now.toISOString().slice(0, 10));
    const s = new Date(d); s.setHours(0, 0, 0, 0);
    const e = new Date(s); e.setDate(e.getDate() + 1);
    return { startISO: s.toISOString(), endISO: e.toISOString() };
  }
  if (r === "month") {
    const [y, m] = (month || now.toISOString().slice(0, 7)).split("-").map(Number);
    const s = new Date(y, m - 1, 1);
    const e = new Date(y, m, 1);
    return { startISO: s.toISOString(), endISO: e.toISOString() };
  }
  if (r === "year") {
    const y = Number(year || now.getFullYear());
    return { startISO: new Date(y, 0, 1).toISOString(), endISO: new Date(y + 1, 0, 1).toISOString() };
  }
  // custom
  const s = new Date((from || now.toISOString().slice(0, 10)) + "T00:00:00");
  const e = new Date((to || now.toISOString().slice(0, 10)) + "T00:00:00");
  e.setDate(e.getDate() + 1);
  return { startISO: s.toISOString(), endISO: e.toISOString() };
}

// ---- Virtualized invoice row (react-window) ----
type InvVRow = {
  invoice_id: string;
  invoice_number: string;
  created_at: string;
  customer_name: string | null;
  status: string;
  revenue: number;
  cost: number;
  items: number;
  profit: number;
  margin: number;
};
type InvVProps = {
  rows: InvVRow[];
  lang: "ar" | "en";
  t: (ar: string, en: string) => string;
  maxAbs: number;
  onOpen: (id: string) => void;
  medalOf: (i: number) => { label: string; cls: string } | null;
  toneOf: (m: number) => { text: string; bar: string };
  MarginPillCmp: (p: { margin: number; size?: "xs" | "sm" | "md" }) => React.ReactNode;
};
const INV_GRID_COLS = "48px minmax(120px,1fr) minmax(110px,1fr) minmax(160px,1.4fr) 80px minmax(120px,1fr) minmax(120px,1fr) minmax(180px,1.4fr) minmax(130px,1fr)";
function VirtualInvoiceRow({
  index,
  style,
  ariaAttributes,
  rows,
  lang,
  t,
  maxAbs,
  onOpen,
  medalOf,
  toneOf,
  MarginPillCmp,
}: RowComponentProps<InvVProps>) {
  const r = rows[index];
  if (!r) return null;
  const medal = medalOf(index);
  const isTop = medal !== null;
  const profitBarPct = Math.min(100, (Math.abs(r.profit) / Math.max(1, maxAbs)) * 100);
  const marginPct = Math.max(0, Math.min(100, r.margin));
  const mt = toneOf(r.margin);
  return (
    <div
      style={{ ...style, gridTemplateColumns: INV_GRID_COLS }}
      {...ariaAttributes}
      onClick={() => onOpen(r.invoice_id)}
      className={`grid items-center cursor-pointer transition-colors duration-200 hover:bg-primary/[0.04] ${r.profit < 0 ? "bg-rose-500/[0.03]" : ""} ${isTop ? "bg-gradient-to-r from-amber-500/[0.04] via-transparent to-transparent" : ""}`}
      title={t("عرض تفاصيل الحساب", "Show calculation details")}
    >
      <div className="px-3 py-3 text-center">
        {medal ? (
          <div className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black ${medal.cls}`}>{medal.label}</div>
        ) : (
          <span className="text-[11px] text-muted-foreground/60 tabular-nums font-mono">{index + 1}</span>
        )}
      </div>
      <div className="px-3 py-3">
        <div className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-primary underline-offset-2 hover:underline">
          <Receipt className="h-3.5 w-3.5 opacity-70" />
          {r.invoice_number}
        </div>
      </div>
      <div className="px-3 py-3">
        <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span className="tabular-nums">{fmtDate(r.created_at, lang)}</span>
        </div>
      </div>
      <div className="px-3 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
            {(r.customer_name ?? "?").trim().charAt(0).toUpperCase() || "?"}
          </div>
          <span className="truncate text-sm">{r.customer_name ?? "—"}</span>
        </div>
      </div>
      <div className="px-3 py-3 text-end tabular-nums">
        <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-xs font-semibold">{fmtNumber(r.items, lang)}</span>
      </div>
      <div className="px-3 py-3 text-end tabular-nums font-medium">{fmtMoney(r.revenue, "EGP", lang)}</div>
      <div className="px-3 py-3 text-end tabular-nums text-muted-foreground">{fmtMoney(r.cost, "EGP", lang)}</div>
      <div className="px-3 py-3 text-end">
        <div className="flex flex-col items-end gap-1">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums border ${r.profit >= 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" : "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30"}`}>
            {r.profit >= 0 ? <TrendingUp className="h-3 w-3" /> : <ArrowRight className="h-3 w-3 rotate-90" />}
            {fmtMoney(r.profit, "EGP", lang)}
          </span>
          <div className="w-24 h-1 rounded-full bg-muted/50 overflow-hidden">
            <div className={`h-full ${r.profit >= 0 ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : "bg-gradient-to-r from-rose-600 to-rose-400"}`} style={{ width: `${profitBarPct}%` }} />
          </div>
        </div>
      </div>
      <div className="px-3 py-3 text-end">
        <div className="flex flex-col items-end gap-1">
          <MarginPillCmp margin={r.margin} size="sm" />
          <div className="w-20 h-1 rounded-full bg-muted/50 overflow-hidden">
            <div className={`h-full ${mt.bar}`} style={{ width: `${marginPct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}



function ProfitsPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<RawItem[]>([]);
  const [loading, setLoading] = useState(false);

  // ==== Realtime pause + perf metrics ====
  const [rtPaused, setRtPaused] = useState(false);
  const rtPausedRef = React.useRef(false);
  rtPausedRef.current = rtPaused;
  const [rtPending, setRtPending] = useState<Set<string>>(new Set());
  const [showPerf, setShowPerf] = useState(false);
  const renderCountRef = React.useRef(0);
  renderCountRef.current += 1;
  const renderStartRef = React.useRef<number>(typeof performance !== "undefined" ? performance.now() : 0);
  renderStartRef.current = typeof performance !== "undefined" ? performance.now() : 0;
  const [lastRenderMs, setLastRenderMs] = useState(0);
  const [avgRenderMs, setAvgRenderMs] = useState(0);
  const renderSumRef = React.useRef(0);
  const [updateCount, setUpdateCount] = useState(0);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const bumpUpdate = React.useCallback(() => {
    setUpdateCount((n) => n + 1);
    setLastUpdateAt(Date.now());
  }, []);
  const lastPerfFlushRef = React.useRef(0);
  useEffect(() => {
    if (typeof performance === "undefined") return;
    const ms = performance.now() - renderStartRef.current;
    renderSumRef.current += ms;
    if (!showPerf) return;
    const now = performance.now();
    if (now - lastPerfFlushRef.current < 1000) return;
    lastPerfFlushRef.current = now;
    setLastRenderMs(ms);
    setAvgRenderMs(renderSumRef.current / Math.max(1, renderCountRef.current));
  });


  const [range, setRange] = useState<Range>("all");
  const today = new Date().toISOString().slice(0, 10);
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [editing, setEditing] = useState<Record<string, { cost: string; sale: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [historyOpen, setHistoryOpen] = useState<Product | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [chartView, setChartView] = useState<"profit" | "all">("profit");
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerCollections, setPickerCollections] = useState<Set<string>>(new Set());
  const [pickerColors, setPickerColors] = useState<Set<string>>(new Set());
  const [cbSort, setCbSort] = useState<"qty" | "cost" | "recent" | "name">("qty");

  // ---- Weighted-Average Cost engine ----
  const { isAdmin } = useRole();
  const [costSource, setCostSource] = useState<CostSource>("wac");
  const [fyYear, setFyYear] = useState<string>("all"); // "all" or year like "2026"
  const [costBook, setCostBook] = useState<CostBook>({ default_rate: 50, products: {} });
  const [overrides, setOverrides] = useState<Record<string, { cost_egp: number; note: string | null }>>({});
  const [costBookOpen, setCostBookOpen] = useState(false);
  const [costBookSearch, setCostBookSearch] = useState("");
  const [expandedCB, setExpandedCB] = useState<Record<string, boolean>>({});
  const [ovDraft, setOvDraft] = useState<Record<string, string>>({});
  const [savingOv, setSavingOv] = useState<string | null>(null);
  const [ovHistoryOpen, setOvHistoryOpen] = useState<Product | null>(null);
  const [ovHistory, setOvHistory] = useState<any[]>([]);
  const [ovHistoryLoading, setOvHistoryLoading] = useState(false);
  const [ovRevertingId, setOvRevertingId] = useState<string | null>(null);
  const [invoiceDetailOpen, setInvoiceDetailOpen] = useState<string | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  // Product table filters
  const [ptSearch, setPtSearch] = useState("");
  const [ptSort, setPtSort] = useState<{ field: "profit" | "qty" | "margin" | "name"; dir: "asc" | "desc" }>({ field: "profit", dir: "desc" });
  const [productDetailId, setProductDetailId] = useState<string | null>(null);
  // Invoice table filters
  const [invSearch, setInvSearch] = useState("");
  const [invFrom, setInvFrom] = useState("");
  const [invTo, setInvTo] = useState("");
  const [invStatus, setInvStatus] = useState<string>("all");
  const [invTrendMode, setInvTrendMode] = useState<"day" | "week">("day");
  const [invPageSize, setInvPageSize] = useState(25);
  const [invCustomerSuggestOpen, setInvCustomerSuggestOpen] = useState(false);
  const [invCustomerHighlight, setInvCustomerHighlight] = useState(0);
  // Reset visible page window when filters change
  useEffect(() => { setInvPageSize(25); }, [invSearch, invFrom, invTo, invStatus]);
  // Product-detail Sheet filters
  const [sheetSearch, setSheetSearch] = useState("");
  const [sheetFrom, setSheetFrom] = useState("");
  const [sheetTo, setSheetTo] = useState("");
  const [sheetStatus, setSheetStatus] = useState<string>("all");
  // Reset sheet filters when product changes
  useEffect(() => { setSheetSearch(""); setSheetFrom(""); setSheetTo(""); setSheetStatus("all"); }, [productDetailId]);

  // Shared margin pill: gradient + icon + click popover explanation
  const MarginPill = ({ margin, size = "sm" }: { margin: number; size?: "xs" | "sm" | "md" }) => {
    const tier = margin >= 40 ? "high" : margin >= 20 ? "good" : margin >= 0 ? "low" : "loss";
    const conf = {
      high: { label: t("مرتفع", "High"), icon: Flame, wrap: "border-emerald-500/40 bg-gradient-to-r from-emerald-500/15 via-emerald-500/10 to-transparent text-emerald-700 dark:text-emerald-300", note: t("هامش ممتاز (≥ 40٪) — منتج مربح بقوة.", "Excellent margin (≥ 40%) — a very profitable line.") },
      good: { label: t("جيد", "Good"), icon: TrendingUp, wrap: "border-amber-500/40 bg-gradient-to-r from-amber-500/15 via-yellow-500/10 to-transparent text-amber-700 dark:text-amber-300", note: t("هامش جيد (20–40٪) — ربحية صحية.", "Healthy margin (20–40%).") },
      low:  { label: t("منخفض", "Low"),  icon: Minus,      wrap: "border-orange-500/40 bg-gradient-to-r from-orange-500/15 via-orange-500/10 to-transparent text-orange-700 dark:text-orange-300", note: t("هامش منخفض (0–20٪) — راجع التكلفة أو السعر.", "Low margin (0–20%) — review cost or pricing.") },
      loss: { label: t("خسارة", "Loss"), icon: TrendingDown, wrap: "border-rose-500/40 bg-gradient-to-r from-rose-500/15 via-rose-500/10 to-transparent text-rose-700 dark:text-rose-300", note: t("خسارة — سعر البيع أقل من التكلفة.", "Loss — sale price is below cost.") },
    }[tier];
    const Icon = conf.icon;
    const px = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : size === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs";
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex items-center gap-1 rounded-full border font-bold tabular-nums transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-primary/40 ${conf.wrap} ${px}`}
            title={conf.label}
          >
            <Icon className="h-3 w-3" />
            <span>{margin.toFixed(1)}%</span>
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="center" className="w-64 p-3 text-xs" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5 font-bold mb-1">
            <Icon className="h-3.5 w-3.5" />
            <span>{conf.label} · {margin.toFixed(1)}%</span>
          </div>
          <p className="text-muted-foreground leading-relaxed">{conf.note}</p>
          <div className="mt-2 pt-2 border-t border-border/60 grid grid-cols-4 gap-1 text-[9px] uppercase tracking-wider text-muted-foreground/80 font-semibold">
            <span className={tier === "loss" ? "text-rose-600" : ""}>&lt;0</span>
            <span className={tier === "low" ? "text-orange-600" : ""}>0–20</span>
            <span className={tier === "good" ? "text-amber-600" : ""}>20–40</span>
            <span className={tier === "high" ? "text-emerald-600" : ""}>≥40</span>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const clearSelected = () => setSelectedIds(new Set());

  const revertHistory = async (h: any) => {
    if (!historyOpen) return;
    setRevertingId(h.id);
    const field = h.field === "cost_price" ? "cost_price" : "price";
    const value = Number(h.old_value ?? 0);
    const { error } = await supabase
      .from("products")
      .update({ [field]: value } as any)
      .eq("id", historyOpen.id);
    setRevertingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(lang === "ar" ? "تم الرجوع للقيمة السابقة" : "Reverted to previous value");
    await loadProducts();
    await openHistory(historyOpen);
  };

  const openHistory = async (p: Product) => {
    setHistoryOpen(p);
    setHistoryLoading(true);
    const { data } = await supabase
      .from("product_price_history" as any)
      .select("*")
      .eq("product_id", p.id)
      .order("changed_at", { ascending: false })
      .limit(200);
    setHistory((data ?? []) as any[]);
    setHistoryLoading(false);
  };

  const loadProducts = async () => {
    const { data } = await supabase.from("products").select("*").order("name");
    setProducts((data ?? []) as Product[]);
  };

  const loadCustomers = async () => {
    const { data } = await supabase.from("customers").select("id,name").order("name");
    setCustomers(((data ?? []) as { id: string; name: string }[]));
  };

  // In-memory cache keyed by the range signature. Avoids re-hitting the DB
  // when the user oscillates between the same day/month/year/customer filters.
  const itemsCacheRef = React.useRef<Map<string, { at: number; data: any[] }>>(new Map());
  const inflightRef = React.useRef<AbortController | null>(null);
  const CACHE_TTL_MS = 30_000;

  const loadItems = async (opts?: { force?: boolean }) => {
    const { startISO, endISO } = rangeBounds(range, day, month, year, from, to);
    const key = JSON.stringify({ startISO, endISO, customerId });

    // Serve from cache when fresh (and not a forced realtime refetch).
    if (!opts?.force) {
      const cached = itemsCacheRef.current.get(key);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        setItems(cached.data as any);
        return;
      }
    }

    // Cancel any in-flight request so rapid filter changes don't stack.
    if (inflightRef.current) inflightRef.current.abort();

    const isFirst = items.length === 0;
    if (isFirst) setLoading(true);
    const loadingToast = isFirst
      ? toast.loading(lang === "ar" ? "جارٍ حساب الأرباح…" : "Computing profits…", { duration: Infinity })
      : null;
    const ac = new AbortController();
    inflightRef.current = ac;
    const timeoutId = setTimeout(() => ac.abort(), 45000);

    try {
      let q = supabase
        .from("invoice_items")
        .select(
          "invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total, invoices!inner(invoice_number, status, created_at, customer_name, subtotal, discount, total)"
        )
        .not("invoices.status", "in", "(voided,draft)");
      if (startISO) q = q.gte("invoices.created_at", startISO);
      if (endISO) q = q.lt("invoices.created_at", endISO);
      if (customerId) q = q.eq("invoices.customer_id", customerId);
      const { data, error } = await q.abortSignal(ac.signal).limit(10000);
      if (error) {
        // Ignore benign aborts from filter changes.
        if (!/aborted|AbortError/i.test(error.message)) toast.error(error.message);
      } else if (data) {
        itemsCacheRef.current.set(key, { at: Date.now(), data: data as any[] });
        if (isFirst) {
          toast.success(
            lang === "ar"
              ? `تم تحميل ${fmtNumber(data.length, lang)} بند بنجاح`
              : `Loaded ${fmtNumber(data.length, lang)} line item(s)`,
            { duration: 2400 }
          );
        }
        setItems(data as any);
      }
    } catch (e: any) {
      const aborted = e?.name === "AbortError" || ac.signal.aborted;
      if (!aborted) toast.error(e?.message ?? String(e));
    } finally {
      clearTimeout(timeoutId);
      if (inflightRef.current === ac) inflightRef.current = null;
      if (loadingToast != null) toast.dismiss(loadingToast);
      setLoading(false);
    }
  };



  const fyBounds = useMemo(() => {
    if (fyYear === "all") return { start: null as string | null, end: null as string | null };
    const y = Number(fyYear);
    if (!Number.isFinite(y)) return { start: null, end: null };
    return {
      start: new Date(y, 0, 1).toISOString(),
      end: new Date(y + 1, 0, 1).toISOString(),
    };
  }, [fyYear]);

  const loadCostBook = async () => {
    const { data, error } = await supabase.rpc("get_product_cost_book" as any, {
      p_fy_start: fyBounds.start,
      p_fy_end: fyBounds.end,
    });
    if (error) { console.warn("cost_book", error.message); return; }
    setCostBook((data ?? { default_rate: 50, products: {} }) as CostBook);
  };

  const loadOverrides = async () => {
    const { data } = await supabase.from("profit_cost_overrides" as any).select("product_id, cost_egp, note");
    const map: Record<string, { cost_egp: number; note: string | null }> = {};
    for (const r of (data ?? []) as any[]) {
      map[r.product_id] = { cost_egp: Number(r.cost_egp) || 0, note: r.note ?? null };
    }
    setOverrides(map);
  };

  useEffect(() => {
    if (!user) return;
    loadProducts();
    loadCustomers();
    loadOverrides();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadCostBook();
  }, [user, fyBounds.start, fyBounds.end]);

  // Debounce filter-driven refetches: rapid changes (day picker scrubbing,
  // typing a date, toggling ranges) collapse into a single request.
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => { loadItems(); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, range, day, month, year, from, to, customerId]);


  // Batched realtime — a burst across invoices/items or across PO tables
  // coalesces into ONE refetch instead of one per table (already 500ms debounced
  // inside the hook). Products/customers stay separate: they change rarely.
  useBatchedRealtimeTables(
    ["invoices", "invoice_items"],
    () => {
      if (rtPausedRef.current) {
        setRtPending((s) => new Set(s).add("items"));
        return;
      }
      bumpUpdate();
      loadItems({ force: true });

    },
    [],
    { debounceMs: 2500, maxWaitMs: 6000 },
  );
  useBatchedRealtimeTables(
    ["purchase_orders", "purchase_order_items", "profit_cost_overrides"],
    (table) => {
      if (rtPausedRef.current) {
        setRtPending((s) => new Set(s).add(table === "profit_cost_overrides" ? "overrides" : "costbook"));
        return;
      }
      bumpUpdate();
      if (table === "profit_cost_overrides") loadOverrides();
      else loadCostBook();
    },
    [],
    { debounceMs: 2500, maxWaitMs: 6000 },
  );
  useRealtimeTable("products", () => {
    if (rtPausedRef.current) { setRtPending((s) => new Set(s).add("products")); return; }
    bumpUpdate();
    loadProducts();
  });
  useRealtimeTable("customers", () => {
    if (rtPausedRef.current) { setRtPending((s) => new Set(s).add("customers")); return; }
    bumpUpdate();
    loadCustomers();
  });

  // When user resumes realtime, flush any pending refetches once.
  useEffect(() => {
    if (rtPaused) return;
    if (rtPending.size === 0) return;
    const pend = rtPending;
    setRtPending(new Set());
    if (pend.has("items")) { bumpUpdate(); loadItems({ force: true }); }
    if (pend.has("costbook")) { bumpUpdate(); loadCostBook(); }
    if (pend.has("overrides")) { bumpUpdate(); loadOverrides(); }
    if (pend.has("products")) { bumpUpdate(); loadProducts(); }
    if (pend.has("customers")) { bumpUpdate(); loadCustomers(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rtPaused]);


  // Live toast when invoice statuses change. Events are BUFFERED for a few
  // seconds and coalesced into a single summary toast so that a burst of
  // updates (e.g. bulk operations) doesn't flood the UI or thrash the chart.
  useEffect(() => {
    if (!user) return;
    type Ev = { num: string; prev: string; next: string; at: number };
    const buffer: Ev[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const FLUSH_MS = 4000;

    const flush = () => {
      flushTimer = null;
      if (buffer.length === 0) return;
      const events = buffer.splice(0, buffer.length);
      // Group by outcome bucket
      const byNext = new Map<string, number>();
      let successCount = 0, errorCount = 0;
      for (const e of events) {
        byNext.set(e.next, (byNext.get(e.next) ?? 0) + 1);
        if (e.next === "paid") successCount++;
        else if (e.next === "cancelled" || e.next === "void") errorCount++;
      }
      if (events.length === 1) {
        const e = events[0];
        const tone = e.next === "cancelled" || e.next === "void" ? "error" : e.next === "paid" ? "success" : "info";
        const msg = lang === "ar" ? `فاتورة ${e.num}: ${e.prev} → ${e.next}` : `Invoice ${e.num}: ${e.prev} → ${e.next}`;
        const opts = { description: lang === "ar" ? "تم تحديث المخطط والجدول تلقائيًا." : "Chart and table auto-updated." };
        if (tone === "success") toast.success(msg, opts);
        else if (tone === "error") toast.error(msg, opts);
        else toast.info(msg, opts);
        return;
      }
      // Aggregated summary
      const parts = Array.from(byNext.entries()).map(([k, n]) => lang === "ar" ? `${n} ${k}` : `${n} ${k}`);
      const title = lang === "ar"
        ? `تحديث ${events.length} فاتورة`
        : `${events.length} invoices updated`;
      const desc = parts.join(lang === "ar" ? " · " : " · ");
      const tone = errorCount > successCount ? "error" : successCount > 0 ? "success" : "info";
      const opts = { description: desc };
      if (tone === "success") toast.success(title, opts);
      else if (tone === "error") toast.error(title, opts);
      else toast.info(title, opts);
    };

    const channel = supabase
      .channel("profits-invoice-status")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "invoices" },
        (payload: any) => {
          const prev = payload.old?.status;
          const next = payload.new?.status;
          if (!prev || !next || prev === next) return;
          if (rtPausedRef.current) return; // suppress toasts while paused
          buffer.push({ num: payload.new?.invoice_number ?? "—", prev, next, at: Date.now() });
          if (flushTimer) clearTimeout(flushTimer);
          flushTimer = setTimeout(flush, FLUSH_MS);
        },
      )
      .subscribe();
    return () => {
      if (flushTimer) { clearTimeout(flushTimer); flush(); }
      supabase.removeChannel(channel);
    };
  }, [user, lang]);


  const openOvHistory = async (p: Product) => {
    setOvHistoryOpen(p);
    setOvHistoryLoading(true);
    const { data } = await supabase
      .from("profit_cost_overrides_history" as any)
      .select("*")
      .eq("product_id", p.id)
      .order("changed_at", { ascending: false })
      .limit(100);
    setOvHistory((data ?? []) as any[]);
    setOvHistoryLoading(false);
  };

  const revertOvHistory = async (h: any) => {
    setOvRevertingId(h.id);
    const { error } = await supabase.rpc("revert_profit_cost_override" as any, { p_history_id: h.id });
    setOvRevertingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(lang === "ar" ? "تم الرجوع للقيمة السابقة" : "Reverted");
    await loadOverrides();
    if (ovHistoryOpen) await openOvHistory(ovHistoryOpen);
  };

  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  // Unique collections / colors for the visual product picker
  const pickerFacets = useMemo(() => {
    const cols = new Map<string, number>();
    const colors = new Map<string, number>();
    for (const p of products) {
      const c = (p.collection ?? "").trim();
      if (c) cols.set(c, (cols.get(c) ?? 0) + 1);
      const cl = (p.color ?? "").trim();
      if (cl) colors.set(cl, (colors.get(cl) ?? 0) + 1);
    }
    return {
      collections: Array.from(cols.entries()).sort((a, b) => b[1] - a[1]),
      colors: Array.from(colors.entries()).sort((a, b) => b[1] - a[1]).slice(0, 24),
    };
  }, [products]);

  // Weighted-average / configurable per-product cost (EGP).
  // Falls back gracefully so KPIs never show NaN when a source is missing.
  const costOf = useMemo(() => {
    return (productId: string | null | undefined): number => {
      if (!productId) return 0;
      // Manual override always wins if present (even in "wac" mode) — matches
      // the "correction lane" that stakeholders control.
      const ov = overrides[productId];
      if (costSource === "override") return ov ? ov.cost_egp : Number(productById.get(productId)?.cost_price ?? 0);
      if (ov) return ov.cost_egp;
      const entry = costBook.products[productId];
      const p = productById.get(productId);
      const current = Number(p?.cost_price ?? 0);
      if (!entry) return current;
      if (costSource === "wac") return Number(entry.wac_egp) || current;
      if (costSource === "latest_po") return Number(entry.latest_egp) || current;
      return current; // "current"
    };
  }, [costBook, overrides, productById, costSource]);

  // Which source actually produced the number costOf() returned for a product.
  // Mirrors costOf() precedence so the UI can label/tooltip it accurately.
  const costSourceOf = useMemo(() => {
    return (productId: string | null | undefined): CostSource => {
      if (!productId) return costSource;
      const ov = overrides[productId];
      if (costSource === "override") return "override";
      if (ov) return "override";
      const entry = costBook.products[productId];
      if (!entry) return "current";
      if (costSource === "wac") return Number(entry.wac_egp) > 0 ? "wac" : "current";
      if (costSource === "latest_po") return Number(entry.latest_egp) > 0 ? "latest_po" : "current";
      return "current";
    };
  }, [costBook, overrides, costSource]);




  // Per-invoice discount-proration factor: line_total -> net revenue after
  // applying invoice-level discount, distributed proportionally across non-shipping lines.
  // factor = (invoice.total - shippingTotal) / (invoice.subtotal - shippingTotal)
  const invoiceFactor = useMemo(() => {
    const shipByInv = new Map<string, number>();
    const seenInv = new Map<string, { subtotal: number; total: number }>();
    for (const it of items) {
      if (it.invoices && !seenInv.has(it.invoice_id)) {
        seenInv.set(it.invoice_id, {
          subtotal: Number(it.invoices.subtotal ?? 0),
          total: Number(it.invoices.total ?? 0),
        });
      }
      if (isShippingLine(it)) {
        shipByInv.set(it.invoice_id, (shipByInv.get(it.invoice_id) ?? 0) + Number(it.line_total ?? 0));
      }
    }
    const f = new Map<string, number>();
    for (const [id, inv] of seenInv) {
      const ship = shipByInv.get(id) ?? 0;
      const denom = inv.subtotal - ship;
      const num = inv.total - ship;
      f.set(id, denom > 0 ? num / denom : 1);
    }
    return f;
  }, [items]);

  const netRev = (it: RawItem) =>
    Number(it.line_total ?? 0) * (invoiceFactor.get(it.invoice_id) ?? 1);

  const filterSummary = useMemo(() => {
    const customerName = customers.find((c) => c.id === customerId)?.name ?? (lang === "ar" ? "كل العملاء" : "All customers");
    const productSummary = selectedIds.size > 0
      ? `${selectedIds.size} ${lang === "ar" ? "منتج محدد" : "selected product(s)"}`
      : search.trim()
        ? search.trim()
        : (lang === "ar" ? "كل المنتجات" : "All products");

    let rangeLabel = lang === "ar" ? "كل الفترة" : "All time";
    if (range === "day") rangeLabel = day;
    else if (range === "month") rangeLabel = month;
    else if (range === "year") rangeLabel = year;
    else if (range === "custom") rangeLabel = `${from || "—"} → ${to || "—"}`;

    return { rangeLabel, productSummary, customerName };
  }, [customers, customerId, day, from, lang, month, range, search, selectedIds, to, year]);

  // Shipping/service fees aggregate (excluded from revenue/profit but shown for transparency)
  const shippingTotals = useMemo(() => {
    let amount = 0;
    let lines = 0;
    const invoices = new Set<string>();
    for (const it of items) {
      if (!isShippingLine(it)) continue;
      if (selectedIds.size > 0) continue; // when filtering by product, shipping is irrelevant
      amount += Number(it.line_total ?? 0);
      lines += 1;
      invoices.add(it.invoice_id);
    }
    return { amount, lines, invoices: invoices.size };
  }, [items, selectedIds]);

  // Compute profit rows — include ALL products, even those with no sales in range.
  const rows = useMemo(() => {
    const filtered = items.filter((it) => !isShippingLine(it) && it.product_id);
    const byProduct = new Map<
      string,
      { product: Product | null; qty: number; revenue: number; cost: number; lines: number }
    >();
    for (const p of products) {
      byProduct.set(p.id, { product: p, qty: 0, revenue: 0, cost: 0, lines: 0 });
    }
    for (const it of filtered) {
      const p = productById.get(it.product_id!) ?? null;
      const cost = costOf(it.product_id) * it.quantity;
      const rev = netRev(it);
      const cur = byProduct.get(it.product_id!) ?? { product: p, qty: 0, revenue: 0, cost: 0, lines: 0 };
      cur.qty += it.quantity;
      cur.revenue += rev;
      cur.cost += cost;
      cur.lines += 1;
      byProduct.set(it.product_id!, cur);
    }
    const list = Array.from(byProduct.entries())
      .map(([pid, v]) => {
        const unitCost = v.qty > 0 ? v.cost / v.qty : costOf(pid);
        return {
          product_id: pid,
          product: v.product,
          name: v.product?.name ?? "(محذوف)",
          qty: v.qty,
          revenue: v.revenue,
          cost: v.cost,
          profit: v.revenue - v.cost,
          margin: v.revenue > 0 ? ((v.revenue - v.cost) / v.revenue) * 100 : 0,
          lines: v.lines,
          unitCost,
          costSourceUsed: costSourceOf(pid),
          missingCost: v.qty > 0 && unitCost === 0,
        };
      })

      .filter((r) => selectedIds.size === 0 || selectedIds.has(r.product_id))
      .filter((r) => {
        if (!search.trim()) return true;
        const s = search.trim().toLowerCase();
        return (
          r.name.toLowerCase().includes(s) ||
          (r.product?.serial_number ?? "").toLowerCase().includes(s) ||
          (r.product?.color ?? "").toLowerCase().includes(s) ||
          (r.product?.collection ?? "").toLowerCase().includes(s)
        );
      })
      .sort((a, b) => {
        if (a.qty === 0 && b.qty === 0) return a.name.localeCompare(b.name);
        if (a.qty === 0) return 1;
        if (b.qty === 0) return -1;
        return b.profit - a.profit;
      });
    const totals = list.reduce(
      (acc, r) => {
        acc.revenue += r.revenue; acc.cost += r.cost; acc.qty += r.qty; acc.lines += r.lines;
        return acc;
      },
      { revenue: 0, cost: 0, qty: 0, lines: 0 }
    );
    // Include custom invoice lines (non-product, non-shipping) so KPI totals
    // reflect the actual invoice value. Shipping fees and voided invoices remain excluded.
    // When a product filter is active, skip extras (they aren't tied to a product).
    let extrasRevenue = 0;
    let extrasLines = 0;
    if (selectedIds.size === 0) {
      for (const it of items) {
        if (it.product_id) continue;
        if (isShippingLine(it)) continue;
        extrasRevenue += netRev(it);
        extrasLines += 1;
      }
    }
    const totalRevenue = totals.revenue + extrasRevenue;
    const totalCost = totals.cost; // custom lines have no cost basis
    return {
      list,
      extras: { revenue: extrasRevenue, lines: extrasLines },
      totals: {
        ...totals,
        revenue: totalRevenue,
        cost: totalCost,
        lines: totals.lines + extrasLines,
        profit: totalRevenue - totalCost,
        margin: totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0,
      },
    };
  }, [items, productById, search, products, selectedIds, invoiceFactor, costOf, costSourceOf]);

  const totalsMatch = useMemo(() => {
    if (selectedIds.size > 0 || search.trim()) return null;

    const totalsByInvoice = new Map<string, number>();
    for (const it of items) {
      if (!it.invoices) continue;
      totalsByInvoice.set(it.invoice_id, Number(it.invoices.total ?? 0));
    }

    const reportsTotal = Array.from(totalsByInvoice.values()).reduce((sum, value) => sum + value, 0);
    const profitsTotal = Number(rows.totals.revenue ?? 0);
    const diff = Math.abs(profitsTotal - reportsTotal);

    return {
      reportsTotal,
      profitsTotal,
      diff,
      ok: diff < 0.01,
    };
  }, [items, rows.totals.revenue, search, selectedIds]);

  // Per-invoice profit breakdown
  const invoiceRows = useMemo(() => {
    const map = new Map<
      string,
      {
        invoice_id: string;
        invoice_number: string;
        created_at: string;
        customer_name: string | null;
        status: string;
        revenue: number;
        cost: number;
        items: number;
      }
    >();
    for (const it of items) {
      if (isShippingLine(it)) continue;
      if (!it.product_id) continue;
      if (selectedIds.size > 0 && !selectedIds.has(it.product_id)) continue;
      const p = productById.get(it.product_id);
      const cost = costOf(it.product_id) * it.quantity;
      const rev = netRev(it);
      const cur = map.get(it.invoice_id) ?? {
        invoice_id: it.invoice_id,
        invoice_number: it.invoices?.invoice_number ?? "",
        created_at: it.invoices?.created_at ?? "",
        customer_name: it.invoices?.customer_name ?? null,
        status: it.invoices?.status ?? "",
        revenue: 0,
        cost: 0,
        items: 0,
      };
      cur.revenue += rev;
      cur.cost += cost;
      cur.items += it.quantity;
      map.set(it.invoice_id, cur);
    }
    return Array.from(map.values())
      .map((r) => ({ ...r, profit: r.revenue - r.cost, margin: r.revenue > 0 ? ((r.revenue - r.cost) / r.revenue) * 100 : 0 }))
      .sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
  }, [items, productById, selectedIds, invoiceFactor, costOf]);

  // Daily trend (net profit per day) within selected range and product filter
  const dailyTrend = useMemo(() => {
    const map = new Map<string, { date: string; revenue: number; cost: number; profit: number }>();
    for (const it of items) {
      if (isShippingLine(it) || !it.product_id) continue;
      if (selectedIds.size > 0 && !selectedIds.has(it.product_id)) continue;
      const day = (it.invoices?.created_at ?? "").slice(0, 10);
      if (!day) continue;
      const p = productById.get(it.product_id);
      const cost = costOf(it.product_id) * it.quantity;
      const rev = netRev(it);
      const cur = map.get(day) ?? { date: day, revenue: 0, cost: 0, profit: 0 };
      cur.revenue += rev; cur.cost += cost; cur.profit = cur.revenue - cur.cost;
      map.set(day, cur);
    }
    return Array.from(map.values()).sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [items, productById, selectedIds, invoiceFactor, costOf]);

  const startEdit = (p: Product) => {
    setEditing((cur) => ({
      ...cur,
      [p.id]: { cost: String(p.cost_price ?? 0), sale: String(p.price ?? 0) },
    }));
  };
  const cancelEdit = (id: string) => {
    setEditing((cur) => {
      const n = { ...cur };
      delete n[id];
      return n;
    });
  };
  const saveEdit = async (p: Product) => {
    const e = editing[p.id];
    if (!e) return;
    const cost = Number(e.cost) || 0;
    const sale = Number(e.sale) || 0;
    if (cost < 0 || sale < 0) {
      toast.error(lang === "ar" ? "قيمة غير صحيحة" : "Invalid value");
      return;
    }
    setSavingId(p.id);
    const { error } = await supabase
      .from("products")
      .update({ cost_price: cost, price: sale } as any)
      .eq("id", p.id);
    setSavingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(lang === "ar" ? "تم الحفظ" : "Saved");
    cancelEdit(p.id);
    await loadProducts();
  };

  const exportXlsx = () => {
    const { startISO, endISO } = rangeBounds(range, day, month, year, from, to);
    const rangeLabel = !startISO
      ? lang === "ar" ? "الإجمالي" : "All"
      : `${startISO.slice(0, 10)} → ${(endISO ?? "").slice(0, 10)}`;

    // Sheet 1: per-product
    const ws1Data = [
      [
        lang === "ar" ? "المنتج" : "Product",
        lang === "ar" ? "الكولكشن" : "Collection",
        lang === "ar" ? "تسلسلي" : "Serial",
        lang === "ar" ? "اللون" : "Color",
        lang === "ar" ? "الكمية المباعة" : "Sold Qty",
        lang === "ar" ? "سعر التكلفة" : "Cost Price",
        lang === "ar" ? "مصدر التكلفة" : "Cost Source",
        lang === "ar" ? "سعر البيع" : "Sale Price",
        lang === "ar" ? "إجمالي التكلفة" : "Total Cost",
        lang === "ar" ? "إجمالي البيع" : "Total Revenue",
        lang === "ar" ? "صافي الربح" : "Net Profit",
        lang === "ar" ? "هامش %" : "Margin %",
      ],
      ...rows.list.map((r) => [
        r.name,
        r.product?.collection ?? "",
        r.product?.serial_number ?? "",
        r.product?.color ?? "",
        r.qty,
        +Number(r.unitCost).toFixed(2),
        r.costSourceUsed,
        Number(r.product?.price ?? 0),
        +r.cost.toFixed(2),
        +r.revenue.toFixed(2),
        +r.profit.toFixed(2),
        +r.margin.toFixed(2),
      ]),

      [],
      [
        lang === "ar" ? "الإجمالي" : "TOTAL",
        "",
        "",
        "",
        rows.totals.qty,
        "",
        "",
        "",
        +rows.totals.cost.toFixed(2),
        +rows.totals.revenue.toFixed(2),
        +rows.totals.profit.toFixed(2),
        +rows.totals.margin.toFixed(2),
      ],

    ];

    // Sheet 2: per-invoice
    const ws2Data = [
      [
        lang === "ar" ? "رقم الفاتورة" : "Invoice #",
        lang === "ar" ? "التاريخ" : "Date",
        lang === "ar" ? "العميل" : "Customer",
        lang === "ar" ? "عدد القطع" : "Items",
        lang === "ar" ? "إجمالي البيع" : "Revenue",
        lang === "ar" ? "إجمالي التكلفة" : "Cost",
        lang === "ar" ? "صافي الربح" : "Net Profit",
        lang === "ar" ? "هامش %" : "Margin %",
      ],
      ...invoiceRows.map((r) => [
        r.invoice_number,
        r.created_at.slice(0, 10),
        r.customer_name ?? "",
        r.items,
        +r.revenue.toFixed(2),
        +r.cost.toFixed(2),
        +r.profit.toFixed(2),
        +r.margin.toFixed(2),
      ]),
    ];

    // Sheet 3: meta
    const ws3Data = [
      [lang === "ar" ? "النطاق" : "Range", rangeLabel],
      [lang === "ar" ? "تم في" : "Generated", new Date().toISOString()],
      [lang === "ar" ? "ملاحظة" : "Note", lang === "ar" ? "الفواتير الملغاة والمحذوفة مستبعدة. رسوم الشحن مستبعدة." : "Voided/deleted invoices and shipping fees excluded."],
      [lang === "ar" ? "إجمالي البيع" : "Total Revenue", +rows.totals.revenue.toFixed(2)],
      [lang === "ar" ? "إجمالي التكلفة" : "Total Cost", +rows.totals.cost.toFixed(2)],
      [lang === "ar" ? "صافي الربح" : "Net Profit", +rows.totals.profit.toFixed(2)],
      [lang === "ar" ? "الهامش %" : "Margin %", +rows.totals.margin.toFixed(2)],
    ];

    const wb = XLSX.utils.book_new();
    const ws4Data = [
      [
        lang === "ar" ? "التاريخ" : "Date",
        lang === "ar" ? "البيع" : "Revenue",
        lang === "ar" ? "التكلفة" : "Cost",
        lang === "ar" ? "صافي الربح" : "Net Profit",
      ],
      ...dailyTrend.map((d) => [d.date, +d.revenue.toFixed(2), +d.cost.toFixed(2), +d.profit.toFixed(2)]),
    ];

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ws1Data), lang === "ar" ? "المنتجات" : "Products");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ws2Data), lang === "ar" ? "الفواتير" : "Invoices");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ws4Data), lang === "ar" ? "اليومي" : "Daily");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ws3Data), lang === "ar" ? "ملخص" : "Summary");
    const fname = `profits_${range}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fname);
    toast.success(lang === "ar" ? "تم التصدير" : "Exported");
  };

  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-emerald-500" />
            {t("صافي الأرباح", "Profit Analysis")}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t(
              "حساب الربح الفعلي لكل منتج وكل فاتورة. الفواتير الملغاة/المحذوفة ورسوم الشحن مستبعدة.",
              "Actual profit per product & per invoice. Voided/deleted invoices and shipping fees excluded."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              await Promise.all([loadProducts(), loadItems({ force: true })]);
              const r = rows.totals;
              toast.success(
                t("تم إعادة الاحتساب", "Recalculated"),
                {
                  description: t(
                    `البيع: ${fmtMoney(r.revenue, "EGP", lang)} · التكلفة: ${fmtMoney(r.cost, "EGP", lang)} · الربح: ${fmtMoney(r.profit, "EGP", lang)} (${r.margin.toFixed(1)}%)`,
                    `Revenue: ${fmtMoney(r.revenue, "EGP", lang)} · Cost: ${fmtMoney(r.cost, "EGP", lang)} · Profit: ${fmtMoney(r.profit, "EGP", lang)} (${r.margin.toFixed(1)}%)`
                  ),
                  duration: 6000,
                }
              );
            }}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {t("إعادة احتساب", "Recalculate")}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="formula">
                <Info className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] text-xs leading-relaxed">
              <div className="font-semibold mb-1">{t("معادلة حساب الربح", "Profit formula")}</div>
              <ul className="space-y-1 list-disc ps-4">
                <li>{t("إجمالي البيع للمنتج = Σ (سعر الوحدة × الكمية − الخصم) لكل بند فاتورة غير ملغية.", "Revenue = Σ (unit_price × qty − discount) across non-voided invoice items.")}</li>
                <li>{t("إجمالي التكلفة = التكلفة الفعالة × الكمية المباعة. التكلفة الفعالة تُحسب حسب مصدر التكلفة المختار (WAC / آخر PO / الحالي / تعديل يدوي).", "Cost = effective_cost × sold qty. Effective cost follows the selected source (WAC / Latest PO / Current / Manual override).")}</li>
                <li>{t("WAC = Σ(كمية × سعر EGP)/Σ(كمية) عبر كل أوامر الشراء، بتحويل USD→EGP باستخدام سعر كل PO المسجّل.", "WAC = Σ(qty × EGP)/Σ(qty) across all POs, converting USD→EGP with each PO's own recorded rate.")}</li>
                <li>{t("التعديل اليدوي (للمشرفين) يُطبَّق فوريًا على هذه الصفحة فقط ولا يمس أسعار المنتجات ولا الفواتير ولا PO.", "Manual override (admin only) applies to this page only — never touches product prices, invoices, or POs.")}</li>
                <li>{t("صافي الربح = إجمالي البيع − إجمالي التكلفة.", "Profit = Revenue − Cost.")}</li>
                <li>{t("هامش % = (الربح ÷ إجمالي البيع) × 100.", "Margin % = (Profit ÷ Revenue) × 100.")}</li>
                <li>{t("بنود مخصصة (بدون منتج) تُحتسب ضمن إجمالي البيع بتكلفة 0.", "Custom (non-product) lines are added to Revenue with zero cost.")}</li>
                <li>{t("يتم خصم الخصم على مستوى الفاتورة بالتناسب على البنود (باستثناء الشحن).", "Invoice-level discount is prorated across non-shipping lines.")}</li>
                <li className="text-muted-foreground">{t("مستبعد: الفواتير الملغية، الفواتير المحذوفة، رسوم الشحن/الخدمة.", "Excluded: voided invoices, deleted invoices, shipping/service fees.")}</li>
              </ul>
            </PopoverContent>
          </Popover>
          <Button onClick={exportXlsx} className="gap-2">
            <Download className="h-4 w-4" /> {t("تنزيل Excel", "Export Excel")}
          </Button>
        </div>
      </div>

      {/* Cost source legend */}
      <div className="rounded-2xl border bg-card/50 p-3 sm:p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {t("دليل اختصارات مصدر التكلفة", "Cost Source Abbreviations")}
          </h4>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <div className="flex items-start gap-2 rounded-xl border bg-background/60 p-2.5">
            <span className="mt-0.5 inline-flex items-center justify-center rounded border bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25 px-1.5 py-0.5 text-[10px] font-bold">WAC</span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold">{t("متوسط مرجّح", "Weighted Avg")}</div>
              <div className="text-[10px] text-muted-foreground leading-tight">{t("متوسط تكلفة كل POs مرجّح بالكمية.", "Weighted average of all POs by quantity.")}</div>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-xl border bg-background/60 p-2.5">
            <span className="mt-0.5 inline-flex items-center justify-center rounded border bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25 px-1.5 py-0.5 text-[10px] font-bold">LPO</span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold">{t("آخر PO", "Latest PO")}</div>
              <div className="text-[10px] text-muted-foreground leading-tight">{t("سعر آخر أمر شراء تم استلامه.", "Latest received purchase order cost.")}</div>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-xl border bg-background/60 p-2.5">
            <span className="mt-0.5 inline-flex items-center justify-center rounded border bg-muted text-muted-foreground border-border px-1.5 py-0.5 text-[10px] font-bold">CUR</span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold">{t("التكلفة الحالية", "Current Cost")}</div>
              <div className="text-[10px] text-muted-foreground leading-tight">{t("سعر المنتج المحفوظ حاليًا.", "The product's stored cost price.")}</div>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-xl border bg-background/60 p-2.5">
            <span className="mt-0.5 inline-flex items-center justify-center rounded border bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 px-1.5 py-0.5 text-[10px] font-bold">MAN</span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold">{t("تعديل يدوي", "Manual Override")}</div>
              <div className="text-[10px] text-muted-foreground leading-tight">{t("تعديل مخصص من صفحة الأرباح للمشرفين.", "Admin override from the Profits page only.")}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Range filter */}
      <div className="rounded-2xl border bg-card p-3 sm:p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1.5">
            {([
              ["day", t("يوم", "Day")],
              ["month", t("شهر", "Month")],
              ["year", t("سنة", "Year")],
              ["all", t("الإجمالي", "All")],
              ["custom", t("نطاق", "Range")],
            ] as [Range, string][]).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setRange(k)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  range === k
                    ? "bg-primary text-primary-foreground shadow"
                    : "bg-muted hover:bg-muted/70"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {range === "day" && (
            <div>
              <Label className="text-xs">{t("اليوم", "Day")}</Label>
              <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-[170px]" />
            </div>
          )}
          {range === "month" && (
            <div>
              <Label className="text-xs">{t("الشهر", "Month")}</Label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-[170px]" />
            </div>
          )}
          {range === "year" && (
            <div>
              <Label className="text-xs">{t("السنة", "Year")}</Label>
              <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="w-[120px]" />
            </div>
          )}
          {range === "custom" && (
            <>
              <div>
                <Label className="text-xs">{t("من", "From")}</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[170px]" />
              </div>
              <div>
                <Label className="text-xs">{t("إلى", "To")}</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[170px]" />
              </div>
            </>
          )}
          <div className="flex-1 min-w-[220px]">
            <Label className="text-xs">{t("بحث منتج", "Search product")}</Label>
            <div className="relative">
              <Filter className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("اسم / تسلسلي / لون / كولكشن", "name / serial / color / collection")}
                className="ps-9"
              />
            </div>
          </div>
          <div className="min-w-[220px]">
            <Label className="text-xs">{t("العميل", "Customer")}</Label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
            >
              <option value="">{t("كل العملاء", "All customers")}</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[220px]">
            <Label className="text-xs">{t("فلترة منتجات محددة", "Filter specific products")}</Label>
            <Popover open={productPickerOpen} onOpenChange={setProductPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start gap-2 h-10">
                  <Layers className="h-4 w-4 text-primary" />
                  <span className="truncate">
                    {selectedIds.size > 0
                      ? t(`${selectedIds.size} منتج محدد`, `${selectedIds.size} selected`)
                      : t("كل المنتجات", "All products")}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[420px] p-0" align="end">
                <div className="p-2 border-b space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                      placeholder={t("بحث اسم / سيريال / لون...", "Search name / serial / color…")}
                      className="h-8 text-xs"
                    />
                    {selectedIds.size > 0 && (
                      <Button size="sm" variant="ghost" onClick={clearSelected} className="h-8 px-2 text-[10px]">
                        {t("مسح", "Clear")}
                      </Button>
                    )}
                  </div>
                  {pickerFacets.collections.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      <span className="text-[10px] text-muted-foreground self-center me-1">{t("الكولكشن:", "Collection:")}</span>
                      {pickerFacets.collections.map(([c, n]) => {
                        const active = pickerCollections.has(c);
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() =>
                              setPickerCollections((cur) => {
                                const s = new Set(cur);
                                if (s.has(c)) s.delete(c); else s.add(c);
                                return s;
                              })
                            }
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition ${
                              active ? collectionBadgeClass(c) + " ring-1 ring-primary/50" : "bg-muted/40 hover:bg-muted"
                            }`}
                          >
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${collectionDotClass(c)}`} />
                            {c}
                            <span className="opacity-60 tabular-nums">{n}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {pickerFacets.colors.length > 0 && (
                    <div className="flex flex-wrap gap-1 items-center">
                      <span className="text-[10px] text-muted-foreground me-1">{t("اللون:", "Color:")}</span>
                      {pickerFacets.colors.map(([c, n]) => {
                        const active = pickerColors.has(c);
                        return (
                          <button
                            key={c}
                            type="button"
                            title={`${c} · ${n}`}
                            onClick={() =>
                              setPickerColors((cur) => {
                                const s = new Set(cur);
                                if (s.has(c)) s.delete(c); else s.add(c);
                                return s;
                              })
                            }
                            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] transition ${
                              active ? "ring-2 ring-primary shadow-sm" : "hover:bg-muted"
                            }`}
                          >
                            <span className="inline-block h-3 w-3 rounded-full border" style={swatchStyle(c)} />
                            <span className="truncate max-w-[70px]">{c}</span>
                          </button>
                        );
                      })}
                      {(pickerColors.size > 0 || pickerCollections.size > 0) && (
                        <button
                          type="button"
                          onClick={() => { setPickerColors(new Set()); setPickerCollections(new Set()); }}
                          className="text-[10px] text-primary underline ms-auto"
                        >
                          {t("إلغاء الفلاتر", "Reset facets")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto p-1">
                  {(() => {
                    const s = pickerSearch.trim().toLowerCase();
                    const filtered = products.filter((p) => {
                      if (pickerCollections.size > 0 && !pickerCollections.has((p.collection ?? "").trim())) return false;
                      if (pickerColors.size > 0 && !pickerColors.has((p.color ?? "").trim())) return false;
                      if (!s) return true;
                      return (
                        p.name.toLowerCase().includes(s) ||
                        (p.serial_number ?? "").toLowerCase().includes(s) ||
                        (p.color ?? "").toLowerCase().includes(s) ||
                        (p.collection ?? "").toLowerCase().includes(s)
                      );
                    });
                    if (filtered.length === 0) {
                      return <div className="text-center text-[11px] text-muted-foreground py-6">{t("لا نتائج", "No results")}</div>;
                    }
                    return (
                      <>
                        <div className="flex items-center justify-between px-2 py-1 text-[10px] text-muted-foreground">
                          <span>{filtered.length} {t("منتج", "product(s)")}</span>
                          <button
                            type="button"
                            className="text-primary underline"
                            onClick={() =>
                              setSelectedIds((cur) => {
                                const s2 = new Set(cur);
                                for (const p of filtered) s2.add(p.id);
                                return s2;
                              })
                            }
                          >
                            {t("تحديد كل الظاهر", "Select all shown")}
                          </button>
                        </div>
                        {filtered.slice(0, 400).map((p) => {
                          const checked = selectedIds.has(p.id);
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => toggleSelected(p.id)}
                              className={`w-full text-start flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted ${checked ? "bg-primary/10 ring-1 ring-primary/40" : ""}`}
                            >
                              <input type="checkbox" readOnly checked={checked} className="pointer-events-none" />
                              {p.image_url ? (
                                <img src={p.image_url} alt="" className="h-8 w-8 rounded-md object-cover border shrink-0" loading="lazy" />
                              ) : (
                                <div className="h-8 w-8 rounded-md border bg-muted/40 grid place-items-center shrink-0">
                                  <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="truncate font-medium">{p.name}</div>
                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                  {p.serial_number && <span className="font-mono truncate">{p.serial_number}</span>}
                                  {p.color && (
                                    <span className="inline-flex items-center gap-1">
                                      <span className="inline-block h-2 w-2 rounded-full border" style={swatchStyle(p.color)} />
                                      <span className="truncate max-w-[60px]">{p.color}</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                              {p.collection && (
                                <span className={`text-[9px] rounded border px-1.5 py-0.5 font-bold ${collectionBadgeClass(p.collection)}`}>
                                  {p.collection}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </>
                    );
                  })()}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        {selectedIds.size > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t pt-2.5">
            <span className="text-[11px] font-semibold text-foreground">{t("المحددة:", "Selected:")}</span>
            {Array.from(selectedIds).slice(0, 12).map((id) => {
              const p = productById.get(id);
              if (!p) return null;
              return (
                <span key={id} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 py-0.5 ps-0.5 pe-2 text-[10px]">
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="h-4 w-4 rounded-full object-cover" />
                  ) : (
                    <span className={`inline-block h-4 w-4 rounded-full ${collectionDotClass(p.collection)}`} />
                  )}
                  <span className="truncate max-w-[110px]">{p.name}</span>
                  <button onClick={() => toggleSelected(id)} className="opacity-60 hover:opacity-100"><X className="h-3 w-3" /></button>
                </span>
              );
            })}
            {selectedIds.size > 12 && (
              <span className="text-[10px] text-muted-foreground">+{selectedIds.size - 12}</span>
            )}
            <button onClick={clearSelected} className="text-[10px] text-primary underline ms-1">{t("إلغاء الكل", "Clear all")}</button>
          </div>
        )}
        {/* Current context — inline chips replacing the standalone card */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t pt-2.5 text-[11px]">
          <span className="font-semibold text-muted-foreground">{t("السياق الحالي:", "Context:")}</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300 px-2.5 py-0.5">
            <Clock className="h-3 w-3" /> {filterSummary.rangeLabel}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300 px-2.5 py-0.5">
            <Layers className="h-3 w-3" /> {filterSummary.productSummary}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2.5 py-0.5">
            <Receipt className="h-3 w-3" /> {filterSummary.customerName}
          </span>
        </div>
      </div>



      {/* Cost Source & Cost Book */}
      <div className="rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 sm:px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="h-4 w-4 shrink-0 text-primary" />
            <h3 className="font-semibold text-sm truncate">{t("دفتر التكاليف (المتوسط المرجح)", "Cost Book (Weighted Average)")}</h3>
            <span className="hidden sm:inline text-[10px] rounded-full border bg-muted/40 px-2 py-0.5 text-muted-foreground">
              {t("USD → EGP بسعر كل PO", "USD → EGP at each PO rate")}
            </span>
          </div>
          <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => setCostBookOpen((v) => !v)}>
            {costBookOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {costBookOpen ? t("إخفاء", "Hide") : t("عرض التفاصيل", "Show details")}
          </Button>
        </div>

        <div className="grid gap-3 p-3 sm:p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="min-w-0">
            <Label className="text-[11px] text-muted-foreground">{t("مصدر التكلفة المستخدم في حساب الأرباح", "Cost source used for profit")}</Label>
            <div className="mt-1 inline-flex flex-wrap rounded-full border bg-muted/40 p-0.5 text-[11px]">
              {([
                ["wac", t("متوسط مرجح (WAC)", "Weighted avg (WAC)")],
                ["latest_po", t("آخر PO", "Latest PO")],
                ["current", t("سعر المنتج الحالي", "Current product cost")],
                ["override", t("تعديل يدوي فقط", "Manual override only")],
              ] as [CostSource, string][]).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setCostSource(k)}
                  className={`rounded-full px-3 py-1 font-semibold transition ${costSource === k ? "bg-primary text-primary-foreground shadow" : "hover:bg-background"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-1.5 text-[10px] text-muted-foreground leading-relaxed">
              {costSource === "wac" && t("متوسط تكلفة كل POs مرجّح بالكمية — الأدق للأرباح.", "Weighted average of all POs by quantity — most accurate for profit.")}
              {costSource === "latest_po" && t("سعر آخر أمر شراء وصل — يعكس أحدث تكلفة استيراد.", "Uses the latest received PO cost — reflects current import price.")}
              {costSource === "current" && t("سعر المنتج المحفوظ حاليًا — يتجاهل تعديلات الأرباح اليدوية.", "Uses the product's stored cost — ignores manual overrides.")}
              {costSource === "override" && t("لا يُستخدم إلا التعديل اليدوي — بديله سعر المنتج الحالي.", "Only manual overrides apply — falls back to current product cost.")}
            </div>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">{t("السنة المالية (لدفتر التكاليف)", "Fiscal year (Cost Book)")}</Label>
            <select
              value={fyYear}
              onChange={(e) => setFyYear(e.target.value)}
              className="mt-1 h-9 w-full sm:w-[160px] rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">{t("كل السنوات", "All years")}</option>
              {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col justify-end gap-1 text-[11px]">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 self-start">
              <span className="text-muted-foreground">{t("سعر افتراضي", "Fallback rate")}</span>
              <span className="tabular-nums font-bold text-primary">${costBook.default_rate?.toFixed?.(2) ?? "50.00"}</span>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 self-start">
              <BookOpen className="h-3 w-3 text-muted-foreground" />
              <span className="tabular-nums font-semibold">{Object.keys(costBook.products).length}</span>
              <span className="text-muted-foreground">{t("منتج في الدفتر", "in book")}</span>
            </div>
          </div>
        </div>



        {costBookOpen && (
          <div className="border-t">
            <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-2 bg-muted/20">
              <Input
                value={costBookSearch}
                onChange={(e) => setCostBookSearch(e.target.value)}
                placeholder={t("بحث اسم / كولكشن / لون / سيريال", "Search name / collection / color / serial")}
                className="h-8 max-w-xs text-xs"
              />
              <div className="inline-flex items-center gap-1 text-[10px]">
                <span className="text-muted-foreground">{t("ترتيب:", "Sort:")}</span>
                <select
                  value={cbSort}
                  onChange={(e) => setCbSort(e.target.value as any)}
                  className="h-7 rounded-md border bg-background px-2 text-[11px]"
                >
                  <option value="qty">{t("الأكثر كمية", "Highest qty")}</option>
                  <option value="cost">{t("الأعلى تكلفة", "Highest cost")}</option>
                  <option value="recent">{t("أحدث PO", "Most recent PO")}</option>
                  <option value="name">{t("اسم أبجدي", "Name A-Z")}</option>
                </select>
              </div>
              <span className="text-[10px] text-muted-foreground ms-auto">
                {t("انقر على منتج لعرض دفعات PO", "Click a product to expand PO lots")}
              </span>
            </div>
            <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
              <table className="w-full min-w-[820px] text-xs">
                <thead className="sticky top-0 bg-card border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start">{t("المنتج", "Product")}</th>
                    <th className="px-3 py-2 text-end">{t("كمية PO", "PO Qty")}</th>
                    <th className="px-3 py-2 text-end">WAC USD</th>
                    <th className="px-3 py-2 text-end">WAC EGP</th>
                    <th className="px-3 py-2 text-end">{t("أحدث PO", "Latest PO")}</th>
                    <th className="px-3 py-2 text-end">{t("Min / Max USD", "Min / Max USD")}</th>
                    <th className="px-3 py-2 text-end">{t("التكلفة الفعالة", "Effective")}</th>
                    <th className="px-3 py-2 text-end">{t("تعديل يدوي (EGP)", "Manual (EGP)")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {products
                    .filter((p) => {
                      const s = costBookSearch.trim().toLowerCase();
                      if (!s) return true;
                      return (
                        p.name.toLowerCase().includes(s) ||
                        (p.serial_number ?? "").toLowerCase().includes(s) ||
                        (p.color ?? "").toLowerCase().includes(s) ||
                        (p.collection ?? "").toLowerCase().includes(s)
                      );
                    })
                    .sort((a, b) => {
                      const ea = costBook.products[a.id];
                      const eb = costBook.products[b.id];
                      if (cbSort === "name") return a.name.localeCompare(b.name);
                      if (cbSort === "cost") return (costOf(b.id) || 0) - (costOf(a.id) || 0);
                      if (cbSort === "recent") {
                        const la = ea?.lots?.[0]?.shipment_date ?? "";
                        const lb = eb?.lots?.[0]?.shipment_date ?? "";
                        return lb.localeCompare(la);
                      }
                      return (eb?.total_qty ?? 0) - (ea?.total_qty ?? 0);
                    })
                    .slice(0, 300)
                    .map((p) => {
                      const entry = costBook.products[p.id];
                      const eff = costOf(p.id);
                      const ov = overrides[p.id];
                      const isOpen = !!expandedCB[p.id];
                      return (
                        <Fragment key={p.id}>
                          <tr className={`hover:bg-muted/30 cursor-pointer ${ov ? "bg-amber-500/5" : ""}`} onClick={() => setExpandedCB((c) => ({ ...c, [p.id]: !c[p.id] }))}>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {isOpen ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
                                {p.image_url ? (
                                  <img src={p.image_url} alt="" className="h-9 w-9 rounded-md object-cover border shrink-0" loading="lazy" />
                                ) : (
                                  <div className="h-9 w-9 rounded-md border bg-muted/40 grid place-items-center shrink-0">
                                    <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <div className="font-medium truncate flex items-center gap-1.5">
                                    {p.name}
                                    {p.collection && (


                                      <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold ${collectionBadgeClass(p.collection)}`}>
                                        <span className={`inline-block h-1 w-1 rounded-full ${collectionDotClass(p.collection)}`} />
                                        {p.collection}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground flex gap-2 flex-wrap">
                                    {p.serial_number && <span className="font-mono">{p.serial_number}</span>}
                                    {p.color && (
                                      <span className="inline-flex items-center gap-1">
                                        <ColorSwatch value={p.color} size="sm" />{p.color}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-end tabular-nums">{entry ? fmtNumber(entry.total_qty, lang) : "—"}</td>
                            <td className="px-3 py-2 text-end tabular-nums">{entry ? `$${entry.wac_usd.toFixed(2)}` : "—"}</td>
                            <td className="px-3 py-2 text-end tabular-nums font-semibold">{entry ? fmtMoney(entry.wac_egp, "EGP", lang) : "—"}</td>
                            <td className="px-3 py-2 text-end tabular-nums">{entry ? `$${entry.latest_usd.toFixed(2)}` : "—"}</td>
                            <td className="px-3 py-2 text-end tabular-nums text-[10px]">{entry ? `$${entry.min_usd.toFixed(2)} / $${entry.max_usd.toFixed(2)}` : "—"}</td>
                            <td className="px-3 py-2 text-end tabular-nums font-bold text-primary">{fmtMoney(eff, "EGP", lang)}</td>
                            <td className="px-3 py-2 text-end" onClick={(e) => e.stopPropagation()}>
                              {isAdmin ? (
                                <div className="flex items-center justify-end gap-1">
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={ovDraft[p.id] ?? (ov ? String(ov.cost_egp) : "")}
                                    onChange={(e) => setOvDraft((c) => ({ ...c, [p.id]: e.target.value }))}
                                    placeholder={ov ? "" : t("لا يوجد", "none")}
                                    className="h-7 w-24 text-end text-xs"
                                  />
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0"
                                    disabled={savingOv === p.id}
                                    onClick={async () => {
                                      const raw = ovDraft[p.id];
                                      setSavingOv(p.id);
                                      if (raw === "" || raw === undefined) {
                                        const { error } = await supabase.from("profit_cost_overrides" as any).delete().eq("product_id", p.id);
                                        setSavingOv(null);
                                        if (error) return toast.error(error.message);
                                        toast.success(t("تم حذف التعديل اليدوي", "Manual override removed"));
                                      } else {
                                        const val = Number(raw);
                                        if (!Number.isFinite(val) || val < 0) { setSavingOv(null); return toast.error(t("قيمة غير صالحة", "Invalid value")); }
                                        const { error } = await supabase.from("profit_cost_overrides" as any).upsert({ product_id: p.id, cost_egp: val, updated_by: user?.id }, { onConflict: "product_id" });
                                        setSavingOv(null);
                                        if (error) return toast.error(error.message);
                                        toast.success(t("تم الحفظ", "Saved"));
                                      }
                                      await loadOverrides();
                                      setOvDraft((c) => { const n = { ...c }; delete n[p.id]; return n; });
                                    }}
                                  >
                                    <Save className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0"
                                    onClick={() => openOvHistory(p)}
                                    title={t("سجل التعديلات اليدوية", "Override history")}
                                  >
                                    <Clock className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ) : ov ? (
                                <span className="tabular-nums">{fmtMoney(ov.cost_egp, "EGP", lang)}</span>
                              ) : (
                                <span className="text-muted-foreground text-[10px]">—</span>
                              )}
                            </td>
                          </tr>
                          {isOpen && entry && entry.lots.length > 0 && (
                            <tr className="bg-muted/20">
                              <td colSpan={8} className="px-3 py-2">
                                <div className="overflow-x-auto">
                                  <table className="w-full min-w-[640px] text-[11px]">
                                    <thead className="text-[10px] uppercase text-muted-foreground">
                                      <tr>
                                        <th className="px-2 py-1 text-start">PO</th>
                                        <th className="px-2 py-1 text-start">{t("التاريخ", "Date")}</th>
                                        <th className="px-2 py-1 text-start">{t("الحالة", "Status")}</th>
                                        <th className="px-2 py-1 text-end">{t("الكمية", "Qty")}</th>
                                        <th className="px-2 py-1 text-end">USD</th>
                                        <th className="px-2 py-1 text-end">{t("سعر USD", "USD Rate")}</th>
                                        <th className="px-2 py-1 text-end">EGP</th>
                                        <th className="px-2 py-1 text-end">{t("إجمالي EGP", "Total EGP")}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {entry.lots.map((l, i) => (
                                        <tr key={i} className="border-t border-border/40">
                                          <td className="px-2 py-1 font-mono">{l.shipment_code ?? l.po_id.slice(0, 8)}</td>
                                          <td className="px-2 py-1">{l.shipment_date ? fmtDate(l.shipment_date, lang) : "—"}</td>
                                          <td className="px-2 py-1"><span className="text-[9px] rounded border px-1 bg-muted">{l.status}</span></td>
                                          <td className="px-2 py-1 text-end tabular-nums">{fmtNumber(l.qty, lang)}</td>
                                          <td className="px-2 py-1 text-end tabular-nums">${Number(l.unit_usd).toFixed(2)}</td>
                                          <td className="px-2 py-1 text-end tabular-nums">{Number(l.usd_rate).toFixed(2)}</td>
                                          <td className="px-2 py-1 text-end tabular-nums">{fmtMoney(l.unit_egp, "EGP", lang)}</td>
                                          <td className="px-2 py-1 text-end tabular-nums font-semibold">{fmtMoney(l.line_total_egp, "EGP", lang)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Product Cost History across POs */}
      <ProductCostHistoryPanel costBook={costBook} products={products} t={t} lang={lang} />

      {/* KPIs */}
      {loading && items.length === 0 ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-busy="true" aria-live="polite">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="relative overflow-hidden rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="skeleton-noir h-2.5 w-20" />
                  <div className="skeleton-noir h-6 w-28" style={{ animationDelay: `${i * 90}ms` }} />
                  <div className="skeleton-noir h-2 w-16 opacity-70" />
                </div>
                <div className="skeleton-noir h-9 w-9 rounded-full" style={{ animationDelay: `${i * 90 + 60}ms` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={<Wallet className="h-4 w-4 text-sky-600" />}
          iconRing="bg-sky-500/15 ring-1 ring-sky-500/30"
          label={t("إجمالي البيع", "Revenue")}
          value={fmtMoney(rows.totals.revenue, "EGP", lang)}
          hint={t(`${rows.totals.lines} بند مبيعات`, `${rows.totals.lines} sold line(s)`)}
          className="from-sky-500/10 to-sky-500/[0.03] text-sky-700"
        />
        <KpiCard
          icon={<Coins className="h-4 w-4 text-amber-600" />}
          iconRing="bg-amber-500/15 ring-1 ring-amber-500/30"
          label={t("إجمالي التكلفة", "Cost")}
          value={fmtMoney(rows.totals.cost, "EGP", lang)}
          hint={t(`مصدر: ${costSourceLabel(costSource, t)}`, `Source: ${costSourceLabel(costSource, t)}`)}
          className="from-amber-500/10 to-amber-500/[0.03] text-amber-700"
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4 text-emerald-600" />}
          iconRing="bg-emerald-500/15 ring-1 ring-emerald-500/30"
          label={t("صافي الربح", "Net Profit")}
          value={fmtMoney(rows.totals.profit, "EGP", lang)}
          hint={t("إيراد − تكلفة (بدون شحن)", "Revenue − Cost (ex. shipping)")}
          className="from-emerald-500/15 to-emerald-500/[0.03] text-emerald-700"
        />
        <KpiCard
          icon={<Percent className="h-4 w-4 text-primary" />}
          iconRing="bg-primary/15 ring-1 ring-primary/30"
          label={t("هامش الربح", "Margin")}
          value={`${rows.totals.margin.toFixed(1)}%`}
          hint={rows.totals.margin >= 30 ? t("ممتاز", "Excellent") : rows.totals.margin >= 15 ? t("جيد", "Good") : t("يحتاج مراجعة", "Needs review")}
          className="from-primary/10 to-primary/[0.03] text-primary"
        />
      </div>
      )}
      <div className="flex flex-wrap items-center gap-2 -mt-1">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-500/30 bg-slate-500/10 px-3 py-1 text-[11px] text-slate-700 dark:text-slate-300">
          <Coins className="h-3 w-3" />
          {t("شحن/خدمة (مستبعد)", "Shipping/Fees (excluded)")}:
          <span className="tabular-nums font-bold">{fmtMoney(shippingTotals.amount, "EGP", lang)}</span>
          <span className="opacity-60">· {shippingTotals.lines} {t("بند", "line(s)")}</span>
        </span>
      </div>

      {/* 1. Reconciliation status ribbon */}
      {totalsMatch && (() => {
        const ok = totalsMatch.ok;
        const accent = ok ? "emerald" : "rose";
        return (
          <div
            className={[
              "relative overflow-hidden rounded-2xl border shadow-sm ring-1 ribbon-sheen transition-shadow duration-500 hover:shadow-[0_18px_40px_-18px_color-mix(in_oklab,var(--brand-ink)_45%,transparent)]",
              ok
                ? "border-emerald-500/25 ring-emerald-500/10 bg-gradient-to-l from-emerald-500/[0.08] via-transparent to-emerald-500/[0.02]"
                : "border-rose-500/30 ring-rose-500/10 bg-gradient-to-l from-rose-500/[0.09] via-transparent to-rose-500/[0.02]",
            ].join(" ")}
          >
            <div
              className="pointer-events-none absolute -top-16 -end-16 h-40 w-40 rounded-full opacity-40 blur-3xl"
              style={{ background: ok ? "radial-gradient(circle, rgba(16,185,129,0.35), transparent 70%)" : "radial-gradient(circle, rgba(244,63,94,0.35), transparent 70%)" }}
            />
            <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-${accent}-500/40 to-transparent`} />
            <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 min-w-0">
                <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ring-1 ${ok ? "bg-emerald-500/15 ring-emerald-500/30 text-emerald-600" : "bg-rose-500/15 ring-rose-500/30 text-rose-600"}`}>
                  {ok ? <ShieldCheck className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                </div>
                <div className="min-w-0">
                  <div className={`text-[10px] uppercase tracking-[0.2em] font-semibold ${ok ? "text-emerald-700/70" : "text-rose-700/70"}`}>
                    {t("مطابقة تلقائية", "Auto reconciliation")}
                  </div>
                  <div className={`mt-0.5 text-base sm:text-lg font-bold ${ok ? "text-emerald-800 dark:text-emerald-300" : "text-rose-800 dark:text-rose-300"}`}>
                    {ok
                      ? t("إجمالي البيع مطابق تمامًا للتقارير", "Revenue perfectly matches reports")
                      : t("يوجد فرق بين إجمالي البيع والتقارير", "Revenue differs from reports")}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-0 divide-x rtl:divide-x-reverse divide-border/60 rounded-xl border bg-background/60 backdrop-blur-sm shadow-inner">
                {[
                  { label: t("التقارير", "Reports"), value: totalsMatch.reportsTotal, tone: "text-foreground" },
                  { label: t("الأرباح", "Profits"), value: totalsMatch.profitsTotal, tone: "text-foreground" },
                  { label: t("الفرق", "Variance"), value: totalsMatch.diff, tone: ok ? "text-emerald-600" : "text-rose-600" },
                ].map((m) => (
                  <div key={m.label} className="px-3 sm:px-4 py-2 text-center min-w-[92px]">
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{m.label}</div>
                    <div className={`mt-0.5 text-xs sm:text-sm font-bold tabular-nums ${m.tone}`}>
                      {fmtMoney(m.value, "EGP", lang)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {(selectedIds.size > 0 || search.trim()) && (
        <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/[0.04] px-3.5 py-2.5 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/70" />
          <span className="leading-relaxed">
            {t("مطابقة التقارير التلقائية تُعرض عند عدم تقييد النتائج بفلتر منتج محدد أو بحث نصّي، لأن صفحة التقارير الحالية لا تطبق فلترة على مستوى المنتج.", "Automatic report matching is shown when no product-specific filter or text search is applied, because the reports page currently compares invoice totals rather than product-level subsets.")}
          </span>
        </div>
      )}

      {/* 2. Shipping / exclusions meta strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dashed border-border/70 bg-muted/20 px-3.5 py-2.5 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5 font-semibold text-foreground/70">
          <div className="grid h-5 w-5 place-items-center rounded-full bg-primary/10 ring-1 ring-primary/20">
            <Truck className="h-3 w-3 text-primary" />
          </div>
          <span>{t("مستبعد من الأرباح", "Excluded from profits")}</span>
        </div>
        <span className="opacity-60">·</span>
        <span className="inline-flex items-center gap-1 font-mono">
          <span className="tabular-nums font-bold text-foreground">{shippingTotals.lines}</span>
          <span>{t("بند شحن/خدمة", "shipping/service line(s)")}</span>
        </span>
        <span className="opacity-60">·</span>
        <span className="inline-flex items-center gap-1 font-mono">
          <span className="tabular-nums font-bold text-foreground">{shippingTotals.invoices}</span>
          <span>{t("فاتورة", "invoice(s)")}</span>
        </span>
        <span className="opacity-60">·</span>
        <span className="inline-flex items-center gap-1.5">
          <span>{t("قيمتها", "totalling")}</span>
          <span className="rounded-md bg-background border px-1.5 py-0.5 tabular-nums font-bold text-foreground shadow-sm">{fmtMoney(shippingTotals.amount, "EGP", lang)}</span>
        </span>
        <span className="opacity-60">·</span>
        <span className="flex items-center gap-1">
          <Ban className="h-3 w-3" />
          {t("الملغاة والمحذوفة مستبعدة كذلك", "voided/deleted also excluded")}
        </span>
      </div>

      {/* 3. Verification / Reconciliation ledger card */}
      <div className="relative overflow-hidden rounded-2xl border bg-card shadow-sm ring-1 ring-primary/10">
        <div className="pointer-events-none absolute -top-20 -end-20 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
        <button
          type="button"
          onClick={() => setVerifyOpen((v) => !v)}
          className="relative w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/20 transition"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ring-1 ${totalsMatch?.ok ? "bg-emerald-500/12 ring-emerald-500/25 text-emerald-600" : "bg-amber-500/12 ring-amber-500/25 text-amber-600"}`}>
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0 text-start">
              <div className="text-[10px] uppercase tracking-[0.2em] font-semibold text-muted-foreground">{t("محاسبة شفافة", "Transparent accounting")}</div>
              <h3 className="font-bold text-sm sm:text-base truncate flex items-center gap-2">
                {t("التحقق والمطابقة", "Verification & Reconciliation")}
                <span className={`text-[10px] rounded-full border px-2 py-0.5 font-semibold ${totalsMatch?.ok ? "border-emerald-500/40 text-emerald-700 bg-emerald-500/10" : "border-amber-500/40 text-amber-700 bg-amber-500/10"}`}>
                  {totalsMatch?.ok ? t("متطابق", "In sync") : t("مراجعة", "Review")}
                </span>
              </h3>
            </div>
          </div>
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm">
            {verifyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </button>
        <div className="absolute inset-x-4 top-[68px] h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent" />
        {verifyOpen && (
          <div className="relative border-t p-4 sm:p-5 space-y-4">
            <div className="grid gap-4 md:grid-cols-2 md:divide-x md:rtl:divide-x-reverse md:divide-primary/15">
              {/* Revenue reconciliation */}
              <div className="md:pe-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Wallet className="h-3.5 w-3.5 text-sky-600" />
                  <div className="text-[11px] uppercase tracking-widest font-bold text-muted-foreground">{t("مطابقة إجمالي البيع", "Revenue reconciliation")}</div>
                </div>
                <div className="space-y-2 text-sm">
                  <LedgerRow label={t("إجمالي الفواتير (قبل الاستبعادات)", "Sum of invoice totals (before exclusions)")} value={fmtMoney(totalsMatch?.reportsTotal ?? 0, "EGP", lang)} />
                  <LedgerRow label={t("− شحن/خدمة مستبعد", "− Shipping/fees excluded")} value={`− ${fmtMoney(shippingTotals.amount, "EGP", lang)}`} muted />
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-primary/25 font-bold">
                    <span className="text-xs sm:text-sm">{t("= إجمالي البيع المعتمد", "= Recognised revenue")}</span>
                    <span className="tabular-nums text-sm sm:text-base text-foreground">{fmtMoney(rows.totals.revenue, "EGP", lang)}</span>
                  </div>
                  {totalsMatch && (
                    <div className={`text-[11px] flex items-center gap-1.5 ${totalsMatch.ok ? "text-emerald-600" : "text-amber-700"}`}>
                      {totalsMatch.ok ? <ShieldCheck className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                      {totalsMatch.ok
                        ? t("الفرق صفر — مطابقة كاملة.", "Zero variance — fully reconciled.")
                        : `${t("الفرق", "Variance")}: ${fmtMoney(totalsMatch.diff, "EGP", lang)}`}
                    </div>
                  )}
                </div>
              </div>

              {/* Net profit reconciliation */}
              <div className="md:ps-5 space-y-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                  <div className="text-[11px] uppercase tracking-widest font-bold text-muted-foreground">{t("مطابقة صافي الربح", "Net profit reconciliation")}</div>
                </div>
                <div className="space-y-2 text-sm">
                  <LedgerRow label={t("إجمالي البيع المعتمد", "Recognised revenue")} value={fmtMoney(rows.totals.revenue, "EGP", lang)} />
                  <LedgerRow label={t(`− إجمالي التكلفة (مصدر: ${costSourceLabel(costSource, t)})`, `− Total cost (source: ${costSourceLabel(costSource, t)})`)} value={`− ${fmtMoney(rows.totals.cost, "EGP", lang)}`} muted />
                  <div className="relative flex items-center justify-between gap-2 pt-2 border-t border-emerald-500/30 font-bold">
                    <span className="absolute inset-y-2 -start-1 w-0.5 rounded bg-emerald-500" />
                    <span className="text-xs sm:text-sm text-emerald-700 ps-2">= {t("صافي الربح", "Net profit")}</span>
                    <span className="tabular-nums text-sm sm:text-base text-emerald-700">{fmtMoney(rows.totals.profit, "EGP", lang)}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <Percent className="h-3 w-3" />
                    {t("هامش الربح", "Margin")}: <span className="font-bold tabular-nums text-foreground">{rows.totals.margin.toFixed(2)}%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Causes grid */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <div className="text-[11px] uppercase tracking-widest font-bold text-muted-foreground">{t("سبب الاستبعادات", "Why the difference")}</div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <CauseCard icon={<Ban className="h-3.5 w-3.5" />} title={t("فواتير ملغاة/مسودّة", "Voided / draft invoices")} desc={t("تُستبعد تلقائيًا في الاستعلام.", "Excluded at query time.")} tone="rose" />
                <CauseCard icon={<Truck className="h-3.5 w-3.5" />} title={t("رسوم شحن/خدمة", "Shipping / service fees")} desc={`${shippingTotals.lines} × ${shippingTotals.invoices} — ${fmtMoney(shippingTotals.amount, "EGP", lang)}`} tone="sky" />
                <CauseCard icon={<Divide className="h-3.5 w-3.5" />} title={t("خصم على مستوى الفاتورة", "Invoice-level discount")} desc={t("يُوزَّع على البنود غير الشحن.", "Prorated over non-shipping lines.")} tone="amber" />
                <CauseCard icon={<Calculator className="h-3.5 w-3.5" />} title={t("مصدر التكلفة الفعّال", "Effective cost source")} desc={`${costSourceLabel(costSource, t)} — ${t("انعكاس لحظي.", "reflects live.")}`} tone="emerald" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. Daily trend hero chart */}
      {(() => {
        const trendStats = dailyTrend.length
          ? {
              latest: dailyTrend[dailyTrend.length - 1]?.profit ?? 0,
              peak: dailyTrend.reduce((m, d) => Math.max(m, d.profit), -Infinity),
              total: dailyTrend.reduce((s, d) => s + d.profit, 0),
              first: dailyTrend[0]?.date,
              last: dailyTrend[dailyTrend.length - 1]?.date,
            }
          : null;
        return (
          <div className="relative overflow-hidden rounded-2xl border bg-card shadow-sm ring-1 ring-primary/10">
            <div className="pointer-events-none absolute -top-24 end-1/4 h-52 w-52 rounded-full bg-primary/[0.08] blur-3xl" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
            <div className="relative flex flex-col gap-3 border-b bg-gradient-to-b from-muted/20 to-transparent px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-500/12 ring-1 ring-emerald-500/25 text-emerald-600">
                  <TrendingUp className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.2em] font-semibold text-muted-foreground">{t("سلسلة زمنية", "Time series")}</div>
                  <h3 className="font-bold text-sm sm:text-base truncate">
                    {t("اتجاه صافي الربح اليومي", "Daily net profit trend")}
                    <span className="ms-2 text-[11px] text-muted-foreground font-normal">· {t(`${dailyTrend.length} يوم`, `${dailyTrend.length} day(s)`)}</span>
                  </h3>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {trendStats && (
                  <div className="hidden md:grid grid-cols-3 divide-x rtl:divide-x-reverse divide-border/60 rounded-xl border bg-background/60 shadow-inner">
                    {[
                      { label: t("الأخير", "Latest"), value: trendStats.latest },
                      { label: t("الذروة", "Peak"), value: trendStats.peak },
                      { label: t("الإجمالي", "Total"), value: trendStats.total },
                    ].map((s) => (
                      <div key={s.label} className="px-3 py-1.5 text-center min-w-[90px]">
                        <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{s.label}</div>
                        <div className="text-xs font-bold tabular-nums text-emerald-700">{fmtMoney(s.value, "EGP", lang)}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="inline-flex rounded-full border border-primary/20 bg-muted/30 p-0.5 text-[11px] shadow-inner">
                  {(["profit", "all"] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setChartView(k)}
                      className={`rounded-full px-3 py-1 font-semibold transition ${chartView === k ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-background"}`}
                    >
                      {k === "profit" ? t("صافي الربح فقط", "Profit only") : t("الكل", "All")}
                    </button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 rounded-full border-primary/25 hover:bg-primary/5"
                  disabled={dailyTrend.length === 0}
                  onClick={() => {
                    const headers = [
                      t("التاريخ", "Date"),
                      t("الإيراد", "Revenue"),
                      t("التكلفة", "Cost"),
                      t("صافي الربح", "Net Profit"),
                    ];
                    const lines = [headers.join(",")];
                    for (const d of dailyTrend) {
                      lines.push([d.date, d.revenue.toFixed(2), d.cost.toFixed(2), d.profit.toFixed(2)].join(","));
                    }
                    const totals = dailyTrend.reduce((a, d) => ({ r: a.r + d.revenue, c: a.c + d.cost, p: a.p + d.profit }), { r: 0, c: 0, p: 0 });
                    lines.push([t("الإجمالي", "TOTAL"), totals.r.toFixed(2), totals.c.toFixed(2), totals.p.toFixed(2)].join(","));
                    const csv = "\uFEFF" + lines.join("\n");
                    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `profit_trend_${range}_${new Date().toISOString().slice(0, 10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success(t("تم تصدير CSV", "CSV exported"));
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                  CSV
                </Button>
              </div>
            </div>
            {/* Mobile mini-stats */}
            {trendStats && (
              <div className="md:hidden grid grid-cols-3 divide-x rtl:divide-x-reverse divide-border/60 border-b bg-muted/10">
                {[
                  { label: t("الأخير", "Latest"), value: trendStats.latest },
                  { label: t("الذروة", "Peak"), value: trendStats.peak },
                  { label: t("الإجمالي", "Total"), value: trendStats.total },
                ].map((s) => (
                  <div key={s.label} className="px-2 py-2 text-center">
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{s.label}</div>
                    <div className="text-[11px] font-bold tabular-nums text-emerald-700">{fmtMoney(s.value, "EGP", lang)}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="relative p-3 h-[280px]" dir={lang === "ar" ? "rtl" : "ltr"}>
              {dailyTrend.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                  <div className="grid h-12 w-12 place-items-center rounded-full border border-dashed border-border">
                    <LineChartIcon className="h-5 w-5 opacity-50" />
                  </div>
                  <span>{t("لا توجد بيانات لعرضها", "No data to display")}</span>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyTrend} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="profitGoldFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 4" className="stroke-muted-foreground/20" vertical={false} />
                    <XAxis
                      dataKey="date"
                      reversed={lang === "ar"}
                      tick={{ fontSize: 10, fill: "currentColor", opacity: 0.55 }}
                      tickFormatter={(v) => String(v).slice(5)}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      orientation={lang === "ar" ? "right" : "left"}
                      tick={{ fontSize: 10, fill: "currentColor", opacity: 0.55 }}
                      tickFormatter={(v) => fmtNumber(Number(v), lang)}
                      axisLine={false}
                      tickLine={false}
                      width={60}
                    />
                    <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.15} strokeDasharray="3 3" />
                    <Tooltip
                      cursor={{ stroke: "hsl(var(--primary))", strokeOpacity: 0.4, strokeDasharray: "3 3" }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload || !payload.length) return null;
                        return (
                          <div className="rounded-xl border border-primary/30 bg-card/95 backdrop-blur px-3 py-2 shadow-xl min-w-[160px]" dir={lang === "ar" ? "rtl" : "ltr"}>
                            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground border-b border-primary/15 pb-1 mb-1.5">
                              {fmtDate(String(label), lang)}
                            </div>
                            <div className="space-y-1">
                              {payload.map((p: any) => (
                                <div key={p.dataKey} className="flex items-center justify-between gap-3 text-xs">
                                  <span className="flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                                    <span className="text-muted-foreground">{p.name}</span>
                                  </span>
                                  <span className="tabular-nums font-bold" style={{ color: p.color }}>{fmtMoney(Number(p.value), "EGP", lang)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Area type="monotone" dataKey="profit" name={t("صافي الربح", "Net Profit")} stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#profitGoldFill)" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--background))" }} />
                    {chartView === "all" && (
                      <Line type="monotone" dataKey="revenue" name={t("البيع", "Revenue")} stroke="#0ea5e9" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                    )}
                    {chartView === "all" && (
                      <Line type="monotone" dataKey="cost" name={t("التكلفة", "Cost")} stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
            {trendStats && (
              <div className="flex items-center justify-center gap-2 border-t bg-muted/10 px-3 py-1.5 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span className="tabular-nums font-semibold text-foreground/70">{trendStats.first}</span>
                <ArrowRight className={`h-3 w-3 opacity-50 ${lang === "ar" ? "rotate-180" : ""}`} />
                <span className="tabular-nums font-semibold text-foreground/70">{trendStats.last}</span>
              </div>
            )}
          </div>
        );
      })()}


      {/* Products table — Noir & Gold */}
      {(() => {
        const activeRows = rows.list.filter((r) => r.qty > 0);
        const topRow = activeRows[0];
        const avgMargin = activeRows.length > 0
          ? activeRows.reduce((s, r) => s + r.margin, 0) / activeRows.length
          : 0;
        const totalProfit = activeRows.reduce((s, r) => s + r.profit, 0);
        const maxAbsProfit = Math.max(1, ...activeRows.map((r) => Math.abs(r.profit)));
        // Rank by profit (for medals) — independent of user sort
        const profitRankIndex = new Map<string, number>();
        [...rows.list]
          .filter((r) => r.qty > 0)
          .sort((a, b) => b.profit - a.profit)
          .forEach((r, i) => profitRankIndex.set(r.product_id, i));
        // Local search + sort for product table
        const s = ptSearch.trim().toLowerCase();
        const searched = s
          ? rows.list.filter((r) =>
              r.name.toLowerCase().includes(s) ||
              (r.product?.serial_number ?? "").toLowerCase().includes(s) ||
              (r.product?.color ?? "").toLowerCase().includes(s) ||
              (r.product?.collection ?? "").toLowerCase().includes(s)
            )
          : rows.list;
        const dir = ptSort.dir === "asc" ? 1 : -1;
        const displayRows = [...searched].sort((a, b) => {
          if (a.qty === 0 && b.qty === 0) return a.name.localeCompare(b.name);
          if (a.qty === 0) return 1;
          if (b.qty === 0) return -1;
          if (ptSort.field === "name") return a.name.localeCompare(b.name) * dir;
          if (ptSort.field === "qty") return (a.qty - b.qty) * dir;
          if (ptSort.field === "margin") return (a.margin - b.margin) * dir;
          return (a.profit - b.profit) * dir;
        });
        const rankMedal = (rank: number | undefined) => {
          if (rank === 0) return { label: "1", cls: "bg-gradient-to-br from-amber-300 to-yellow-600 text-black shadow-[0_0_10px_rgba(234,179,8,0.5)] ring-1 ring-amber-200/60" };
          if (rank === 1) return { label: "2", cls: "bg-gradient-to-br from-slate-200 to-slate-400 text-black ring-1 ring-slate-100/60" };
          if (rank === 2) return { label: "3", cls: "bg-gradient-to-br from-orange-400 to-amber-700 text-white ring-1 ring-orange-300/50" };
          return null;
        };
        const SortBtn = ({ field, label }: { field: typeof ptSort.field; label: string }) => {
          const active = ptSort.field === field;
          return (
            <button
              type="button"
              onClick={() => setPtSort((cur) => cur.field === field ? { field, dir: cur.dir === "asc" ? "desc" : "asc" } : { field, dir: "desc" })}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${active ? "border-primary/50 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:border-primary/30 hover:text-foreground"}`}
              title={t("ترتيب", "Sort")}
            >
              {label}
              {active && (ptSort.dir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
            </button>
          );
        };
        return (
        <div className="relative rounded-2xl overflow-hidden noir-surface border border-primary/20 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.4)]">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

          {/* Luxury header */}
          <div className="relative px-5 py-4 border-b border-primary/15 bg-gradient-to-br from-background via-background to-primary/5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative h-11 w-11 rounded-xl bg-gradient-to-br from-primary/25 to-primary/5 border border-primary/30 flex items-center justify-center shrink-0">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <span className="absolute -inset-0.5 rounded-xl bg-primary/10 blur-md -z-10" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-base tracking-tight bg-gradient-to-r from-foreground to-primary/80 bg-clip-text text-transparent">
                    {t("ربح كل منتج", "Per-Product Profit")}
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {t("ترتيب حسب الربح • مرتّب تنازليًا", "Ranked by profit • descending")}
                    {loading && <span className="ms-2 inline-flex items-center gap-1 text-primary/70"><RefreshCw className="h-3 w-3 animate-spin" />{t("تحديث…", "syncing…")}</span>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="rounded-lg border border-primary/20 bg-gradient-to-br from-primary/10 to-transparent px-3 py-1.5">
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{t("المنتجات", "Products")}</div>
                  <div className="text-sm font-bold tabular-nums">{fmtNumber(activeRows.length, lang)}<span className="text-muted-foreground/50 text-xs">/{fmtNumber(rows.list.length, lang)}</span></div>
                </div>
                <div className={`rounded-lg border px-3 py-1.5 ${totalProfit >= 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5"}`}>
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{t("إجمالي الربح", "Total Profit")}</div>
                  <div className={`text-sm font-bold tabular-nums ${totalProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"}`}>{fmtMoney(totalProfit, "EGP", lang)}</div>
                </div>
                <div className="rounded-lg border border-primary/20 bg-gradient-to-br from-primary/10 to-transparent px-3 py-1.5">
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{t("متوسط الهامش", "Avg Margin")}</div>
                  <div className="text-sm font-bold tabular-nums text-primary">{avgMargin.toFixed(1)}%</div>
                </div>
                {topRow && (
                  <div className="rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-transparent px-3 py-1.5 max-w-[220px]">
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1">
                      <span className="text-amber-500">★</span>{t("الأعلى ربحًا", "Top performer")}
                    </div>
                    <div className="text-sm font-bold truncate text-amber-700 dark:text-amber-300">{topRow.name}</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Toolbar: search + sort */}
          <div className="border-b border-primary/10 bg-background/40 px-4 py-2.5 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Filter className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
              <Input
                value={ptSearch}
                onChange={(e) => setPtSearch(e.target.value)}
                placeholder={t("ابحث باسم المنتج أو الكود أو اللون…", "Search product name, code, color…")}
                className="h-8 ps-8 text-xs"
              />
              {ptSearch && (
                <button type="button" onClick={() => setPtSearch("")} className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground" title={t("مسح", "Clear")}>
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70 font-semibold me-1">{t("ترتيب", "Sort")}</span>
              <SortBtn field="profit" label={t("الربح", "Profit")} />
              <SortBtn field="qty" label={t("الكمية", "Qty")} />
              <SortBtn field="margin" label={t("الهامش", "Margin")} />
              <SortBtn field="name" label={t("الاسم", "Name")} />
            </div>
            <div className="ms-auto text-[11px] text-muted-foreground tabular-nums">
              {t("النتائج", "Results")}: <span className="font-bold text-foreground">{fmtNumber(displayRows.length, lang)}</span>
              {ptSearch && <span> / {fmtNumber(rows.list.length, lang)}</span>}
            </div>
          </div>

          {/* Mobile card view */}
          <div className="md:hidden divide-y divide-border/40">
            {displayRows.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <div className="h-12 w-12 rounded-full bg-primary/5 border border-primary/20 flex items-center justify-center">
                    <BookOpen className="h-5 w-5 text-primary/60" />
                  </div>
                  <div className="text-sm font-medium">{t("لا توجد نتائج", "No results")}</div>
                </div>
              </div>
            ) : displayRows.map((r) => {
              const p = r.product;
              const rank = profitRankIndex.get(r.product_id);
              const medal = r.qty > 0 ? rankMedal(rank) : null;
              const isTop = medal !== null;
              const profitBarPct = Math.min(100, (Math.abs(r.profit) / maxAbsProfit) * 100);
              const marginPct = Math.max(0, Math.min(100, r.margin));
              const marginColor = r.margin >= 30 ? "text-emerald-600 dark:text-emerald-400"
                : r.margin >= 10 ? "text-primary"
                : r.margin >= 0 ? "text-amber-600 dark:text-amber-400"
                : "text-rose-600";
              const marginBar = r.margin >= 30 ? "bg-gradient-to-r from-emerald-500 to-emerald-300"
                : r.margin >= 10 ? "bg-gradient-to-r from-primary to-amber-300"
                : r.margin >= 0 ? "bg-gradient-to-r from-amber-500 to-amber-300"
                : "bg-gradient-to-r from-rose-500 to-rose-300";
              return (
                <button
                  key={r.product_id}
                  type="button"
                  onClick={() => setProductDetailId(r.product_id)}
                  className={`w-full text-start px-4 py-3 hover:bg-primary/[0.04] transition-colors ${isTop ? "bg-gradient-to-r from-amber-500/[0.05] via-transparent to-transparent" : ""} ${r.profit < 0 ? "bg-rose-500/[0.03]" : ""}`}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg border bg-muted ${isTop ? "ring-2 ring-amber-400/50 border-amber-400/40" : "border-border/60"}`}>
                        {p?.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {medal && <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black shrink-0 ${medal.cls}`}>{medal.label}</span>}
                          <span className="truncate font-semibold text-sm">{r.name}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground flex gap-2 flex-wrap mt-0.5">
                          {p?.collection && (
                            <span className={`inline-flex items-center gap-1 rounded border px-1 py-px text-[9px] font-bold ${collectionBadgeClass(p.collection)}`}>
                              <span className={`inline-block h-1 w-1 rounded-full ${collectionDotClass(p.collection)}`} />
                              {p.collection}
                            </span>
                          )}
                          {p?.color && (
                            <span className="inline-flex items-center gap-1"><ColorSwatch value={p.color} size="sm" />{p.color}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground/50 -rotate-90 rtl:rotate-90" />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                    <div className="rounded-lg border border-border/50 bg-background/40 px-2 py-1.5">
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground/70 font-semibold">{t("الكمية", "Qty")}</div>
                      <div className="tabular-nums font-bold text-sm">{fmtNumber(r.qty, lang)}</div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-background/40 px-2 py-1.5">
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground/70 font-semibold">{t("البيع", "Revenue")}</div>
                      <div className="tabular-nums font-semibold">{fmtMoney(r.revenue, "EGP", lang)}</div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-background/40 px-2 py-1.5">
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground/70 font-semibold">{t("التكلفة", "Cost")}</div>
                      <div className="tabular-nums text-muted-foreground">{fmtMoney(r.cost, "EGP", lang)}</div>
                    </div>
                  </div>
                  {r.qty > 0 && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <div className="flex items-center justify-between text-[10px] mb-1">
                          <span className="text-muted-foreground/70 font-semibold uppercase tracking-widest">{t("الربح", "Profit")}</span>
                          <span className={`tabular-nums font-bold ${r.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"}`}>{fmtMoney(r.profit, "EGP", lang)}</span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-muted/50 overflow-hidden">
                          <div className={`h-full ${r.profit >= 0 ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : "bg-gradient-to-r from-rose-600 to-rose-400"}`} style={{ width: `${profitBarPct}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-[10px] mb-1">
                          <span className="text-muted-foreground/70 font-semibold uppercase tracking-widest">{t("الهامش", "Margin")}</span>
                          <MarginPill margin={r.margin} size="xs" />
                        </div>
                        <div className="h-1 w-full rounded-full bg-muted/50 overflow-hidden">
                          <div className={`h-full ${marginBar}`} style={{ width: `${marginPct}%` }} />
                        </div>
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 text-[10px] uppercase tracking-[0.15em] text-primary/90 font-bold">
                  <th className="px-3 py-3 text-center w-12">#</th>
                  <th className="px-3 py-3 text-start">{t("المنتج", "Product")}</th>
                  <th className="px-3 py-3 text-end">{t("الكمية", "Qty")}</th>
                  <th className="px-3 py-3 text-end">{t("سعر التكلفة", "Cost")}</th>
                  <th className="px-3 py-3 text-end">{t("سعر البيع", "Sale")}</th>
                  <th className="px-3 py-3 text-end">{t("إجمالي التكلفة", "Total Cost")}</th>
                  <th className="px-3 py-3 text-end">{t("إجمالي البيع", "Revenue")}</th>
                  <th className="px-3 py-3 text-end">{t("صافي الربح", "Profit")}</th>
                  <th className="px-3 py-3 text-end min-w-[130px]">{t("هامش %", "Margin")}</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {displayRows.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <div className="h-12 w-12 rounded-full bg-primary/5 border border-primary/20 flex items-center justify-center">
                        <BookOpen className="h-5 w-5 text-primary/60" />
                      </div>
                      <div className="text-sm font-medium">{ptSearch ? t("لا نتائج مطابقة للبحث", "No matching results") : t("لا توجد بيانات في هذا النطاق", "No data in this range")}</div>
                      <div className="text-[11px]">{t("جرّب تعديل الفلاتر أو النطاق الزمني", "Try adjusting filters or the date range")}</div>
                    </div>
                  </td></tr>
                ) : displayRows.map((r, idx) => {
                  const p = r.product;
                  const e = p ? editing[p.id] : undefined;
                  const srcLabel = r.costSourceUsed === "override" ? t("تعديل يدوي", "Manual override")
                    : r.costSourceUsed === "wac" ? t("متوسط مرجّح (WAC)", "Weighted avg (WAC)")
                    : r.costSourceUsed === "latest_po" ? t("آخر أمر شراء", "Latest PO")
                    : t("التكلفة الحالية", "Current cost");
                  const srcTag = r.costSourceUsed === "override" ? "MAN"
                    : r.costSourceUsed === "wac" ? "WAC"
                    : r.costSourceUsed === "latest_po" ? "LPO"
                    : "CUR";
                  const srcTagClass = r.costSourceUsed === "override"
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
                    : r.costSourceUsed === "wac"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25"
                    : r.costSourceUsed === "latest_po"
                    ? "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25"
                    : "bg-muted text-muted-foreground border-border";
                  const rank = profitRankIndex.get(r.product_id);
                  const medal = r.qty > 0 ? rankMedal(rank) : null;
                  const isTop = medal !== null;
                  const profitBarPct = Math.min(100, (Math.abs(r.profit) / maxAbsProfit) * 100);
                  const marginPct = Math.max(0, Math.min(100, r.margin));
                  return (
                    <Fragment key={r.product_id}>
                    <tr className={`group transition-colors duration-200 hover:bg-primary/[0.04] ${r.profit < 0 ? "bg-rose-500/[0.03]" : ""} ${r.missingCost ? "border-s-2 border-amber-500/60" : ""} ${isTop ? "bg-gradient-to-r from-amber-500/[0.04] via-transparent to-transparent" : ""}`}>
                      <td className="px-3 py-3 text-center">
                        {medal ? (
                          <div className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black ${medal.cls}`}>{medal.label}</div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/60 tabular-nums font-mono">{r.qty > 0 ? idx + 1 : "—"}</span>
                        )}
                      </td>

                      <td className="px-3 py-3">
                        <button type="button" onClick={() => setProductDetailId(r.product_id)} className="flex items-center gap-3 min-w-0 text-start hover:text-primary transition-colors" title={t("عرض تفاصيل المنتج", "View product details")}>
                          <div className={`h-11 w-11 shrink-0 overflow-hidden rounded-lg border bg-muted transition-transform duration-200 group-hover:scale-105 ${isTop ? "ring-2 ring-amber-400/50 border-amber-400/40 shadow-[0_0_12px_-2px_rgba(234,179,8,0.4)]" : "border-border/60"}`}>
                            {p?.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full flex items-center justify-center text-muted-foreground/40 text-[10px]">—</div>}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold truncate flex items-center gap-1.5">
                              {r.name}
                              {p?.collection && (
                                <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold ${collectionBadgeClass(p.collection)}`}>
                                  <span className={`inline-block h-1 w-1 rounded-full ${collectionDotClass(p.collection)}`} />
                                  {p.collection}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground flex gap-2 flex-wrap mt-0.5">
                              {p?.serial_number && <span className="font-mono opacity-80">{p.serial_number}</span>}
                              {p?.color && (
                                <span className="inline-flex items-center gap-1">
                                  <ColorSwatch value={p.color} size="sm" />
                                  {p.color}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      </td>
                      <td className="px-3 py-3 text-end tabular-nums font-medium">{fmtNumber(r.qty, lang)}</td>
                      <td className={`px-3 py-3 text-end ${r.missingCost ? "ring-1 ring-inset ring-amber-500/40 bg-amber-500/5" : ""}`}>
                        {p && e ? (
                          <Input
                            type="number"
                            step="0.01"
                            value={e.cost}
                            onChange={(ev) => setEditing((cur) => ({ ...cur, [p.id]: { ...cur[p.id], cost: ev.target.value } }))}
                            className="h-8 w-24 text-end"
                          />
                        ) : r.qty === 0 && r.unitCost === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div
                            className="inline-flex items-center gap-1.5 justify-end"
                            title={r.missingCost
                              ? t("لا توجد بيانات تكلفة لهذا المنتج — الربح مبالغ فيه", "No cost data for this product — profit is overstated")
                              : `${t("المصدر", "Source")}: ${srcLabel}`}
                          >
                            {r.missingCost && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                            <span className="tabular-nums">{fmtMoney(r.unitCost, "EGP", lang)}</span>
                            <span className={`text-[9px] font-bold rounded border px-1 py-0.5 leading-none ${srcTagClass}`}>{srcTag}</span>
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-3 text-end">
                        {p && e ? (
                          <Input
                            type="number"
                            step="0.01"
                            value={e.sale}
                            onChange={(ev) => setEditing((cur) => ({ ...cur, [p.id]: { ...cur[p.id], sale: ev.target.value } }))}
                            className="h-8 w-24 text-end"
                          />
                        ) : (
                          <span className="tabular-nums">{fmtMoney(Number(p?.price ?? 0), "EGP", lang)}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-end tabular-nums text-muted-foreground">{fmtMoney(r.cost, "EGP", lang)}</td>
                      <td className="px-3 py-3 text-end tabular-nums font-medium">{fmtMoney(r.revenue, "EGP", lang)}</td>
                      <td className="px-3 py-3 text-end">
                        {r.qty > 0 ? (
                          <div className="inline-flex flex-col items-end gap-1">
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums border ${r.profit >= 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" : "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30"}`}>
                              {r.profit >= 0 ? <TrendingUp className="h-3 w-3" /> : <ArrowRight className="h-3 w-3 rotate-90" />}
                              {fmtMoney(r.profit, "EGP", lang)}
                            </span>
                            <div className="h-1 w-24 rounded-full bg-muted/50 overflow-hidden">
                              <div className={`h-full rounded-full ${r.profit >= 0 ? "bg-gradient-to-r from-emerald-500/70 to-emerald-400" : "bg-gradient-to-r from-rose-500/70 to-rose-400"}`} style={{ width: `${profitBarPct}%` }} />
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-end">
                        {r.qty > 0 ? (
                          <div className="inline-flex flex-col items-end gap-1 min-w-[110px]">
                            <MarginPill margin={r.margin} size="sm" />
                            <div className="h-1.5 w-full rounded-full bg-muted/50 overflow-hidden">
                              <div className={`h-full rounded-full ${r.margin >= 30 ? "bg-gradient-to-r from-emerald-500 to-emerald-300" : r.margin >= 10 ? "bg-gradient-to-r from-primary to-amber-300" : r.margin >= 0 ? "bg-gradient-to-r from-amber-500 to-amber-300" : "bg-gradient-to-r from-rose-500 to-rose-300"}`} style={{ width: `${marginPct}%` }} />
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-end">
                        <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                          {p && (
                            e ? (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => cancelEdit(p.id)} className="h-7 px-2">×</Button>
                                <Button size="sm" disabled={savingId === p.id} onClick={() => saveEdit(p)} className="h-7 px-2 gap-1">
                                  <Save className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => startEdit(p)} className="h-7 text-xs">
                                  {t("تعديل", "Edit")}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => openHistory(p)} className="h-7 px-1.5" title={t("سجل الأسعار", "Price history")}>
                                  <History className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setExpanded((cur) => ({ ...cur, [r.product_id]: !cur[r.product_id] }))} className="h-7 px-1.5" title={t("التفاصيل", "Details")}>
                            {expanded[r.product_id] ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {expanded[r.product_id] && (
                      <tr key={r.product_id + ":d"} className="bg-gradient-to-br from-primary/[0.03] via-transparent to-primary/[0.03]">
                        <td colSpan={10} className="px-4 py-4">
                          <div className="grid gap-3 md:grid-cols-2 text-xs">
                            <div className="rounded-xl border border-primary/15 bg-card/80 backdrop-blur p-3 shadow-sm">
                              <div className="text-[11px] font-semibold uppercase tracking-wider text-primary/80 mb-2 flex items-center gap-1.5">
                                <Calculator className="h-3.5 w-3.5" />
                                {t("معادلة الحساب", "Calculation")}
                              </div>
                              <div className="space-y-1.5 font-mono">
                                <div>{t("سعر التكلفة (وحدة)", "Unit cost")}: <span className="tabular-nums">{fmtMoney(r.unitCost, "EGP", lang)}</span> <span className={`text-[9px] font-bold rounded border px-1 py-0.5 leading-none ${srcTagClass}`}>{srcTag}</span></div>
                                <div>{t("مصدر التكلفة", "Cost source")}: <span className="font-semibold">{srcLabel}</span></div>
                                <div>{t("سعر البيع", "Sale")}: <span className="tabular-nums">{fmtMoney(Number(p?.price ?? 0), "EGP", lang)}</span></div>
                                <div>{t("الكمية المباعة", "Sold qty")}: <span className="tabular-nums">{fmtNumber(r.qty, lang)}</span></div>
                                <div>{t("عدد بنود الفواتير", "Invoice lines")}: <span className="tabular-nums">{fmtNumber(r.lines, lang)}</span></div>
                                {r.missingCost && (
                                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
                                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                    <span>{t("⚠ لا يوجد سعر تكلفة مسجّل لهذا المنتج — الربح مبالغ فيه", "No cost price recorded — profit is overstated")}</span>
                                  </div>
                                )}
                                <div className="pt-1.5 border-t border-primary/10">
                                  {t("إجمالي التكلفة", "Total Cost")} = {fmtMoney(r.unitCost, "EGP", lang)} × {fmtNumber(r.qty, lang)} = <span className="font-semibold tabular-nums">{fmtMoney(r.cost, "EGP", lang)}</span>
                                </div>
                                <div>
                                  {t("إجمالي البيع", "Revenue")} = Σ(unit × qty − discount) = <span className="font-semibold tabular-nums">{fmtMoney(r.revenue, "EGP", lang)}</span>
                                </div>
                                <div className={`pt-1 font-semibold ${r.profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                  {t("صافي الربح", "Profit")} = {fmtMoney(r.revenue, "EGP", lang)} − {fmtMoney(r.cost, "EGP", lang)} = <span className="tabular-nums">{fmtMoney(r.profit, "EGP", lang)}</span>
                                </div>
                                <div>
                                  {t("الهامش", "Margin")} = ({fmtMoney(r.profit, "EGP", lang)} ÷ {fmtMoney(r.revenue, "EGP", lang)}) × 100 = <span className="font-semibold">{r.margin.toFixed(2)}%</span>
                                </div>
                              </div>
                            </div>
                            <div className="rounded-xl border border-primary/15 bg-card/80 backdrop-blur p-3 shadow-sm">
                              <div className="text-[11px] font-semibold uppercase tracking-wider text-primary/80 mb-2 flex items-center gap-1.5">
                                <Receipt className="h-3.5 w-3.5" />
                                {t("بنود الفواتير المعتمدة", "Counted invoice lines")} ({fmtNumber(items.filter((it) => it.product_id === r.product_id && !isShippingLine(it)).length, lang)})
                              </div>
                              <div className="max-h-44 overflow-y-auto divide-y divide-border/40 text-[11px]">
                                {items
                                  .filter((it) => it.product_id === r.product_id && !isShippingLine(it))
                                  .slice(0, 50)
                                  .map((it, i) => (
                                    <div key={i} className="py-1.5 flex items-center justify-between gap-2 hover:bg-primary/5 rounded px-1 transition-colors">
                                      <span className="font-mono text-primary/80">{it.invoices?.invoice_number}</span>
                                      <span className="text-muted-foreground">{it.invoices?.created_at?.slice(0,10)}</span>
                                      <span className="tabular-nums">×{it.quantity}</span>
                                      <span className="tabular-nums font-medium">{fmtMoney(Number(it.line_total ?? 0), "EGP", lang)}</span>
                                    </div>
                                  ))}
                                {items.filter((it) => it.product_id === r.product_id && !isShippingLine(it)).length === 0 && (
                                  <div className="py-3 text-center text-muted-foreground">{t("لا توجد مبيعات في النطاق", "No sales in range")}</div>
                                )}
                              </div>
                              <div className="mt-2 text-[10px] text-muted-foreground italic">
                                {t("الفواتير الملغية والمحذوفة ورسوم الشحن مستبعدة تلقائيًا.", "Voided/deleted invoices and shipping fees are auto-excluded.")}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        );
      })()}

      {/* Per-invoice profit — Noir & Gold */}
      {(() => {
        const invRankMedal = (i: number) => {
          if (i === 0) return { label: "1", cls: "bg-gradient-to-br from-amber-300 to-yellow-600 text-black shadow-[0_0_10px_rgba(234,179,8,0.5)] ring-1 ring-amber-200/60" };
          if (i === 1) return { label: "2", cls: "bg-gradient-to-br from-slate-200 to-slate-400 text-black ring-1 ring-slate-100/60" };
          if (i === 2) return { label: "3", cls: "bg-gradient-to-br from-orange-400 to-amber-700 text-white ring-1 ring-orange-300/50" };
          return null;
        };
        // Available statuses (from data)
        const statusSet = new Set<string>();
        for (const r of invoiceRows) if (r.status) statusSet.add(r.status);
        const statusList = Array.from(statusSet).sort();
        // Apply invoice-scoped filters
        const invSearchLc = invSearch.trim().toLowerCase();
        const fromMs = invFrom ? new Date(invFrom + "T00:00:00").getTime() : null;
        const toMs = invTo ? new Date(invTo + "T23:59:59").getTime() : null;
        const filteredInvoices = invoiceRows.filter((r) => {
          if (invStatus !== "all" && r.status !== invStatus) return false;
          if (fromMs !== null) {
            const ts = r.created_at ? new Date(r.created_at).getTime() : 0;
            if (ts < fromMs) return false;
          }
          if (toMs !== null) {
            const ts = r.created_at ? new Date(r.created_at).getTime() : 0;
            if (ts > toMs) return false;
          }
          if (invSearchLc) {
            const hay = `${r.invoice_number} ${r.customer_name ?? ""}`.toLowerCase();
            if (!hay.includes(invSearchLc)) return false;
          }
          return true;
        });
        const rankedInvoices = [...filteredInvoices].sort((a, b) => b.profit - a.profit);
        // Pagination (page size grows via Load More)
        const visibleInvoices = rankedInvoices.slice(0, invPageSize);
        const invHasMore = rankedInvoices.length > visibleInvoices.length;
        // Customer autocomplete suggestions: unique names from invoices + customers list
        const invCustomerSuggestions: string[] = (() => {
          const q = invSearch.trim().toLowerCase();
          if (!q) return [];
          const set = new Set<string>();
          for (const r of invoiceRows) if (r.customer_name) set.add(r.customer_name);
          for (const c of customers) if (c.name) set.add(c.name);
          const all = Array.from(set);
          const match = all.filter((n) => n.toLowerCase().includes(q));
          match.sort((a, b) => {
            const ai = a.toLowerCase().indexOf(q);
            const bi = b.toLowerCase().indexOf(q);
            if (ai !== bi) return ai - bi;
            return a.localeCompare(b);
          });
          return match.slice(0, 8);
        })();
        const invMaxAbsProfit = Math.max(1, ...rankedInvoices.map((r) => Math.abs(r.profit)));
        const invTotalProfit = rankedInvoices.reduce((s, r) => s + r.profit, 0);
        const invTotalRevenue = rankedInvoices.reduce((s, r) => s + r.revenue, 0);
        const invAvgMargin = rankedInvoices.length > 0
          ? rankedInvoices.reduce((s, r) => s + r.margin, 0) / rankedInvoices.length
          : 0;
        const invTop = rankedInvoices[0];
        // Trend bucket (day/week) from filtered invoices
        const bucketKey = (iso: string) => {
          if (!iso) return "";
          const d = new Date(iso);
          if (invTrendMode === "day") return d.toISOString().slice(0, 10);
          // ISO week bucket: monday of that week
          const day = (d.getUTCDay() + 6) % 7; // 0=Mon
          const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
          return mon.toISOString().slice(0, 10);
        };
        const trendMap = new Map<string, { profit: number; revenue: number; qty: number }>();
        for (const r of filteredInvoices) {
          const k = bucketKey(r.created_at);
          if (!k) continue;
          const cur = trendMap.get(k) ?? { profit: 0, revenue: 0, qty: 0 };
          cur.profit += r.profit;
          cur.revenue += r.revenue;
          cur.qty += r.items;
          trendMap.set(k, cur);
        }
        const invTrend = Array.from(trendMap.entries())
          .sort((a, b) => (a[0] > b[0] ? 1 : -1))
          .map(([date, v]) => ({ date, profit: v.profit, revenue: v.revenue, qty: v.qty, avg: v.qty > 0 ? v.revenue / v.qty : 0 }));
        const marginTone = (m: number) =>
          m >= 40 ? { text: "text-emerald-600 dark:text-emerald-400", bar: "bg-gradient-to-r from-emerald-500 to-emerald-400" }
          : m >= 20 ? { text: "text-amber-600 dark:text-amber-300", bar: "bg-gradient-to-r from-amber-500 to-yellow-400" }
          : m >= 0 ? { text: "text-orange-600 dark:text-orange-300", bar: "bg-gradient-to-r from-orange-500 to-amber-400" }
          : { text: "text-rose-600 dark:text-rose-400", bar: "bg-gradient-to-r from-rose-600 to-rose-400" };
        return (
        <div className="relative rounded-2xl overflow-hidden noir-surface border border-primary/20 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.4)]">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

          {/* Luxury header */}
          <div className="relative px-5 py-4 border-b border-primary/15 bg-gradient-to-br from-background via-background to-primary/5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative h-11 w-11 rounded-xl bg-gradient-to-br from-primary/25 to-primary/5 border border-primary/30 flex items-center justify-center shrink-0">
                  <Receipt className="h-5 w-5 text-primary" />
                  <span className="absolute -inset-0.5 rounded-xl bg-primary/10 blur-md -z-10" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-base tracking-tight bg-gradient-to-r from-foreground to-primary/80 bg-clip-text text-transparent">
                    {t("ربح كل فاتورة", "Per-Invoice Profit")}
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {t("ترتيب حسب الربح • انقر الصف لعرض التفاصيل", "Ranked by profit • click any row for details")}
                    {loading && <span className="ms-2 inline-flex items-center gap-1 text-primary/70"><RefreshCw className="h-3 w-3 animate-spin" />{t("تحديث…", "syncing…")}</span>}
                  </p>
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setRtPaused((v) => !v)}
                      title={rtPaused ? t("استئناف التحديثات المباشرة", "Resume realtime updates") : t("إيقاف مؤقت للتحديثات المباشرة", "Pause realtime updates")}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold transition ${rtPaused ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${rtPaused ? "bg-amber-500" : "bg-emerald-500 animate-pulse"}`} />
                      {rtPaused
                        ? t(`متوقف${rtPending.size ? ` (${rtPending.size} معلّق)` : ""}`, `Paused${rtPending.size ? ` (${rtPending.size} pending)` : ""}`)
                        : t("مباشر", "Live")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPerf((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground transition"
                      title={t("مقاييس الأداء", "Performance metrics")}
                    >
                      <Clock className="h-2.5 w-2.5" />
                      {t("أداء", "Perf")}
                    </button>
                    {showPerf && (
                      <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.04] px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                        <span title={t("عدد مرات الإخراج", "Renders")}><span className="text-primary/80 font-bold">R</span>{renderCountRef.current}</span>
                        <span className="opacity-40">·</span>
                        <span title={t("زمن آخر إخراج", "Last render")}><span className="text-primary/80 font-bold">t</span>{lastRenderMs.toFixed(1)}ms</span>
                        <span className="opacity-40">·</span>
                        <span title={t("متوسط زمن الإخراج", "Avg render")}><span className="text-primary/80 font-bold">avg</span>{avgRenderMs.toFixed(1)}ms</span>
                        <span className="opacity-40">·</span>
                        <span title={t("تحديثات Realtime المطبّقة", "Realtime updates applied")}><span className="text-primary/80 font-bold">U</span>{updateCount}</span>
                        {lastUpdateAt && (
                          <>
                            <span className="opacity-40">·</span>
                            <span title={t("آخر تحديث", "Last update")}>{Math.max(0, Math.round((Date.now() - lastUpdateAt) / 1000))}s</span>
                          </>
                        )}
                        <span className="opacity-40">·</span>
                        <span title={t("طريقة العرض", "View mode")}>{visibleInvoices.length > 60 ? "vlist" : "table"}</span>
                        <span className="opacity-40">·</span>
                        <span>{fmtNumber(visibleInvoices.length, lang)}/{fmtNumber(rankedInvoices.length, lang)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="rounded-lg border border-primary/20 bg-gradient-to-br from-primary/10 to-transparent px-3 py-1.5">
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{t("الفواتير", "Invoices")}</div>
                  <div className="text-sm font-bold tabular-nums">{fmtNumber(rankedInvoices.length, lang)}</div>
                </div>
                <div className="rounded-lg border border-primary/20 bg-gradient-to-br from-primary/10 to-transparent px-3 py-1.5">
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{t("إجمالي البيع", "Revenue")}</div>
                  <div className="text-sm font-bold tabular-nums text-primary">{fmtMoney(invTotalRevenue, "EGP", lang)}</div>
                </div>
                <div className={`rounded-lg border px-3 py-1.5 ${invTotalProfit >= 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5"}`}>
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{t("صافي الربح", "Net Profit")}</div>
                  <div className={`text-sm font-bold tabular-nums ${invTotalProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"}`}>{fmtMoney(invTotalProfit, "EGP", lang)}</div>
                </div>
                <div className="rounded-lg border border-primary/20 bg-gradient-to-br from-primary/10 to-transparent px-3 py-1.5">
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{t("متوسط الهامش", "Avg Margin")}</div>
                  <div className="text-sm font-bold tabular-nums text-primary">{invAvgMargin.toFixed(1)}%</div>
                </div>
                {invTop && (
                  <div className="rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-transparent px-3 py-1.5 max-w-[240px]">
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1">
                      <span className="text-amber-500">★</span>{t("الأعلى ربحًا", "Top invoice")}
                    </div>
                    <div className="text-sm font-bold truncate text-amber-700 dark:text-amber-300">
                      {invTop.invoice_number}
                      <span className="ms-1 font-normal text-muted-foreground/80">· {fmtMoney(invTop.profit, "EGP", lang)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Filters + mini trend */}
          <div className="border-b border-primary/10 bg-gradient-to-b from-primary/[0.03] to-transparent px-4 py-3">
            <div className="flex flex-col lg:flex-row lg:items-stretch gap-3">
              {/* Filters */}
              <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Filter className="h-3.5 w-3.5 absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={invSearch}
                    onChange={(e) => { setInvSearch(e.target.value); setInvCustomerSuggestOpen(true); setInvCustomerHighlight(0); }}
                    onFocus={() => setInvCustomerSuggestOpen(true)}
                    onBlur={() => setTimeout(() => setInvCustomerSuggestOpen(false), 120)}
                    onKeyDown={(e) => {
                      if (!invCustomerSuggestOpen || invCustomerSuggestions.length === 0) return;
                      if (e.key === "ArrowDown") { e.preventDefault(); setInvCustomerHighlight((h) => Math.min(invCustomerSuggestions.length - 1, h + 1)); }
                      else if (e.key === "ArrowUp") { e.preventDefault(); setInvCustomerHighlight((h) => Math.max(0, h - 1)); }
                      else if (e.key === "Enter") { e.preventDefault(); const pick = invCustomerSuggestions[invCustomerHighlight]; if (pick) { setInvSearch(pick); setInvCustomerSuggestOpen(false); } }
                      else if (e.key === "Escape") { setInvCustomerSuggestOpen(false); }
                    }}
                    placeholder={t("بحث برقم الفاتورة أو العميل…", "Search invoice # or customer…")}
                    className="w-full h-8 rounded-full border border-border/60 bg-background/60 ps-8 pe-3 text-xs focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={invCustomerSuggestOpen && invCustomerSuggestions.length > 0}
                    aria-controls="inv-customer-suggest"
                  />
                  {invCustomerSuggestOpen && invCustomerSuggestions.length > 0 && (
                    <ul
                      id="inv-customer-suggest"
                      role="listbox"
                      className="absolute z-30 mt-1 start-0 end-0 max-h-64 overflow-y-auto rounded-xl border border-primary/25 bg-background/95 backdrop-blur shadow-[0_10px_30px_-10px_rgba(0,0,0,0.4)] p-1"
                    >
                      {invCustomerSuggestions.map((name, i) => {
                        const q = invSearch.trim();
                        const idx = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
                        return (
                          <li key={name} role="option" aria-selected={i === invCustomerHighlight}>
                            <button
                              type="button"
                              onMouseDown={(e) => { e.preventDefault(); setInvSearch(name); setInvCustomerSuggestOpen(false); }}
                              onMouseEnter={() => setInvCustomerHighlight(i)}
                              className={`w-full text-start px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-2 transition ${i === invCustomerHighlight ? "bg-primary/10 text-foreground" : "hover:bg-muted/60"}`}
                            >
                              <div className="h-5 w-5 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center text-[9px] font-bold text-primary shrink-0">
                                {name.trim().charAt(0).toUpperCase() || "?"}
                              </div>
                              <span className="truncate">
                                {idx >= 0 ? (
                                  <>
                                    {name.slice(0, idx)}
                                    <span className="bg-primary/20 text-primary font-semibold rounded px-0.5">{name.slice(idx, idx + q.length)}</span>
                                    {name.slice(idx + q.length)}
                                  </>
                                ) : name}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2 py-1 text-[11px]">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <input type="date" value={invFrom} onChange={(e) => setInvFrom(e.target.value)} className="bg-transparent focus:outline-none tabular-nums" title={t("من", "From")} />
                  <span className="text-muted-foreground">→</span>
                  <input type="date" value={invTo} onChange={(e) => setInvTo(e.target.value)} className="bg-transparent focus:outline-none tabular-nums" title={t("إلى", "To")} />
                </div>
                <select
                  value={invStatus}
                  onChange={(e) => setInvStatus(e.target.value)}
                  className="h-8 rounded-full border border-border/60 bg-background/60 px-3 text-xs focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  title={t("حالة الفاتورة", "Invoice status")}
                >
                  <option value="all">{t("كل الحالات", "All statuses")}</option>
                  {statusList.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
                {(invSearch || invFrom || invTo || invStatus !== "all") && (
                  <button
                    type="button"
                    onClick={() => { setInvSearch(""); setInvFrom(""); setInvTo(""); setInvStatus("all"); }}
                    className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  >
                    <X className="h-3 w-3" />{t("مسح", "Clear")}
                  </button>
                )}
                <span className="ms-auto text-[11px] text-muted-foreground tabular-nums">
                  {t(`عرض ${visibleInvoices.length} من ${rankedInvoices.length}`, `Showing ${visibleInvoices.length} of ${rankedInvoices.length}`)}
                </span>
              </div>

              {/* Mini trend chart */}
              <div className="lg:w-[300px] rounded-xl border border-primary/15 bg-gradient-to-br from-primary/[0.06] to-transparent p-2">
                <div className="flex items-center justify-between px-1 pb-1">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                    <LineChartIcon className="h-3 w-3 text-primary" />
                    {t("اتجاه الأرباح", "Profit trend")}
                  </div>
                  <div className="inline-flex rounded-full border border-border/60 bg-background/60 p-0.5 text-[10px] font-semibold">
                    <button type="button" onClick={() => setInvTrendMode("day")} className={`px-2 py-0.5 rounded-full transition ${invTrendMode === "day" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>{t("يومي", "Day")}</button>
                    <button type="button" onClick={() => setInvTrendMode("week")} className={`px-2 py-0.5 rounded-full transition ${invTrendMode === "week" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>{t("أسبوعي", "Week")}</button>
                  </div>
                </div>
                <div className="h-[70px]">
                  {invTrend.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground/70">{t("لا توجد بيانات", "No data")}</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={invTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="invTrendFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="date" hide />
                        <YAxis hide />
                        <Tooltip
                          cursor={{ stroke: "hsl(var(--primary))", strokeOpacity: 0.3 }}
                          content={({ active, payload }: any) => {
                            if (!active || !payload || payload.length === 0) return null;
                            const d = payload[0]?.payload as { date: string; profit: number; revenue: number; qty: number; avg: number };
                            const label = invTrendMode === "week"
                              ? t(`أسبوع ${d.date}`, `Week of ${d.date}`)
                              : fmtDate(d.date, lang);
                            return (
                              <div className="rounded-lg border border-primary/30 bg-background/95 backdrop-blur px-2.5 py-2 shadow-xl text-[11px] min-w-[160px]" dir={lang === "ar" ? "rtl" : "ltr"}>
                                <div className="font-semibold text-primary border-b border-primary/15 pb-1 mb-1 tabular-nums">{label}</div>
                                <div className="space-y-0.5">
                                  <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{t("القطع", "Pieces")}</span><span className="font-bold tabular-nums text-amber-600 dark:text-amber-300">{fmtNumber(d.qty, lang)}</span></div>
                                  <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{t("إجمالي البيع", "Revenue")}</span><span className="font-bold tabular-nums text-sky-600 dark:text-sky-300">{fmtMoney(d.revenue, "EGP", lang)}</span></div>
                                  <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{t("متوسط سعر القطعة", "Avg / pc")}</span><span className="font-bold tabular-nums text-foreground/80">{fmtMoney(d.avg, "EGP", lang)}</span></div>
                                  <div className="flex items-center justify-between gap-3 border-t border-primary/15 pt-1 mt-1"><span className="text-muted-foreground">{t("الربح", "Profit")}</span><span className={`font-bold tabular-nums ${d.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"}`}>{fmtMoney(d.profit, "EGP", lang)}</span></div>
                                </div>
                              </div>
                            );
                          }}
                        />
                        <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="2 2" />
                        <Area type="monotone" dataKey="profit" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#invTrendFill)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>
          </div>

          {loading && rankedInvoices.length === 0 ? (
            /* ==== Skeleton (Noir & Gold) — prevents layout jump ==== */
            <div className="overflow-hidden" aria-busy="true" aria-live="polite">
              <div className="min-w-[920px]">
                <div
                  className="grid gap-0 bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 text-[10px] uppercase tracking-[0.15em] text-primary/60 font-bold border-b border-primary/15"
                  style={{ gridTemplateColumns: "48px minmax(120px,1fr) minmax(110px,1fr) minmax(160px,1.4fr) 80px minmax(120px,1fr) minmax(120px,1fr) minmax(180px,1.4fr) minmax(130px,1fr)" }}
                >
                  <div className="px-3 py-3 text-center">#</div>
                  <div className="px-3 py-3 text-start">{t("الفاتورة", "Invoice")}</div>
                  <div className="px-3 py-3 text-start">{t("التاريخ", "Date")}</div>
                  <div className="px-3 py-3 text-start">{t("العميل", "Customer")}</div>
                  <div className="px-3 py-3 text-end">{t("القطع", "Items")}</div>
                  <div className="px-3 py-3 text-end">{t("البيع", "Revenue")}</div>
                  <div className="px-3 py-3 text-end">{t("التكلفة", "Cost")}</div>
                  <div className="px-3 py-3 text-end">{t("صافي الربح", "Profit")}</div>
                  <div className="px-3 py-3 text-end">{t("هامش %", "Margin")}</div>
                </div>
                <div className="divide-y divide-border/40">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      className="grid items-center"
                      style={{ gridTemplateColumns: "48px minmax(120px,1fr) minmax(110px,1fr) minmax(160px,1.4fr) 80px minmax(120px,1fr) minmax(120px,1fr) minmax(180px,1.4fr) minmax(130px,1fr)", height: 84 }}
                    >
                      <div className="px-3 py-3 flex justify-center"><div className="skeleton-noir h-7 w-7 rounded-full" style={{ animationDelay: `${i * 60}ms` }} /></div>
                      <div className="px-3 py-3"><div className="skeleton-noir h-4 w-24" style={{ animationDelay: `${i * 60 + 20}ms` }} /></div>
                      <div className="px-3 py-3"><div className="skeleton-noir h-3 w-20" style={{ animationDelay: `${i * 60 + 40}ms` }} /></div>
                      <div className="px-3 py-3 flex items-center gap-2">
                        <div className="skeleton-noir h-7 w-7 rounded-full" style={{ animationDelay: `${i * 60 + 60}ms` }} />
                        <div className="skeleton-noir h-4 flex-1 max-w-[140px]" style={{ animationDelay: `${i * 60 + 80}ms` }} />
                      </div>
                      <div className="px-3 py-3 flex justify-end"><div className="skeleton-noir h-5 w-10 rounded-md" style={{ animationDelay: `${i * 60 + 100}ms` }} /></div>
                      <div className="px-3 py-3 flex justify-end"><div className="skeleton-noir h-4 w-20" style={{ animationDelay: `${i * 60 + 120}ms` }} /></div>
                      <div className="px-3 py-3 flex justify-end"><div className="skeleton-noir h-4 w-20" style={{ animationDelay: `${i * 60 + 140}ms` }} /></div>
                      <div className="px-3 py-3 flex flex-col items-end gap-1">
                        <div className="skeleton-noir h-5 w-24 rounded-full" style={{ animationDelay: `${i * 60 + 160}ms` }} />
                        <div className="skeleton-noir h-1 w-24 rounded-full" style={{ animationDelay: `${i * 60 + 180}ms` }} />
                      </div>
                      <div className="px-3 py-3 flex flex-col items-end gap-1">
                        <div className="skeleton-noir h-5 w-16 rounded-full" style={{ animationDelay: `${i * 60 + 200}ms` }} />
                        <div className="skeleton-noir h-1 w-20 rounded-full" style={{ animationDelay: `${i * 60 + 220}ms` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : visibleInvoices.length > 60 ? (
            /* ==== Virtualized view (react-window) for large lists ==== */
            <div className="overflow-x-auto">
              <div className="min-w-[920px]">
                {/* Header */}
                <div
                  className="grid gap-0 bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 text-[10px] uppercase tracking-[0.15em] text-primary/90 font-bold border-b border-primary/15"
                  style={{ gridTemplateColumns: "48px minmax(120px,1fr) minmax(110px,1fr) minmax(160px,1.4fr) 80px minmax(120px,1fr) minmax(120px,1fr) minmax(180px,1.4fr) minmax(130px,1fr)" }}
                >
                  <div className="px-3 py-3 text-center">#</div>
                  <div className="px-3 py-3 text-start">{t("الفاتورة", "Invoice")}</div>
                  <div className="px-3 py-3 text-start">{t("التاريخ", "Date")}</div>
                  <div className="px-3 py-3 text-start">{t("العميل", "Customer")}</div>
                  <div className="px-3 py-3 text-end">{t("القطع", "Items")}</div>
                  <div className="px-3 py-3 text-end">{t("البيع", "Revenue")}</div>
                  <div className="px-3 py-3 text-end">{t("التكلفة", "Cost")}</div>
                  <div className="px-3 py-3 text-end">{t("صافي الربح", "Profit")}</div>
                  <div className="px-3 py-3 text-end">{t("هامش %", "Margin")}</div>
                </div>
                {/* Body */}
                <List
                  rowCount={visibleInvoices.length}
                  rowHeight={84}
                  defaultHeight={Math.min(560, Math.max(320, visibleInvoices.length * 84))}
                  overscanCount={8}
                  className="divide-y divide-border/40"
                  rowProps={{
                    rows: visibleInvoices,
                    lang,
                    t,
                    maxAbs: invMaxAbsProfit,
                    onOpen: (id: string) => setInvoiceDetailOpen(id),
                    medalOf: invRankMedal,
                    toneOf: marginTone,
                    MarginPillCmp: MarginPill,
                  }}
                  rowComponent={VirtualInvoiceRow}
                />
                {/* Footer with load more / show all — outside virtual list */}
                {invHasMore && (
                  <div className="px-3 py-4 text-center bg-gradient-to-b from-transparent to-primary/[0.03] border-t border-border/40">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setInvPageSize((n) => n + 25)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-4 py-1.5 text-xs font-bold text-primary hover:bg-primary/10 hover:border-primary/60 transition"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                        {t(`تحميل 25 المزيد (${rankedInvoices.length - visibleInvoices.length} متبقية)`, `Load 25 more (${rankedInvoices.length - visibleInvoices.length} remaining)`)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setInvPageSize(rankedInvoices.length)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground transition"
                      >
                        {t("عرض الكل", "Show all")}
                      </button>
                    </div>
                    <div className="mt-1.5 text-[10px] text-muted-foreground/70">
                      {t("عرض افتراضي (Virtualization) مفعّل لأداء أسرع", "Virtualized view enabled for faster rendering")}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 text-[10px] uppercase tracking-[0.15em] text-primary/90 font-bold">
                  <th className="px-3 py-3 text-center w-12">#</th>
                  <th className="px-3 py-3 text-start">{t("الفاتورة", "Invoice")}</th>
                  <th className="px-3 py-3 text-start">{t("التاريخ", "Date")}</th>
                  <th className="px-3 py-3 text-start">{t("العميل", "Customer")}</th>
                  <th className="px-3 py-3 text-end">{t("القطع", "Items")}</th>
                  <th className="px-3 py-3 text-end">{t("البيع", "Revenue")}</th>
                  <th className="px-3 py-3 text-end">{t("التكلفة", "Cost")}</th>
                  <th className="px-3 py-3 text-end min-w-[180px]">{t("صافي الربح", "Profit")}</th>
                  <th className="px-3 py-3 text-end min-w-[130px]">{t("هامش %", "Margin")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {rankedInvoices.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <div className="h-12 w-12 rounded-full bg-primary/5 border border-primary/20 flex items-center justify-center">
                        <Receipt className="h-5 w-5 text-primary/60" />
                      </div>
                      <div className="text-sm font-medium">{t("لا توجد فواتير في هذا النطاق", "No invoices in this range")}</div>
                      <div className="text-[11px]">{t("جرّب تعديل الفلاتر أو النطاق الزمني", "Try adjusting filters or the date range")}</div>
                    </div>
                  </td></tr>
                ) : visibleInvoices.map((r, idx) => {
                  const medal = invRankMedal(idx);
                  const isTop = medal !== null;
                  const profitBarPct = Math.min(100, (Math.abs(r.profit) / invMaxAbsProfit) * 100);
                  const marginPct = Math.max(0, Math.min(100, r.margin));
                  const mt = marginTone(r.margin);
                  return (
                    <tr
                      key={r.invoice_id}
                      onClick={() => setInvoiceDetailOpen(r.invoice_id)}
                      className={`group cursor-pointer transition-colors duration-200 hover:bg-primary/[0.04] ${r.profit < 0 ? "bg-rose-500/[0.03]" : ""} ${isTop ? "bg-gradient-to-r from-amber-500/[0.04] via-transparent to-transparent" : ""}`}
                      title={t("عرض تفاصيل الحساب", "Show calculation details")}
                    >
                      <td className="px-3 py-3 text-center">
                        {medal ? (
                          <div className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black ${medal.cls}`}>{medal.label}</div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/60 tabular-nums font-mono">{idx + 1}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-primary group-hover:underline underline-offset-2">
                          <Receipt className="h-3.5 w-3.5 opacity-70" />
                          {r.invoice_number}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span className="tabular-nums">{fmtDate(r.created_at, lang)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                            {(r.customer_name ?? "?").trim().charAt(0).toUpperCase() || "?"}
                          </div>
                          <span className="truncate text-sm">{r.customer_name ?? "—"}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-end tabular-nums">
                        <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-xs font-semibold">{fmtNumber(r.items, lang)}</span>
                      </td>
                      <td className="px-3 py-3 text-end tabular-nums font-medium">{fmtMoney(r.revenue, "EGP", lang)}</td>
                      <td className="px-3 py-3 text-end tabular-nums text-muted-foreground">{fmtMoney(r.cost, "EGP", lang)}</td>
                      <td className="px-3 py-3 text-end">
                        <div className="flex flex-col items-end gap-1">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums border ${r.profit >= 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" : "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30"}`}>
                            {r.profit >= 0 ? <TrendingUp className="h-3 w-3" /> : <ArrowRight className="h-3 w-3 rotate-90" />}
                            {fmtMoney(r.profit, "EGP", lang)}
                          </span>
                          <div className="w-24 h-1 rounded-full bg-muted/50 overflow-hidden">
                            <div className={`h-full ${r.profit >= 0 ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : "bg-gradient-to-r from-rose-600 to-rose-400"}`} style={{ width: `${profitBarPct}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-end">
                        <div className="flex flex-col items-end gap-1">
                          <MarginPill margin={r.margin} size="sm" />
                          <div className="w-20 h-1 rounded-full bg-muted/50 overflow-hidden">
                            <div className={`h-full ${mt.bar}`} style={{ width: `${marginPct}%` }} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {invHasMore && (
                  <tr>
                    <td colSpan={9} className="px-3 py-4 text-center bg-gradient-to-b from-transparent to-primary/[0.03]">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => setInvPageSize((n) => n + 25)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-4 py-1.5 text-xs font-bold text-primary hover:bg-primary/10 hover:border-primary/60 transition"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                          {t(`تحميل 25 المزيد (${rankedInvoices.length - visibleInvoices.length} متبقية)`, `Load 25 more (${rankedInvoices.length - visibleInvoices.length} remaining)`)}
                        </button>
                        <button
                          type="button"
                          onClick={() => setInvPageSize(rankedInvoices.length)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground transition"
                        >
                          {t("عرض الكل", "Show all")}
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </div>
        );
      })()}

      {/* Price history dialog */}
      <Dialog open={!!historyOpen} onOpenChange={(o) => { if (!o) { setHistoryOpen(null); setHistory([]); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {t("سجل تعديلات الأسعار", "Price change history")}
              {historyOpen && <span className="block text-xs text-muted-foreground font-normal mt-1">{historyOpen.name}</span>}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {historyLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("...جاري التحميل", "Loading...")}</div>
            ) : history.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("لا توجد تعديلات سابقة", "No prior changes")}</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-start">{t("الحقل", "Field")}</th>
                    <th className="px-2 py-1.5 text-end">{t("من", "From")}</th>
                    <th className="px-2 py-1.5 text-end">{t("إلى", "To")}</th>
                    <th className="px-2 py-1.5 text-start">{t("بواسطة", "By")}</th>
                    <th className="px-2 py-1.5 text-start">{t("التاريخ", "When")}</th>
                    <th className="px-2 py-1.5 text-end">{t("إجراء", "Action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {history.map((h) => {
                    const currentVal = historyOpen
                      ? Number((h.field === "cost_price" ? historyOpen.cost_price : historyOpen.price) ?? 0)
                      : 0;
                    const oldVal = Number(h.old_value ?? 0);
                    const isCurrent = currentVal === oldVal;
                    return (
                      <tr key={h.id}>
                        <td className="px-2 py-1.5">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${h.field === "cost_price" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300"}`}>
                            {h.field === "cost_price" ? t("تكلفة", "cost") : t("بيع", "sale")}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums">{fmtMoney(oldVal, "EGP", lang)}</td>
                        <td className="px-2 py-1.5 text-end tabular-nums font-semibold">{fmtMoney(Number(h.new_value ?? 0), "EGP", lang)}</td>
                        <td className="px-2 py-1.5 text-[11px] truncate max-w-[140px]" title={h.changed_by_email ?? ""}>{h.changed_by_email ?? "—"}</td>
                        <td className="px-2 py-1.5 text-[11px] text-muted-foreground">{new Date(h.changed_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB")}</td>
                        <td className="px-2 py-1.5 text-end">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={revertingId === h.id || isCurrent}
                            onClick={() => revertHistory(h)}
                            className="h-7 px-2 text-[10px] gap-1"
                            title={isCurrent ? t("القيمة الحالية", "Current value") : t("استرجاع", "Revert")}
                          >
                            <Undo2 className="h-3 w-3" />
                            {isCurrent ? t("الحالي", "Current") : t("رجوع", "Revert")}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Override history dialog */}
      <Dialog open={!!ovHistoryOpen} onOpenChange={(o) => { if (!o) { setOvHistoryOpen(null); setOvHistory([]); } }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {t("سجل التعديلات اليدوية للتكلفة", "Manual cost override history")}
              {ovHistoryOpen && <span className="block text-xs text-muted-foreground font-normal mt-1">{ovHistoryOpen.name}</span>}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {ovHistoryLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("...جاري التحميل", "Loading...")}</div>
            ) : ovHistory.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("لا توجد تعديلات", "No changes yet")}</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-start">{t("الإجراء", "Action")}</th>
                    <th className="px-2 py-1.5 text-end">{t("من", "From")}</th>
                    <th className="px-2 py-1.5 text-end">{t("إلى", "To")}</th>
                    <th className="px-2 py-1.5 text-start">{t("بواسطة", "By")}</th>
                    <th className="px-2 py-1.5 text-start">{t("التاريخ", "When")}</th>
                    <th className="px-2 py-1.5 text-end">{t("إجراء", "")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {ovHistory.map((h) => (
                    <tr key={h.id}>
                      <td className="px-2 py-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${h.action === "delete" ? "bg-rose-500/15 text-rose-700" : h.action === "insert" ? "bg-emerald-500/15 text-emerald-700" : "bg-sky-500/15 text-sky-700"}`}>
                          {h.action}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-end tabular-nums">{h.old_cost_egp != null ? fmtMoney(Number(h.old_cost_egp), "EGP", lang) : "—"}</td>
                      <td className="px-2 py-1.5 text-end tabular-nums font-semibold">{h.new_cost_egp != null ? fmtMoney(Number(h.new_cost_egp), "EGP", lang) : "—"}</td>
                      <td className="px-2 py-1.5 text-[11px] truncate max-w-[140px]" title={h.changed_by_email ?? ""}>{h.changed_by_email ?? "—"}</td>
                      <td className="px-2 py-1.5 text-[11px] text-muted-foreground">{new Date(h.changed_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB")}</td>
                      <td className="px-2 py-1.5 text-end">
                        {isAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={ovRevertingId === h.id}
                            onClick={() => revertOvHistory(h)}
                            className="h-7 px-2 text-[10px] gap-1"
                          >
                            <Undo2 className="h-3 w-3" />
                            {t("رجوع", "Revert")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Invoice detail dialog */}
      <Dialog open={!!invoiceDetailOpen} onOpenChange={(o) => { if (!o) setInvoiceDetailOpen(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" />
              {t("تفاصيل حساب الفاتورة", "Invoice profit breakdown")}
              {invoiceDetailOpen && (() => {
                const first = items.find((it) => it.invoice_id === invoiceDetailOpen);
                return first?.invoices ? <span className="text-xs text-muted-foreground font-mono">· {first.invoices.invoice_number}</span> : null;
              })()}
            </DialogTitle>
          </DialogHeader>
          {invoiceDetailOpen && (() => {
            const invItems = items.filter((it) => it.invoice_id === invoiceDetailOpen);
            const inv = invItems[0]?.invoices ?? null;
            const factor = invoiceFactor.get(invoiceDetailOpen) ?? 1;
            const shipLines = invItems.filter(isShippingLine);
            const shipTotal = shipLines.reduce((s, it) => s + Number(it.line_total ?? 0), 0);
            const prodLines = invItems.filter((it) => !isShippingLine(it));
            let totalRev = 0, totalCost = 0;
            const rowsX = prodLines.map((it) => {
              const rev = netRev(it);
              const c = costOf(it.product_id) * it.quantity;
              totalRev += rev; totalCost += c;
              return { it, rev, cost: c };
            });
            const profit = totalRev - totalCost;
            return (
              <div className="max-h-[70vh] overflow-y-auto space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="rounded border p-2 bg-muted/20"><div className="text-[10px] text-muted-foreground">{t("العميل", "Customer")}</div><div className="font-medium truncate">{inv?.customer_name ?? "—"}</div></div>
                  <div className="rounded border p-2 bg-muted/20"><div className="text-[10px] text-muted-foreground">{t("التاريخ", "Date")}</div><div className="font-medium">{inv?.created_at ? fmtDate(inv.created_at, lang) : "—"}</div></div>
                  <div className="rounded border p-2 bg-muted/20"><div className="text-[10px] text-muted-foreground">{t("الحالة", "Status")}</div><div className="font-medium">{inv?.status ?? "—"}</div></div>
                  <div className="rounded border p-2 bg-muted/20"><div className="text-[10px] text-muted-foreground">{t("مصدر التكلفة", "Cost source")}</div><div className="font-medium">{costSourceLabel(costSource, t)}</div></div>
                </div>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[720px] text-xs">
                    <thead className="bg-muted/40 text-[10px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 text-start">{t("المنتج", "Product")}</th>
                        <th className="px-2 py-1.5 text-end">{t("الكمية", "Qty")}</th>
                        <th className="px-2 py-1.5 text-end">{t("سعر البيع", "Sale")}</th>
                        <th className="px-2 py-1.5 text-end">{t("خط البيع", "Line")}</th>
                        <th className="px-2 py-1.5 text-end">{t("بعد الخصم", "After disc.")}</th>
                        <th className="px-2 py-1.5 text-end">{t("تكلفة الوحدة", "Unit cost")}</th>
                        <th className="px-2 py-1.5 text-end">{t("إجمالي التكلفة", "Total cost")}</th>
                        <th className="px-2 py-1.5 text-end">{t("الربح", "Profit")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rowsX.map((r, i) => {
                        const uc = costOf(r.it.product_id);
                        const p = r.it.product_id ? productById.get(r.it.product_id) : null;
                        return (
                          <tr key={i} className={r.rev - r.cost >= 0 ? "" : "bg-rose-500/5"}>
                            <td className="px-2 py-1.5">
                              <div className="font-medium">{r.it.product_name}</div>
                              {p && <div className="text-[10px] text-muted-foreground">{p.serial_number} · {p.color}</div>}
                            </td>
                            <td className="px-2 py-1.5 text-end tabular-nums">{r.it.quantity}</td>
                            <td className="px-2 py-1.5 text-end tabular-nums">{fmtMoney(Number(r.it.unit_price), "EGP", lang)}</td>
                            <td className="px-2 py-1.5 text-end tabular-nums">{fmtMoney(Number(r.it.line_total), "EGP", lang)}</td>
                            <td className="px-2 py-1.5 text-end tabular-nums">{fmtMoney(r.rev, "EGP", lang)}</td>
                            <td className="px-2 py-1.5 text-end tabular-nums">{fmtMoney(uc, "EGP", lang)}</td>
                            <td className="px-2 py-1.5 text-end tabular-nums">{fmtMoney(r.cost, "EGP", lang)}</td>
                            <td className={`px-2 py-1.5 text-end tabular-nums font-semibold ${r.rev - r.cost >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmtMoney(r.rev - r.cost, "EGP", lang)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-muted/30 text-xs font-semibold">
                      <tr>
                        <td colSpan={4} className="px-2 py-1.5 text-end">{t("الإجماليات", "Totals")}</td>
                        <td className="px-2 py-1.5 text-end tabular-nums">{fmtMoney(totalRev, "EGP", lang)}</td>
                        <td colSpan={2} className="px-2 py-1.5 text-end tabular-nums">{fmtMoney(totalCost, "EGP", lang)}</td>
                        <td className={`px-2 py-1.5 text-end tabular-nums ${profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmtMoney(profit, "EGP", lang)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="rounded-lg border bg-muted/10 p-3 text-[11px] space-y-1">
                  <div className="font-semibold text-xs">{t("خطوات الحساب", "Calculation steps")}</div>
                  <RowLine label={t("مجموع الفاتورة الخام", "Raw invoice total")} value={fmtMoney(Number(inv?.total ?? 0), "EGP", lang)} />
                  <RowLine label={t(`− شحن/خدمة (${shipLines.length} بند)`, `− Shipping/fees (${shipLines.length} line(s))`)} value={`− ${fmtMoney(shipTotal, "EGP", lang)}`} muted />
                  <RowLine label={t(`معامل الخصم المُوَزَّع`, `Discount proration factor`)} value={factor.toFixed(4)} muted />
                  <div className="pt-1.5 border-t"></div>
                  <RowLine label={t("= إجمالي البيع المعتمد", "= Recognised revenue")} value={fmtMoney(totalRev, "EGP", lang)} />
                  <RowLine label={t(`− إجمالي التكلفة (${costSourceLabel(costSource, t)})`, `− Total cost (${costSourceLabel(costSource, t)})`)} value={`− ${fmtMoney(totalCost, "EGP", lang)}`} muted />
                  <div className={`pt-1 border-t font-semibold flex items-center justify-between ${profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    <span>= {t("صافي الربح", "Net profit")}</span>
                    <span className="tabular-nums">{fmtMoney(profit, "EGP", lang)}</span>
                  </div>
                  <div className="text-muted-foreground">{t("الفواتير الملغاة/المسودّة مستبعدة كلياً من هذه الشاشة.", "Voided/draft invoices are fully excluded from this view.")}</div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Product detail sheet */}
      <Sheet open={!!productDetailId} onOpenChange={(o) => { if (!o) setProductDetailId(null); }}>
        <SheetContent side={lang === "ar" ? "left" : "right"} dir={lang === "ar" ? "rtl" : "ltr"} className="w-full sm:max-w-lg overflow-y-auto">
          {(() => {
            const r = productDetailId ? rows.list.find((x) => x.product_id === productDetailId) : null;
            if (!r) {
              // Skeleton while data is loading / not yet materialized
              return (
                <div className="space-y-4" aria-busy="true" aria-live="polite">
                  <div className="flex items-start gap-3">
                    <div className="skeleton-noir h-16 w-16 rounded-xl" />
                    <div className="flex-1 space-y-2 pt-1">
                      <div className="skeleton-noir h-4 w-3/4" />
                      <div className="flex gap-1.5">
                        <div className="skeleton-noir h-4 w-14 rounded" />
                        <div className="skeleton-noir h-4 w-20 rounded" />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="rounded-xl border border-primary/15 p-3 space-y-2">
                        <div className="skeleton-noir h-2 w-16" />
                        <div className="skeleton-noir h-5 w-24" style={{ animationDelay: `${i * 80}ms` }} />
                      </div>
                    ))}
                    <div className="col-span-2 rounded-xl border border-primary/15 p-3 space-y-2">
                      <div className="skeleton-noir h-2 w-20" />
                      <div className="skeleton-noir h-6 w-40" />
                    </div>
                  </div>
                  <div className="rounded-xl border border-primary/15 p-3 space-y-2">
                    <div className="skeleton-noir h-3 w-24" />
                    <div className="flex flex-wrap gap-2">
                      <div className="skeleton-noir h-7 flex-1 min-w-[160px] rounded-full" />
                      <div className="skeleton-noir h-7 w-40 rounded-full" />
                      <div className="skeleton-noir h-7 w-28 rounded-full" />
                    </div>
                  </div>
                  <div className="rounded-xl border border-primary/15 p-3">
                    <div className="skeleton-noir h-3 w-32 mb-2" />
                    <div className="skeleton-noir h-32 w-full rounded" />
                  </div>
                  <div className="rounded-xl border border-primary/15 p-3 space-y-2">
                    <div className="skeleton-noir h-3 w-28" />
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-2 py-1.5">
                        <div className="skeleton-noir h-3 w-16" />
                        <div className="skeleton-noir h-3 flex-1" />
                        <div className="skeleton-noir h-3 w-20" />
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
            const p = r.product;
            const stock = Number(p?.stock_quantity ?? 0);
            const allProductLines = items.filter((it) => it.product_id === r.product_id && !isShippingLine(it));
            // Available statuses in scope
            const sheetStatusSet = new Set<string>();
            for (const it of allProductLines) if (it.invoices?.status) sheetStatusSet.add(it.invoices.status);
            const sheetStatusList = Array.from(sheetStatusSet).sort();
            // Apply sheet filters to lines
            const sSearch = sheetSearch.trim().toLowerCase();
            const sFrom = sheetFrom ? new Date(sheetFrom + "T00:00:00").getTime() : null;
            const sTo = sheetTo ? new Date(sheetTo + "T23:59:59").getTime() : null;
            const productLines = allProductLines.filter((it) => {
              const inv = it.invoices;
              if (sheetStatus !== "all" && (inv?.status ?? "") !== sheetStatus) return false;
              const ts = inv?.created_at ? new Date(inv.created_at).getTime() : 0;
              if (sFrom !== null && ts < sFrom) return false;
              if (sTo !== null && ts > sTo) return false;
              if (sSearch) {
                const hay = `${inv?.invoice_number ?? ""} ${inv?.customer_name ?? ""}`.toLowerCase();
                if (!hay.includes(sSearch)) return false;
              }
              return true;
            });
            // Build timeline (daily aggregation)
            const byDay = new Map<string, { date: string; revenue: number; qty: number }>();
            for (const it of productLines) {
              const d = (it.invoices?.created_at ?? "").slice(0, 10);
              if (!d) continue;
              const cur = byDay.get(d) ?? { date: d, revenue: 0, qty: 0 };
              cur.revenue += netRev(it);
              cur.qty += it.quantity;
              byDay.set(d, cur);
            }
            const timeline = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
            // Invoices grouped
            const byInvoice = new Map<string, { invoice_id: string; invoice_number: string; created_at: string; customer_name: string | null; status: string; qty: number; revenue: number }>();
            for (const it of productLines) {
              const inv = it.invoices;
              if (!inv) continue;
              const cur = byInvoice.get(it.invoice_id) ?? {
                invoice_id: it.invoice_id,
                invoice_number: inv.invoice_number ?? "—",
                created_at: inv.created_at ?? "",
                customer_name: inv.customer_name ?? null,
                status: inv.status ?? "",
                qty: 0, revenue: 0,
              };
              cur.qty += it.quantity;
              cur.revenue += netRev(it);
              byInvoice.set(it.invoice_id, cur);
            }
            const invList = Array.from(byInvoice.values()).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
            const filteredQty = productLines.reduce((s, it) => s + it.quantity, 0);
            const filteredRev = productLines.reduce((s, it) => s + netRev(it), 0);
            const activeFilters = sheetSearch || sheetFrom || sheetTo || sheetStatus !== "all";
            return (
              <>
                <SheetHeader className="text-start">
                  <div className="flex items-start gap-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-primary/30 bg-muted ring-2 ring-primary/20">
                      {p?.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <SheetTitle className="text-base truncate">{r.name}</SheetTitle>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                        {p?.collection && (
                          <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-bold ${collectionBadgeClass(p.collection)}`}>
                            <span className={`inline-block h-1 w-1 rounded-full ${collectionDotClass(p.collection)}`} />
                            {p.collection}
                          </span>
                        )}
                        {p?.serial_number && <span className="font-mono rounded bg-muted px-1.5 py-0.5">{p.serial_number}</span>}
                        {p?.color && <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5"><ColorSwatch value={p.color} size="sm" />{p.color}</span>}
                      </div>
                    </div>
                  </div>
                </SheetHeader>

                {/* KPI grid */}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-primary/15 bg-gradient-to-br from-primary/5 to-transparent p-3">
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{t("المخزون الحالي", "Current stock")}</div>
                    <div className={`mt-1 text-lg font-extrabold tabular-nums ${stock <= 0 ? "text-rose-600" : stock < 5 ? "text-amber-600" : "text-foreground"}`}>{fmtNumber(stock, lang)}</div>
                  </div>
                  <div className="rounded-xl border border-primary/15 bg-gradient-to-br from-primary/5 to-transparent p-3">
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{t("الكمية المباعة", "Sold qty")}</div>
                    <div className="mt-1 text-lg font-extrabold tabular-nums">{fmtNumber(r.qty, lang)}</div>
                  </div>
                  <div className="rounded-xl border border-primary/15 bg-gradient-to-br from-primary/5 to-transparent p-3">
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{t("إجمالي التكلفة", "Total cost")}</div>
                    <div className="mt-1 text-sm font-bold tabular-nums text-muted-foreground">{fmtMoney(r.cost, "EGP", lang)}</div>
                  </div>
                  <div className="rounded-xl border border-primary/15 bg-gradient-to-br from-primary/5 to-transparent p-3">
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{t("إجمالي البيع", "Revenue")}</div>
                    <div className="mt-1 text-sm font-bold tabular-nums">{fmtMoney(r.revenue, "EGP", lang)}</div>
                  </div>
                  <div className={`rounded-xl border p-3 col-span-2 ${r.profit >= 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5"}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{t("صافي الربح", "Net profit")}</div>
                        <div className={`mt-1 text-xl font-extrabold tabular-nums ${r.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"}`}>{fmtMoney(r.profit, "EGP", lang)}</div>
                      </div>
                      <div className="text-end">
                        <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{t("الهامش", "Margin")}</div>
                        <div className="mt-1"><MarginPill margin={r.margin} size="md" /></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Filters */}
                <div className="mt-4 rounded-xl border border-primary/15 bg-gradient-to-br from-primary/[0.04] to-transparent p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-primary/80 mb-2">
                    <Filter className="h-3 w-3" />
                    {t("فلاتر الفواتير", "Invoice filters")}
                    {activeFilters && (
                      <button type="button" onClick={() => { setSheetSearch(""); setSheetFrom(""); setSheetTo(""); setSheetStatus("all"); }} className="ms-auto inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[10px] normal-case tracking-normal text-muted-foreground hover:border-primary/40 hover:text-foreground">
                        <X className="h-3 w-3" />{t("مسح", "Clear")}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[160px]">
                      <Filter className="h-3 w-3 absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <input
                        type="text"
                        value={sheetSearch}
                        onChange={(e) => setSheetSearch(e.target.value)}
                        placeholder={t("بحث برقم الفاتورة أو العميل…", "Search invoice # or customer…")}
                        className="w-full h-7 rounded-full border border-border/60 bg-background/60 ps-7 pe-2 text-[11px] focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      />
                    </div>
                    <div className="flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px]">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <input type="date" value={sheetFrom} onChange={(e) => setSheetFrom(e.target.value)} className="bg-transparent focus:outline-none tabular-nums" title={t("من", "From")} />
                      <span className="text-muted-foreground">→</span>
                      <input type="date" value={sheetTo} onChange={(e) => setSheetTo(e.target.value)} className="bg-transparent focus:outline-none tabular-nums" title={t("إلى", "To")} />
                    </div>
                    <select
                      value={sheetStatus}
                      onChange={(e) => setSheetStatus(e.target.value)}
                      className="h-7 rounded-full border border-border/60 bg-background/60 px-2 text-[11px] focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      title={t("حالة السداد", "Payment status")}
                    >
                      <option value="all">{t("كل الحالات", "All statuses")}</option>
                      {sheetStatusList.map((s) => (<option key={s} value={s}>{s}</option>))}
                    </select>
                  </div>
                  {activeFilters && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{t(`${invList.length} فاتورة`, `${invList.length} invoice(s)`)}</span>
                      <span>·</span>
                      <span className="tabular-nums">{t(`${fmtNumber(filteredQty, lang)} قطعة`, `${fmtNumber(filteredQty, lang)} pcs`)}</span>
                      <span>·</span>
                      <span className="tabular-nums font-semibold text-primary/90">{fmtMoney(filteredRev, "EGP", lang)}</span>
                    </div>
                  )}
                </div>

                {/* Mini timeline — Recharts with rich tooltip */}
                {timeline.length > 0 ? (
                  <div className="mt-4 rounded-xl border border-primary/15 bg-card/70 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary/80">
                        <LineChartIcon className="h-3.5 w-3.5" />
                        {t("المخطط الزمني للمبيعات", "Sales timeline")}
                      </div>
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="inline-flex items-center gap-1 text-primary/80"><span className="inline-block h-2 w-2 rounded-sm bg-gradient-to-b from-primary/80 to-primary/30" />{t("البيع", "Revenue")}</span>
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-300"><span className="inline-block h-[2px] w-3 bg-amber-500" />{t("القطع", "Qty")}</span>
                      </div>
                    </div>
                    <div className="h-32">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={timeline} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="pdRevFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.55} />
                              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.25} vertical={false} />
                          <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} minTickGap={16} />
                          <YAxis yAxisId="rev" hide />
                          <YAxis yAxisId="qty" orientation="right" hide />
                          <Tooltip
                            cursor={{ stroke: "hsl(var(--primary))", strokeOpacity: 0.3 }}
                            content={({ active, payload }: any) => {
                              if (!active || !payload || payload.length === 0) return null;
                              const d = payload[0]?.payload as { date: string; revenue: number; qty: number };
                              const avg = d.qty > 0 ? d.revenue / d.qty : 0;
                              return (
                                <div className="rounded-lg border border-primary/30 bg-background/95 backdrop-blur px-2.5 py-2 shadow-lg text-[11px] min-w-[170px]" dir={lang === "ar" ? "rtl" : "ltr"}>
                                  <div className="font-semibold text-primary mb-1 tabular-nums border-b border-primary/15 pb-1">{fmtDate(d.date, lang)}</div>
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-muted-foreground">{t("القطع", "Pieces")}</span>
                                    <span className="font-bold tabular-nums text-amber-600 dark:text-amber-300">{fmtNumber(d.qty, lang)}</span>
                                  </div>
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-muted-foreground">{t("إجمالي البيع", "Revenue")}</span>
                                    <span className="font-bold tabular-nums text-primary">{fmtMoney(d.revenue, "EGP", lang)}</span>
                                  </div>
                                  <div className="flex items-center justify-between gap-3 border-t border-primary/15 pt-1 mt-1">
                                    <span className="text-muted-foreground">{t("متوسط سعر القطعة", "Avg / pc")}</span>
                                    <span className="font-bold tabular-nums text-foreground/80">{fmtMoney(avg, "EGP", lang)}</span>
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Area yAxisId="rev" type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#pdRevFill)" />
                          <Line yAxisId="qty" type="monotone" dataKey="qty" stroke="#f59e0b" strokeWidth={1.5} dot={{ r: 2, fill: "#f59e0b" }} activeDot={{ r: 3 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-border/60 bg-card/40 p-6 text-center text-[11px] text-muted-foreground">
                    {t("لا توجد بيانات مبيعات في هذا النطاق", "No sales data in this range")}
                  </div>
                )}

                {/* Invoices list */}
                <div className="mt-4 rounded-xl border border-primary/15 bg-card/70 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary/80 mb-2">
                    <Receipt className="h-3.5 w-3.5" />
                    {t("الفواتير المرتبطة", "Linked invoices")} ({fmtNumber(invList.length, lang)})
                  </div>
                  {invList.length === 0 ? (
                    <div className="py-4 text-center text-xs text-muted-foreground">{t("لا توجد فواتير في النطاق", "No invoices in range")}</div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto divide-y divide-border/40">
                      {invList.map((inv) => (
                        <button
                          key={inv.invoice_id}
                          type="button"
                          onClick={() => { setProductDetailId(null); setInvoiceDetailOpen(inv.invoice_id); }}
                          className="w-full text-start py-2 px-1.5 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5 text-xs hover:bg-primary/5 rounded transition-colors"
                        >
                          <span className="font-mono font-semibold text-primary row-span-2 self-center">{inv.invoice_number}</span>
                          <span className="truncate text-[11px] text-foreground/90">{inv.customer_name || t("— بدون عميل —", "— no customer —")}</span>
                          <span className="tabular-nums font-semibold text-end">{fmtMoney(inv.revenue, "EGP", lang)}</span>
                          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span className="tabular-nums">{fmtDate(inv.created_at, lang)}</span>
                            {inv.status && <span className="inline-flex items-center rounded-full border border-border/60 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wider">{inv.status}</span>}
                          </span>
                          <span className="tabular-nums text-muted-foreground text-end">×{fmtNumber(inv.qty, lang)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 text-[10px] text-muted-foreground italic">
                    {t("الفواتير الملغية والمحذوفة ورسوم الشحن مستبعدة.", "Voided/deleted invoices and shipping fees are excluded.")}
                  </div>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function KpiCard({ icon, label, value, className, hint, iconRing }: { icon: React.ReactNode; label: string; value: string; className?: string; hint?: string; iconRing?: string }) {
  return (
    <div className={`kpi-luxe group relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-sm ${className ?? ""}`}>
      <div className="relative z-[2] flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">{label}</div>
          <div className="mt-1.5 text-lg sm:text-2xl font-extrabold tabular-nums text-foreground leading-tight transition-transform duration-500 group-hover:-translate-y-0.5">{value}</div>
          {hint && <div className="mt-1 text-[10px] opacity-70">{hint}</div>}
        </div>
        <div className={`grid place-items-center h-9 w-9 rounded-full shrink-0 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-[6deg] ${iconRing ?? "bg-background/60 border"}`}>
          {icon}
        </div>
      </div>
      <div className="pointer-events-none absolute -bottom-8 -end-8 h-24 w-24 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--brand-gold)_35%,transparent),transparent_70%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
    </div>
  );
}


function LedgerRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex items-baseline gap-2 text-[13px] ${muted ? "text-muted-foreground" : "text-foreground"}`}>
      <span className="truncate">{label}</span>
      <span className="flex-1 border-b border-dotted border-border/70 translate-y-[-3px]" aria-hidden />
      <span className="tabular-nums font-semibold shrink-0">{value}</span>
    </div>
  );
}

function CauseCard({ icon, title, desc, tone }: { icon: React.ReactNode; title: string; desc: string; tone: "rose" | "sky" | "amber" | "emerald" }) {
  const tones: Record<string, string> = {
    rose: "border-rose-500/25 bg-rose-500/[0.05] text-rose-700",
    sky: "border-sky-500/25 bg-sky-500/[0.05] text-sky-700",
    amber: "border-amber-500/25 bg-amber-500/[0.05] text-amber-700",
    emerald: "border-emerald-500/25 bg-emerald-500/[0.05] text-emerald-700",
  };
  const iconTones: Record<string, string> = {
    rose: "bg-rose-500/15 ring-rose-500/25 text-rose-600",
    sky: "bg-sky-500/15 ring-sky-500/25 text-sky-600",
    amber: "bg-amber-500/15 ring-amber-500/25 text-amber-600",
    emerald: "bg-emerald-500/15 ring-emerald-500/25 text-emerald-600",
  };
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border p-2.5 ${tones[tone]}`}>
      <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1 ${iconTones[tone]}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[12px] font-bold text-foreground truncate">{title}</div>
        <div className="text-[11px] text-muted-foreground leading-snug">{desc}</div>
      </div>
    </div>
  );
}

function RowLine({ label, value, muted }: { label: string; value: string; muted?: boolean }) {

  return (
    <div className={`flex items-center justify-between gap-2 ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums font-medium">{value}</span>
    </div>
  );
}

function costSourceLabel(s: CostSource, t: (ar: string, en: string) => string): string {
  if (s === "wac") return t("متوسط مرجّح", "Weighted avg");
  if (s === "latest_po") return t("آخر PO", "Latest PO");
  if (s === "current") return t("سعر المنتج الحالي", "Current product cost");
  return t("تعديل يدوي", "Manual override");
}


// ────────────────────────────────────────────────────────────────────────────
// Product Cost History across POs — new section on the Profits page.
// Reuses the already-loaded costBook.lots so no extra fetches are needed.
// ────────────────────────────────────────────────────────────────────────────
type ProductCostHistoryPanelProps = {
  costBook: CostBook;
  products: Product[];
  t: (ar: string, en: string) => string;
  lang: "ar" | "en";
};

function ProductCostHistoryPanel({ costBook, products, t, lang }: ProductCostHistoryPanelProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"all" | "select">("select");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [colorFilter, setColorFilter] = useState<string>("all");
  const [collectionFilter, setCollectionFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Products that actually have PO lots
  const productsWithLots = useMemo(
    () => products.filter((p) => (costBook.products[p.id]?.lots?.length ?? 0) > 0),
    [products, costBook],
  );

  // Unique colors + collections drawn from products-with-lots (so filters
  // never show a value that can't match anything on this panel).
  const colorOptions = useMemo(() => {
    const s = new Set<string>();
    for (const p of productsWithLots) if (p.color) s.add(p.color);
    return Array.from(s).sort();
  }, [productsWithLots]);
  const collectionOptions = useMemo(() => {
    const s = new Set<string>();
    for (const p of productsWithLots) if (p.collection) s.add(p.collection);
    return Array.from(s).sort();
  }, [productsWithLots]);

  // Products passing color + collection filters (applies to picker AND "all")
  const eligibleProducts = useMemo(() => {
    return productsWithLots.filter((p) => {
      if (colorFilter !== "all" && (p.color ?? "") !== colorFilter) return false;
      if (collectionFilter !== "all" && (p.collection ?? "") !== collectionFilter) return false;
      return true;
    });
  }, [productsWithLots, colorFilter, collectionFilter]);

  const filteredForPicker = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = eligibleProducts;
    if (!q) return base;
    return base.filter((p) =>
      p.name.toLowerCase().includes(q) || (p.serial_number ?? "").toLowerCase().includes(q),
    );
  }, [eligibleProducts, search]);

  const effectiveIds = useMemo(() => {
    const allowed = new Set(eligibleProducts.map((p) => p.id));
    if (mode === "all") return Array.from(allowed);
    return Array.from(selectedIds).filter((id) => allowed.has(id));
  }, [mode, selectedIds, eligibleProducts]);

  // Date range: inclusive on both ends. Empty strings = no bound.
  const inDateRange = (d: string | null | undefined): boolean => {
    if (!dateFrom && !dateTo) return true;
    if (!d) return false; // any range set → lots with no date are excluded
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  const rows = useMemo(() => {
    return effectiveIds
      .map((pid) => {
        const product = products.find((p) => p.id === pid);
        const entry = costBook.products[pid];
        const rawLots: PoCostLot[] = (entry?.lots ?? []) as PoCostLot[];
        const filtered = filterLots(rawLots, includeCancelled).filter((l) => inDateRange(l.shipment_date));
        const lots = sortLotsByDateDesc(filtered);
        const summary = summarizeProduct(pid, lots);
        return { product, lots, summary };
      })
      .filter((r) => r.product && r.summary.totalQty > 0);
  }, [effectiveIds, products, costBook, includeCancelled]);

  const grand = useMemo(() => summarizeMany(rows.map((r) => r.summary)), [rows]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    setMode("select");
  };

  const clearAll = () => {
    setSelectedIds(new Set());
  };

  const money = (v: number, ccy: "USD" | "EGP") => fmtMoney(v, ccy, lang);

  return (
    <div className="rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 sm:px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <History className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="font-semibold text-sm truncate">
            {t("تاريخ التكلفة عبر أوامر الشراء", "Cost History across POs")}
          </h3>
          <span className="hidden sm:inline text-[10px] rounded-full border bg-muted/40 px-2 py-0.5 text-muted-foreground">
            {t("لكل منتج · متوسط مرجّح", "Per product · Weighted average")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {open && rows.length > 0 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {rows.length} {t("منتج", "product(s)")} · {grand.poCount} {t("سطر PO", "PO line(s)")}
            </span>
          )}
          <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => setOpen((v) => !v)}>
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {open ? t("إخفاء", "Hide") : t("عرض", "Show")}
          </Button>
        </div>
      </div>

      {open && (
        <div className="p-3 sm:p-4 space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full border bg-muted/40 p-0.5 text-[11px]">
              <button
                onClick={() => setMode("all")}
                className={`rounded-full px-3 py-1 font-semibold transition ${
                  mode === "all" ? "bg-primary text-primary-foreground shadow" : "hover:bg-background"
                }`}
              >
                {t("كل المنتجات", "All products")}
              </button>
              <button
                onClick={() => setMode("select")}
                className={`rounded-full px-3 py-1 font-semibold transition ${
                  mode === "select" ? "bg-primary text-primary-foreground shadow" : "hover:bg-background"
                }`}
              >
                {t("منتجات محددة", "Selected")} {selectedIds.size > 0 && `(${selectedIds.size})`}
              </button>
            </div>

            <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={includeCancelled}
                onChange={(e) => setIncludeCancelled(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              {t("تضمين الأوامر الملغاة", "Include cancelled POs")}
            </label>

            {selectedIds.size > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={clearAll}>
                <X className="h-3 w-3" /> {t("مسح التحديد", "Clear")}
              </Button>
            )}
          </div>

          {/* Product picker */}
          {mode === "select" && (
            <div className="rounded-xl border bg-muted/20 p-2 space-y-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("ابحث عن منتج…", "Search product…")}
                className="h-8 text-[13px]"
              />
              <div className="max-h-52 overflow-auto rounded-lg border bg-background divide-y">
                {filteredForPicker.length === 0 ? (
                  <div className="p-3 text-center text-[12px] text-muted-foreground">
                    {t("لا توجد منتجات بأوامر شراء", "No products with POs")}
                  </div>
                ) : (
                  filteredForPicker.map((p) => {
                    const entry = costBook.products[p.id];
                    const picked = selectedIds.has(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => toggle(p.id)}
                        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-[12px] hover:bg-muted/40 ${
                          picked ? "bg-primary/10" : ""
                        }`}
                      >
                        <input type="checkbox" readOnly checked={picked} className="h-3.5 w-3.5" />
                        {p.image_url ? (
                          <img src={p.image_url} alt="" className="h-6 w-6 rounded object-cover" />
                        ) : (
                          <div className="h-6 w-6 rounded bg-muted" />
                        )}
                        <span className="flex-1 truncate font-medium">{p.name}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {entry?.lots?.length ?? 0} {t("سطر", "lot(s)")}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Grand summary */}
          {rows.length > 1 && (
            <div className="grid gap-2 grid-cols-2 md:grid-cols-4 rounded-xl border bg-gradient-to-l from-primary/5 to-transparent p-3">
              <GrandStat label={t("منتجات", "Products")} value={String(grand.productCount)} />
              <GrandStat label={t("إجمالي الكمية", "Total Qty")} value={fmtNumber(grand.totalQty, lang)} />
              <GrandStat
                label={t("متوسط التكلفة (USD)", "Avg Cost (USD)")}
                value={money(grand.overallWacUsd, "USD")}
                highlight
              />
              <GrandStat
                label={t("متوسط التكلفة (EGP)", "Avg Cost (EGP)")}
                value={money(grand.overallWacEgp, "EGP")}
                highlight
              />
              <GrandStat label={t("إجمالي الإنفاق (USD)", "Spend (USD)")} value={money(grand.totalSpendUsd, "USD")} />
              <GrandStat label={t("إجمالي الإنفاق (EGP)", "Spend (EGP)")} value={money(grand.totalSpendEgp, "EGP")} />
              <GrandStat label={t("سطور PO", "PO lines")} value={String(grand.poCount)} />
            </div>
          )}

          {/* Per-product breakdown */}
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-[12px] text-muted-foreground">
              {mode === "all"
                ? t("لا توجد بيانات أوامر شراء بعد", "No PO data yet")
                : t("اختر منتج أو أكثر لعرض تاريخ التكلفة", "Pick one or more products to see cost history")}
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map(({ product, lots, summary }) => (
                <div key={summary.productId} className="rounded-xl border bg-card overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {product!.image_url ? (
                        <img src={product!.image_url} alt="" className="h-8 w-8 rounded object-cover" />
                      ) : (
                        <div className="h-8 w-8 rounded bg-muted" />
                      )}
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold truncate">{product!.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {summary.poCount} {t("أمر شراء", "PO(s)")} · {t("كمية", "qty")}{" "}
                          <span className="tabular-nums font-medium">{fmtNumber(summary.totalQty, lang)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-primary font-semibold tabular-nums">
                        WAC {money(summary.wacUsd, "USD")}
                      </span>
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-primary font-semibold tabular-nums">
                        WAC {money(summary.wacEgp, "EGP")}
                      </span>
                      <span className="rounded-full border bg-muted/40 px-2 py-0.5 tabular-nums">
                        {t("أدنى", "Min")} {money(summary.minUsd, "USD")}
                      </span>
                      <span className="rounded-full border bg-muted/40 px-2 py-0.5 tabular-nums">
                        {t("أعلى", "Max")} {money(summary.maxUsd, "USD")}
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead className="bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1.5 text-start">{t("أمر الشراء", "PO")}</th>
                          <th className="px-3 py-1.5 text-start">{t("التاريخ", "Date")}</th>
                          <th className="px-3 py-1.5 text-start">{t("الحالة", "Status")}</th>
                          <th className="px-3 py-1.5 text-end">{t("الكمية", "Qty")}</th>
                          <th className="px-3 py-1.5 text-end">{t("USD/وحدة", "Unit USD")}</th>
                          <th className="px-3 py-1.5 text-end">{t("سعر الدولار", "Rate")}</th>
                          <th className="px-3 py-1.5 text-end">{t("EGP/وحدة", "Unit EGP")}</th>
                          <th className="px-3 py-1.5 text-end">{t("الإجمالي EGP", "Line EGP")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {lots.map((l, i) => {
                          const isMin = l.unit_usd === summary.minUsd;
                          const isMax = l.unit_usd === summary.maxUsd;
                          return (
                            <tr key={`${l.po_id}-${i}`} className="hover:bg-muted/20">
                              <td className="px-3 py-1.5 font-medium">{l.shipment_code || l.po_id.slice(0, 8)}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">
                                {l.shipment_date ? fmtDate(l.shipment_date, lang) : "—"}
                              </td>
                              <td className="px-3 py-1.5">
                                <span className="text-[10px] rounded-full border bg-muted/40 px-2 py-0.5">
                                  {l.status ?? "—"}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-end tabular-nums">{fmtNumber(l.qty, lang)}</td>
                              <td
                                className={`px-3 py-1.5 text-end tabular-nums font-semibold ${
                                  isMin ? "text-emerald-600" : isMax ? "text-rose-600" : ""
                                }`}
                              >
                                {money(l.unit_usd, "USD")}
                              </td>
                              <td className="px-3 py-1.5 text-end tabular-nums text-muted-foreground">
                                {Number(l.usd_rate).toFixed(2)}
                              </td>
                              <td className="px-3 py-1.5 text-end tabular-nums">{money(l.unit_egp, "EGP")}</td>
                              <td className="px-3 py-1.5 text-end tabular-nums font-medium">
                                {money(l.line_total_egp, "EGP")}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-primary/5 font-semibold">
                        <tr>
                          <td className="px-3 py-1.5" colSpan={3}>
                            {t("المتوسط المرجّح", "Weighted average")}
                          </td>
                          <td className="px-3 py-1.5 text-end tabular-nums">{fmtNumber(summary.totalQty, lang)}</td>
                          <td className="px-3 py-1.5 text-end tabular-nums text-primary">
                            {money(summary.wacUsd, "USD")}
                          </td>
                          <td className="px-3 py-1.5 text-end text-muted-foreground text-[10px]">
                            {t("متوسط بسيط", "simple")} {money(summary.simpleAvgUsd, "USD")}
                          </td>
                          <td className="px-3 py-1.5 text-end tabular-nums text-primary">
                            {money(summary.wacEgp, "EGP")}
                          </td>
                          <td className="px-3 py-1.5 text-end tabular-nums">{money(summary.totalSpendEgp, "EGP")}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GrandStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-0.5 truncate tabular-nums ${
          highlight ? "text-primary font-bold text-[14px]" : "font-semibold text-[13px]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

import { ExecutiveGate } from "@/components/executive-gate";
import { RouteErrorBoundary } from "@/components/error-boundary";


export const Route = createFileRoute("/profits")({
  component: () => (
    <AppShell>
      <RouteErrorBoundary label="صافي الأرباح">
        <ExecutiveGate>
          <ProfitsPage />
        </ExecutiveGate>
      </RouteErrorBoundary>
    </AppShell>
  ),
});

