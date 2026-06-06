import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Calendar as CalendarIcon,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Receipt,
  Target,
  TrendingUp,
  Truck,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/utils-money";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { exportRowsToExcel, exportRowsToPDF, type ExportColumn } from "@/lib/critical-export";

type RangeKey = "1" | "7" | "30" | "90" | "all" | "custom";
type PayStatus = "all" | "paid" | "partial" | "outstanding";

type Invoice = {
  id: string;
  invoice_number: string;
  created_at: string;
  total: number;
  paid_amount: number | null;
  status: string;
  delivery_status?: string | null;
};

type ReceiptSummary = {
  invoice_id: string;
  receipts_count: number;
  delivered_count: number;
  shipping_fees_total: number;
};

type IncomingProduct = {
  product_id: string | null;
  product_name: string;
  qty: number;
  poIds: string[];
  poNumbers: string[];
};

type IncomingData = {
  inWindowPos: number;
  inWindowUnits: number;
  allOpenPos: number;
  allOpenUnits: number;
  inWindowProducts: IncomingProduct[];
  nextProducts: IncomingProduct[];
  nextEta: string | null;
};

function effectivePaidAmount(i: Pick<Invoice, "total" | "paid_amount">) {
  const total = Math.max(0, Number(i.total || 0));
  const raw = Number(i.paid_amount ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, total);
}

function paymentStatusLabel(status: "paid" | "partial" | "outstanding", isAr: boolean) {
  if (status === "paid") return isAr ? "مدفوع" : "Paid";
  if (status === "partial") return isAr ? "جزئي" : "Partial";
  return isAr ? "متبقي" : "Outstanding";
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function parseDateInput(value: string): Date | null {
  const raw = value.trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
  }

  const slash = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!slash) return null;
  const a = Number(slash[1]);
  const b = Number(slash[2]);
  const y = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
  const month = a > 12 ? b : a;
  const day = a > 12 ? a : b;
  const dt = new Date(y, month - 1, day, 0, 0, 0, 0);
  return dt.getFullYear() === y && dt.getMonth() === month - 1 && dt.getDate() === day ? dt : null;
}

function parseServerTimestampLocal(value: string | null | undefined): Date | null {
  if (!value) return null;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function classifyPay(i: Pick<Invoice, "id" | "total" | "paid_amount">): "paid" | "partial" | "outstanding" {
  const total = Number(i.total || 0);
  const paid = effectivePaidAmount(i);
  if (total > 0 && paid >= total - 0.001) return "paid";
  if (paid > 0) return "partial";
  return "outstanding";
}

function fmtDayLabel(d: Date, isAr: boolean) {
  return new Intl.DateTimeFormat((isAr ? "ar-EG" : "en-GB") + "-u-nu-latn", {
    day: "2-digit",
    month: "short",
  }).format(d);
}

export function SalesOverview() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [range, setRange] = useState<RangeKey>("7");
  const [payFilter, setPayFilter] = useState<PayStatus>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);
  const [windowInvoices, setWindowInvoices] = useState<Invoice[]>([]);
  const [receiptMap, setReceiptMap] = useState<Record<string, ReceiptSummary>>({});
  const [incoming, setIncoming] = useState<IncomingData>({
    inWindowPos: 0,
    inWindowUnits: 0,
    allOpenPos: 0,
    allOpenUnits: 0,
    inWindowProducts: [],
    nextProducts: [],
    nextEta: null,
  });
  const [showZeroWhy, setShowZeroWhy] = useState(false);
  const windowLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeInvoices = useMemo(
    () => allInvoices.filter((i) => !["voided", "draft", "cancelled"].includes(i.status)),
    [allInvoices],
  );

  const allFrom = useMemo(() => {
    if (!activeInvoices.length) return startOfDay(new Date());
    return startOfDay(new Date(activeInvoices.reduce((min, i) => (i.created_at < min ? i.created_at : min), activeInvoices[0].created_at)));
  }, [activeInvoices]);

  const rangeState = useMemo(() => {
    const todayStart = startOfDay(new Date());
    const todayEnd = addDays(todayStart, 1);

    if (range === "custom") {
      const parsedFrom = parseDateInput(customFrom) ?? allFrom;
      const parsedToBase = parseDateInput(customTo) ?? todayStart;
      const normalizedFrom = startOfDay(parsedFrom);
      const normalizedTo = addDays(startOfDay(parsedToBase), 1);
      if (normalizedFrom.getTime() <= normalizedTo.getTime() - 1) {
        return {
          from: normalizedFrom,
          to: normalizedTo,
          customMeta: {
            usedTodayAsEnd: !customTo,
            swapped: false,
          },
        };
      }
      return {
        from: startOfDay(parsedToBase),
        to: addDays(normalizedFrom, 1),
        customMeta: {
          usedTodayAsEnd: !customTo,
          swapped: true,
        },
      };
    }

    if (range === "all") {
      return { from: allFrom, to: todayEnd, customMeta: null };
    }

    const days = range === "1" ? 1 : range === "7" ? 7 : range === "30" ? 30 : 90;
    return {
      from: addDays(todayStart, -(days - 1)),
      to: todayEnd,
      customMeta: null,
    };
  }, [range, customFrom, customTo, allFrom]);

  const { from, to, customMeta } = rangeState;

  const fetchAllInvoices = async (filter: (q: any) => any): Promise<Invoice[]> => {
    const pageSize = 1000;
    let from = 0;
    const all: Invoice[] = [];
    // Loop until a short page (covers up to millions in theory).
    while (true) {
      let q = supabase
        .from("invoices")
        .select("id,invoice_number,created_at,total,paid_amount,status,delivery_status")
        .order("created_at", { ascending: true })
        .range(from, from + pageSize - 1);
      q = filter(q);
      const { data, error } = await q;
      if (error) break;
      const rows = (data as Invoice[]) ?? [];
      all.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
      if (from > 200000) break; // hard safety
    }
    return all;
  };

  const loadInvoices = async () => {
    const data = await fetchAllInvoices((q) => q);
    setAllInvoices(data);
  };

  const loadWindowInvoices = async () => {
    const data = await fetchAllInvoices((q) =>
      q.not("status", "in", "(voided,draft,cancelled)")
        .gte("created_at", from.toISOString())
        .lt("created_at", to.toISOString()),
    );
    setWindowInvoices(data);
  };

  const scheduleWindowRefresh = () => {
    if (windowLoadTimerRef.current) clearTimeout(windowLoadTimerRef.current);
    windowLoadTimerRef.current = setTimeout(() => {
      void loadInvoices();
      void loadWindowInvoices();
    }, 250);
  };

  const loadReceiptSummary = async () => {
    const { data } = await supabase
      .from("delivery_receipts" as any)
      .select("invoice_id,status,shipping_fees")
      .not("invoice_id", "is", null);

    const map: Record<string, ReceiptSummary> = {};
    ((data as any[]) ?? []).forEach((row) => {
      const invoiceId = String(row.invoice_id || "");
      if (!invoiceId) return;
      const current = map[invoiceId] ?? {
        invoice_id: invoiceId,
        receipts_count: 0,
        delivered_count: 0,
        shipping_fees_total: 0,
      };
      current.receipts_count += 1;
      if (row.status === "delivered") current.delivered_count += 1;
      current.shipping_fees_total += Number(row.shipping_fees || 0);
      map[invoiceId] = current;
    });
    setReceiptMap(map);
  };

  const loadIncoming = async () => {
    const { data: posRows } = await supabase
      .from("purchase_orders")
      .select("id,po_number,status,expected_arrival_at")
      .in("status", ["ordered", "shipped", "in_warehouse"])
      .order("expected_arrival_at", { ascending: true, nullsFirst: false })
      .limit(500);

    const poMap = new Map<string, any>(((posRows as any[]) ?? []).map((po) => [po.id, po]));
    const ids = Array.from(poMap.keys());
    if (!ids.length) {
      setIncoming({
        inWindowPos: 0,
        inWindowUnits: 0,
        allOpenPos: 0,
        allOpenUnits: 0,
        inWindowProducts: [],
        nextProducts: [],
        nextEta: null,
      });
      return;
    }

    const { data: itemRows } = await supabase
      .from("purchase_order_items")
      .select("po_id,product_id,product_name,quantity,received_qty")
      .in("po_id", ids);

    const addAgg = (map: Map<string, IncomingProduct>, item: any, po: any, qty: number) => {
      const key = `${item.product_id ?? item.product_name}`;
      const prev: IncomingProduct = map.get(key) ?? {
        product_id: item.product_id ?? null,
        product_name: item.product_name,
        qty: 0,
        poIds: [],
        poNumbers: [],
      };
      prev.qty += qty;
      if (!prev.poIds.includes(po.id)) prev.poIds.push(po.id);
      if (!prev.poNumbers.includes(po.po_number)) prev.poNumbers.push(po.po_number);
      map.set(key, prev);
    };

    const inWindowPos = new Set<string>();
    const inWindowProducts = new Map<string, IncomingProduct>();
    const nextProducts = new Map<string, IncomingProduct>();
    let inWindowUnits = 0;
    let allOpenUnits = 0;
    let nextEta: string | null = null;

    ((itemRows as any[]) ?? []).forEach((item) => {
      const po = poMap.get(item.po_id);
      if (!po?.expected_arrival_at) return;
      const remaining = Math.max(0, Number(item.quantity || 0) - Number(item.received_qty || 0));
      if (remaining <= 0) return;
      allOpenUnits += remaining;

      const eta = parseServerTimestampLocal(po.expected_arrival_at);
      if (!eta) return;
      const inRange = eta.getTime() >= from.getTime() && eta.getTime() < to.getTime();
      if (inRange) {
        inWindowPos.add(po.id);
        inWindowUnits += remaining;
        addAgg(inWindowProducts, item, po, remaining);
        return;
      }
      if (eta.getTime() >= to.getTime()) {
        if (!nextEta || po.expected_arrival_at < nextEta) nextEta = po.expected_arrival_at;
        addAgg(nextProducts, item, po, remaining);
      }
    });

    setIncoming({
      inWindowPos: inWindowPos.size,
      inWindowUnits,
      allOpenPos: poMap.size,
      allOpenUnits,
      inWindowProducts: Array.from(inWindowProducts.values()).sort((a, b) => b.qty - a.qty),
      nextProducts: Array.from(nextProducts.values()).sort((a, b) => b.qty - a.qty),
      nextEta,
    });
  };

  useEffect(() => {
    if (!user) return;
    loadInvoices();
    loadReceiptSummary();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadWindowInvoices();
    loadIncoming();
  }, [user, from.getTime(), to.getTime()]);

  useEffect(() => () => {
    if (windowLoadTimerRef.current) clearTimeout(windowLoadTimerRef.current);
  }, []);

  useRealtimeTable("invoices", () => { if (user) scheduleWindowRefresh(); }, [user?.id, from.getTime(), to.getTime()]);
  useRealtimeTable("delivery_receipts" as any, () => { if (user) loadReceiptSummary(); });
  useRealtimeTable("purchase_orders", () => { if (user) loadIncoming(); });
  useRealtimeTable("purchase_order_items", () => { if (user) loadIncoming(); });

  const filtered = useMemo(() => {
    return windowInvoices.filter((i) => {
      return payFilter === "all" || classifyPay(i, receiptMap[i.id]) === payFilter;
    });
  }, [windowInvoices, payFilter, receiptMap]);

  const prevTotal = useMemo(() => {
    const span = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - span);
    const prevTo = new Date(from.getTime());
    return activeInvoices
      .filter((i) => {
        const parsed = parseServerTimestampLocal(i.created_at);
        if (!parsed) return false;
        const stamp = parsed.getTime();
        if (stamp < prevFrom.getTime() || stamp >= prevTo.getTime()) return false;
        return payFilter === "all" || classifyPay(i, receiptMap[i.id]) === payFilter;
      })
      .reduce((sum, i) => sum + Number(i.total || 0), 0);
  }, [activeInvoices, from, to, payFilter, receiptMap]);

  const zeroStats = useMemo(() => {
    const before = activeInvoices.filter((i) => {
      const parsed = parseServerTimestampLocal(i.created_at);
      return parsed ? parsed.getTime() < from.getTime() : false;
    }).length;
    const after = activeInvoices.filter((i) => {
      const parsed = parseServerTimestampLocal(i.created_at);
      return parsed ? parsed.getTime() >= to.getTime() : false;
    }).length;
    const inRangeBeforePay = activeInvoices.filter((i) => {
      const parsed = parseServerTimestampLocal(i.created_at);
      if (!parsed) return false;
      const stamp = parsed.getTime();
      return stamp >= from.getTime() && stamp < to.getTime();
    });
    const deliveredYetOutstanding = inRangeBeforePay.filter((i) => {
      const summary = receiptMap[i.id];
      const delivered = i.delivery_status === "delivered" || Number(summary?.delivered_count || 0) > 0;
      return delivered && effectivePaidAmount(i) + 0.001 < Number(i.total || 0);
    }).length;
    return { before, after, inRangeBeforePay, activeCount: activeInvoices.length, deliveredYetOutstanding };
  }, [activeInvoices, from, to, receiptMap]);

  const { series, totalSales, totalPaid, count, avg, delta } = useMemo(() => {
    const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));
    const byMonth = spanDays > 120;
    const buckets = new Map<string, { date: Date; sales: number; count: number }>();
    const cursor = new Date(from);

    if (byMonth) {
      cursor.setDate(1);
      while (cursor < to) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
        buckets.set(key, { date: new Date(cursor), sales: 0, count: 0 });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    } else {
      while (cursor < to) {
        buckets.set(cursor.toISOString().slice(0, 10), { date: new Date(cursor), sales: 0, count: 0 });
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    let total = 0;
    let paid = 0;
    let invoicesCount = 0;

    filtered.forEach((invoice) => {
      const d = parseServerTimestampLocal(invoice.created_at);
      if (!d) return;
      const key = byMonth
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        : startOfDay(d).toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      const invoiceTotal = Number(invoice.total || 0);
      total += invoiceTotal;
      paid += Number(invoice.paid_amount || 0);
      invoicesCount += 1;
      if (bucket) {
        bucket.sales += invoiceTotal;
        bucket.count += 1;
      }
    });

    const monthFmt = new Intl.DateTimeFormat((isAr ? "ar-EG" : "en-GB") + "-u-nu-latn", { month: "short", year: "2-digit" });
    return {
      series: Array.from(buckets.values()).map((bucket) => ({
        label: byMonth ? monthFmt.format(bucket.date) : fmtDayLabel(bucket.date, isAr),
        sales: Math.round(bucket.sales * 100) / 100,
        count: bucket.count,
      })),
      totalSales: total,
      totalPaid: paid,
      count: invoicesCount,
      avg: invoicesCount ? total / invoicesCount : 0,
      delta: prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : total > 0 ? 100 : 0,
    };
  }, [filtered, from, to, isAr, prevTotal]);

  const outstanding = Math.max(totalSales - totalPaid, 0);
  const collectionRate = totalSales > 0 ? (totalPaid / totalSales) * 100 : 0;
  const positive = delta >= 0;

  const rangeOptions: { key: RangeKey; label: string }[] = [
    { key: "1", label: isAr ? "اليوم" : "Today" },
    { key: "7", label: isAr ? "7 أيام" : "7 days" },
    { key: "30", label: isAr ? "30 يوم" : "30 days" },
    { key: "90", label: isAr ? "90 يوم" : "90 days" },
    { key: "all", label: isAr ? "الكل" : "All" },
    { key: "custom", label: isAr ? "مخصص" : "Custom" },
  ];

  const payOptions: { key: PayStatus; label: string }[] = [
    { key: "all", label: isAr ? "الكل" : "All" },
    { key: "paid", label: isAr ? "مدفوع" : "Paid" },
    { key: "partial", label: isAr ? "جزئي" : "Partial" },
    { key: "outstanding", label: isAr ? "متبقي" : "Outstanding" },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="relative overflow-hidden rounded-3xl border bg-card p-5 shadow-[0_30px_60px_-30px_color-mix(in_oklab,var(--primary)_30%,transparent)] sm:p-7"
    >
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5" />
            {isAr ? "نظرة شاملة على المبيعات" : "Sales overview"}
          </div>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {isAr ? "كم مبيعاتي؟" : "How much did I sell?"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {isAr ? "أرقام دقيقة لحظية — يستبعد المسودات والملغية والمعدومة." : "Live, accurate — excludes drafts, voided & cancelled."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 rounded-full border bg-background/60 p-1 backdrop-blur">
          {rangeOptions.map((o) => (
            <button
              key={o.key}
              onClick={() => setRange(o.key)}
              className={`relative rounded-full px-3 py-1.5 text-xs font-medium transition ${range === o.key ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {range === o.key && <motion.span layoutId="sales-range-pill" className="absolute inset-0 rounded-full bg-gradient-to-r from-primary to-primary/80 shadow" transition={{ type: "spring", stiffness: 380, damping: 30 }} />}
              <span className="relative z-10 flex items-center gap-1.5">{o.key === "custom" && <CalendarIcon className="h-3 w-3" />}{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {range === "custom" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-4 space-y-3 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 w-auto" />
              <span className="text-xs text-muted-foreground">→</span>
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-9 w-auto" />
            </div>
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3 text-xs leading-6">
              <div className="font-semibold text-foreground">
                {isAr ? "تم تطبيق التاريخ محلياً على هذه الفترة:" : "Applied using your local date range:"}
              </div>
              <div className="mt-1 text-muted-foreground">
                {isAr ? "البداية" : "Start"}: <span className="font-semibold text-foreground">{fmtDate(from, lang)}</span>
                <span className="mx-2">•</span>
                {isAr ? "النهاية" : "End"}: <span className="font-semibold text-foreground">{fmtDate(addDays(to, -1), lang)}</span>
              </div>
              <div className="mt-1 text-muted-foreground">
                {customMeta?.usedTodayAsEnd ? (isAr ? "النهاية محسوبة حتى اليوم لأن تاريخ النهاية غير مكتوب." : "End date was completed with today.") : (isAr ? "النهاية تشمل اليوم المختار بالكامل حتى آخر اليوم المحلي." : "End date includes the selected day بالكامل in local time.")}
                {customMeta?.swapped ? ` ${isAr ? "تم عكس البداية والنهاية تلقائياً لأن الترتيب كان معكوساً." : "The range was auto-corrected because the dates were reversed."}` : ""}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{isAr ? "حالة الدفع" : "Payment status"}:</span>
        {payOptions.map((o) => (
          <button
            key={o.key}
            onClick={() => setPayFilter(o.key)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${payFilter === o.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/60 text-muted-foreground hover:text-foreground"}`}
          >
            {o.label}
          </button>
        ))}
        <button onClick={() => setShowZeroWhy((v) => !v)} className="ms-auto inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold text-muted-foreground transition hover:text-foreground">
          <HelpCircle className="h-3.5 w-3.5" />
          {isAr ? "لماذا النتيجة صفر؟" : "Why is the result zero?"}
        </button>
      </div>

      <AnimatePresence>
        {showZeroWhy && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-3 overflow-hidden rounded-2xl border bg-muted/25 p-4 text-xs leading-6">
            <div className="font-semibold text-foreground">{isAr ? "تشخيص الفلاتر الحالية" : "Current filter diagnosis"}</div>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              <li>• {isAr ? "نوع الفواتير المحتسبة" : "Included invoices"}: <span className="font-semibold text-foreground">{isAr ? "غير المسودات وغير الملغية وغير المعدومة" : "non-draft, non-cancelled, non-voided"}</span></li>
              <li>• {isAr ? "حالة الدفع الحالية" : "Payment status"}: <span className="font-semibold text-foreground">{payOptions.find((o) => o.key === payFilter)?.label}</span></li>
              <li>• {isAr ? "نطاق التاريخ الفعلي" : "Applied date range"}: <span className="font-semibold text-foreground">{fmtDate(from, lang)} → {fmtDate(addDays(to, -1), lang)}</span></li>
              <li>• {isAr ? "فواتير قبل المدى" : "Invoices before range"}: <span className="font-semibold text-foreground">{zeroStats.before}</span></li>
              <li>• {isAr ? "فواتير بعد المدى" : "Invoices after range"}: <span className="font-semibold text-foreground">{zeroStats.after}</span></li>
              <li>• {isAr ? "فواتير داخل المدى قبل فلتر الدفع" : "Invoices in range before payment filter"}: <span className="font-semibold text-foreground">{zeroStats.inRangeBeforePay.length}</span></li>
              <li>• {isAr ? "فواتير صُنّفت جزئيًا بسبب محاضر الاستلام" : "Invoices marked partial via receipts"}: <span className="font-semibold text-foreground">{zeroStats.receiptDrivenPartial}</span></li>
              {count === 0 && <li>• <span className="font-semibold text-foreground">{isAr ? "السبب الحالي للصفر" : "Current zero reason"}</span>: {zeroStats.inRangeBeforePay.length === 0 ? (isAr ? "لا توجد فواتير فعّالة داخل المدى الزمني بعد استبعاد المسودات والملغية." : "No active invoices exist inside the selected date range.") : (isAr ? "هناك فواتير داخل المدى لكن فلتر حالة الدفع الحالي استبعدها كلها." : "There are invoices in range, but the current payment filter removed them all.")}</li>}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border bg-background/50 p-4 backdrop-blur">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{isAr ? "إجمالي المبيعات" : "Total sales"}</div>
          <div className="mt-1 font-display text-3xl font-bold tabular-nums">{fmtMoney(totalSales, "EGP", lang)}</div>
          <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${positive ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-rose-500/10 text-rose-700 dark:text-rose-400"}`}>
            {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(delta).toFixed(1)}% {isAr ? "مقارنة بالفترة السابقة" : "vs previous"}
          </div>
        </div>

        <div className="rounded-2xl border bg-background/50 p-4 backdrop-blur">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground"><Receipt className="h-3 w-3" /> {isAr ? "عدد الفواتير" : "Invoices"}</div>
          <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{count}</div>
          <div className="mt-2 text-[11px] text-muted-foreground">{isAr ? "متوسط الفاتورة" : "Avg invoice"}: <span className="font-semibold text-foreground">{fmtMoney(avg, "EGP", lang)}</span></div>
        </div>

        <div className="rounded-2xl border bg-background/50 p-4 backdrop-blur">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground"><Wallet className="h-3 w-3" /> {isAr ? "المحصّل / المتوقع" : "Collected / Expected"}</div>
          <div className="mt-1 flex items-baseline gap-1.5"><span className="font-display text-2xl font-semibold tabular-nums">{fmtMoney(totalPaid, "EGP", lang)}</span><span className="text-xs text-muted-foreground">/ {fmtMoney(totalSales, "EGP", lang)}</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all" style={{ width: `${Math.min(100, collectionRate)}%` }} /></div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground"><span>{collectionRate.toFixed(1)}% {isAr ? "تحصيل" : "collected"}</span><span className="font-semibold text-amber-700 dark:text-amber-400">{isAr ? "متبقي" : "Outstanding"}: {fmtMoney(outstanding, "EGP", lang)}</span></div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-dashed bg-background/40 p-4 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/20 to-sky-500/20"><Truck className="h-5 w-5 text-violet-700 dark:text-violet-400" /></div>
            <div>
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground"><Target className="h-3 w-3" /> {isAr ? "ربط مع الشحنات القادمة" : "Linked to incoming"}</div>
              <div className="mt-0.5 text-sm font-semibold">
                {isAr ? `${incoming.inWindowPos} أمر شراء داخل نفس الفترة • ${incoming.inWindowUnits} وحدة` : `${incoming.inWindowPos} POs in this period • ${incoming.inWindowUnits} units`}
              </div>
              <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {isAr ? `إجمالي كل أوامر الشراء المفتوحة الآن: ${incoming.allOpenPos} أمر • ${incoming.allOpenUnits} وحدة. ${incoming.inWindowPos === 0 && incoming.nextEta ? `أقرب شحنة بعد الفترة الحالية متوقعة في ${fmtDate(incoming.nextEta, lang)}.` : ""}` : `All currently open incoming orders: ${incoming.allOpenPos} POs • ${incoming.allOpenUnits} units. ${incoming.inWindowPos === 0 && incoming.nextEta ? `Nearest arrival after this range is ${fmtDate(incoming.nextEta, lang)}.` : ""}`}
              </div>
            </div>
          </div>
          <Link to="/in-transit" className="inline-flex items-center gap-1 text-xs font-semibold text-primary">{isAr ? "فتح متتبع المخزون" : "Open tracker"}<ArrowRight className={`h-3.5 w-3.5 ${isAr ? "rotate-180" : ""}`} /></Link>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border bg-background/55 p-3">
            <div className="mb-2 text-xs font-semibold text-foreground">{isAr ? "تفاصيل المنتجات خلال نفس الفترة" : "Products arriving in the same period"}</div>
            {incoming.inWindowProducts.length === 0 ? (
              <div className="text-xs text-muted-foreground">{isAr ? "لا توجد منتجات متوقع وصولها داخل نفس المدى الزمني المحدد." : "No incoming products are expected inside this exact date window."}</div>
            ) : (
              <div className="space-y-2">
                {incoming.inWindowProducts.slice(0, 6).map((product) => (
                  <div key={`${product.product_id ?? product.product_name}-in`} className="rounded-xl border bg-muted/20 p-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2"><div className="font-semibold text-foreground">{product.product_name}</div><div className="font-bold tabular-nums text-violet-700">{product.qty}</div></div>
                    <div className="mt-1 text-muted-foreground">{isAr ? "السبب" : "Reason"}: {isAr ? "أمر شراء نشط" : "Active purchase order"}</div>
                    <div className="mt-1 text-muted-foreground">POs: <span className="font-medium text-foreground">{product.poNumbers.join(", ")}</span></div>
                     {product.product_id && <div className="mt-1 text-muted-foreground">ID: <span className="font-mono text-foreground">{product.product_id}</span></div>}
                     <Link
                       to="/products"
                       className="mt-2 inline-flex items-center gap-1 font-semibold text-primary"
                     >
                       {isAr ? "فتح المنتج" : "Open product"}<ArrowRight className={`h-3 w-3 ${isAr ? "rotate-180" : ""}`} />
                     </Link>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border bg-background/55 p-3">
            <div className="mb-2 text-xs font-semibold text-foreground">{isAr ? "أقرب منتجات قادمة بعد الفترة" : "Nearest upcoming products after this period"}</div>
            {incoming.nextProducts.length === 0 ? (
              <div className="text-xs text-muted-foreground">{isAr ? "لا توجد شحنات لاحقة مفتوحة حالياً." : "There are no later open incoming shipments right now."}</div>
            ) : (
              <div className="space-y-2">
                {incoming.nextProducts.slice(0, 6).map((product) => (
                  <div key={`${product.product_id ?? product.product_name}-next`} className="rounded-xl border bg-muted/20 p-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2"><div className="font-semibold text-foreground">{product.product_name}</div><div className="font-bold tabular-nums text-primary">{product.qty}</div></div>
                    <div className="mt-1 text-muted-foreground">{isAr ? "خارج المدى الحالي لكن ما زالت قادمة ضمن الشحنات المفتوحة." : "Outside the current range, but still on the open incoming list."}</div>
                    <div className="mt-1 text-muted-foreground">POs: <span className="font-medium text-foreground">{product.poNumbers.join(", ")}</span></div>
                     {product.product_id && <div className="mt-1 text-muted-foreground">ID: <span className="font-mono text-foreground">{product.product_id}</span></div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.4} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => Intl.NumberFormat("en-US", { notation: "compact" }).format(v)} />
            <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} formatter={(v: any) => [fmtMoney(Number(v), "EGP", lang), isAr ? "المبيعات" : "Sales"]} />
            <Area type="monotone" dataKey="sales" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#salesGradient)" activeDot={{ r: 5 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <SalesAuditPanel
        rows={filtered}
        receiptMap={receiptMap}
        from={from}
        to={to}
        isAr={isAr}
        lang={lang}
        payFilterLabel={payOptions.find((o) => o.key === payFilter)?.label ?? ""}
        totalSales={totalSales}
        totalPaid={totalPaid}
      />
    </motion.section>
  );
}

type AuditRow = Invoice & { _classified: "paid" | "partial" | "outstanding"; _outstanding: number };

function SalesAuditPanel({
  rows,
  receiptMap,
  from,
  to,
  isAr,
  lang,
  payFilterLabel,
  totalSales,
  totalPaid,
}: {
  rows: Invoice[];
  receiptMap: Record<string, ReceiptSummary>;
  from: Date;
  to: Date;
  isAr: boolean;
  lang: "ar" | "en";
  payFilterLabel: string;
  totalSales: number;
  totalPaid: number;
}) {
  const [open, setOpen] = useState(false);
  const audit: AuditRow[] = useMemo(() => {
    return rows.map((i) => {
      const classified = classifyPay(i, receiptMap[i.id]);
      return {
        ...i,
        _classified: classified,
        _outstanding: Math.max(0, Number(i.total || 0) - Number(i.paid_amount || 0)),
      };
    });
  }, [rows, receiptMap]);

  const columns: ExportColumn<AuditRow>[] = [
    { header: isAr ? "رقم الفاتورة" : "Invoice #", value: (r) => r.invoice_number, width: 18 },
    { header: isAr ? "التاريخ والوقت" : "Date & Time", value: (r) => fmtDateTime(r.created_at, lang), width: 32 },
    { header: isAr ? "الحالة" : "Status", value: (r) => r.status, width: 14 },
    { header: isAr ? "حالة التسليم" : "Delivery", value: (r) => r.delivery_status ?? "", width: 16 },
    { header: isAr ? "تصنيف الدفع" : "Pay Class", value: (r) => r._classified, width: 12 },
    { header: isAr ? "الإجمالي" : "Total", value: (r) => Number(r.total || 0), pdf: (r) => fmtMoney(Number(r.total || 0), "EGP", lang), width: 14 },
    { header: isAr ? "المدفوع" : "Paid", value: (r) => Number(r.paid_amount || 0), pdf: (r) => fmtMoney(Number(r.paid_amount || 0), "EGP", lang), width: 14 },
    { header: isAr ? "المتبقي" : "Outstanding", value: (r) => r._outstanding, pdf: (r) => fmtMoney(r._outstanding, "EGP", lang), width: 14 },
    { header: isAr ? "محاضر مسلّمة" : "Delivered Receipts", value: (r) => Number(receiptMap[r.id]?.delivered_count || 0), width: 12 },
    { header: "ID", value: (r) => r.id, width: 38 },
  ];

  const title = `${isAr ? "تدقيق المبيعات" : "Sales Audit"} ${fmtDate(from, lang)} → ${fmtDate(new Date(to.getTime() - 1), lang)} • ${payFilterLabel}`;

  return (
    <div className="mt-6 rounded-2xl border bg-background/50">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <button onClick={() => setOpen((v) => !v)} className="me-auto text-sm font-semibold text-foreground">
          {isAr ? "تدقيق دقيق — كل فاتورة بحسابها" : "Full audit — every invoice line"} ({audit.length})
        </button>
        <span className="text-[11px] text-muted-foreground">
          {isAr ? "إجمالي" : "Total"}: <span className="font-semibold text-foreground">{fmtMoney(totalSales, "EGP", lang)}</span>
          {" • "}
          {isAr ? "محصّل" : "Paid"}: <span className="font-semibold text-foreground">{fmtMoney(totalPaid, "EGP", lang)}</span>
        </span>
        <Button size="sm" variant="outline" onClick={() => exportRowsToExcel(audit, columns, { fileName: "sales_audit", sheetName: "Audit", title })}>
          <FileSpreadsheet className="h-3.5 w-3.5 me-1" /> Excel
        </Button>
        <Button size="sm" variant="outline" onClick={() => exportRowsToPDF(audit, columns, { fileName: "sales_audit", title, orientation: "l" })}>
          <FileText className="h-3.5 w-3.5 me-1" /> PDF
        </Button>
      </div>
      {open && (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-2 text-start">{isAr ? "الفاتورة" : "Invoice"}</th>
                <th className="p-2 text-start">{isAr ? "التاريخ" : "Date"}</th>
                <th className="p-2 text-start">{isAr ? "الدفع" : "Pay"}</th>
                <th className="p-2 text-end">{isAr ? "الإجمالي" : "Total"}</th>
                <th className="p-2 text-end">{isAr ? "المدفوع" : "Paid"}</th>
                <th className="p-2 text-end">{isAr ? "المتبقي" : "Outstanding"}</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="p-2 font-mono">{r.invoice_number}</td>
                  <td className="p-2 text-muted-foreground">{fmtDate(r.created_at, lang)}</td>
                  <td className="p-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${r._classified === "paid" ? "bg-emerald-500/15 text-emerald-700" : r._classified === "partial" ? "bg-amber-500/15 text-amber-700" : "bg-rose-500/15 text-rose-700"}`}>{r._classified}</span></td>
                  <td className="p-2 text-end tabular-nums">{fmtMoney(Number(r.total || 0), "EGP", lang)}</td>
                  <td className="p-2 text-end tabular-nums">{fmtMoney(Number(r.paid_amount || 0), "EGP", lang)}</td>
                  <td className="p-2 text-end tabular-nums font-semibold text-amber-700">{fmtMoney(r._outstanding, "EGP", lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}