import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "@tanstack/react-router";
import { TrendingUp, Calendar as CalendarIcon, ArrowUpRight, ArrowDownRight, Receipt, Wallet, Truck, ArrowRight, Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtMoney } from "@/lib/utils-money";
import { Input } from "@/components/ui/input";

type RangeKey = "1" | "7" | "30" | "90" | "all" | "custom";
type PayStatus = "all" | "paid" | "partial" | "outstanding";

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
// Robust YYYY-MM-DD parser → local midnight (avoids UTC drift from new Date(str))
function parseLocalISO(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}
function fmtDayLabel(d: Date, isAr: boolean) {
  return new Intl.DateTimeFormat((isAr ? "ar-EG" : "en-GB") + "-u-nu-latn", { day: "2-digit", month: "short" }).format(d);
}

type Invoice = { created_at: string; total: number; paid_amount: number | null };

function classifyPay(i: Invoice): "paid" | "partial" | "outstanding" {
  const t = Number(i.total || 0);
  const p = Number(i.paid_amount || 0);
  if (t > 0 && p >= t - 0.001) return "paid";
  if (p > 0) return "partial";
  return "outstanding";
}

export function SalesOverview() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [range, setRange] = useState<RangeKey>("7");
  const [payFilter, setPayFilter] = useState<PayStatus>("all");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [incoming, setIncoming] = useState<{ pos: number; units: number }>({ pos: 0, units: 0 });
  const [allFrom, setAllFrom] = useState<Date | null>(null);

  const { from, to } = useMemo(() => {
    const todayEnd = startOfDay(new Date());
    todayEnd.setDate(todayEnd.getDate() + 1);
    if (range === "custom") {
      const f = parseLocalISO(customFrom) ?? (allFrom ? startOfDay(allFrom) : (() => { const d = startOfDay(new Date()); d.setDate(d.getDate() - 30); return d; })());
      const tParsed = parseLocalISO(customTo);
      const t = tParsed ? (() => { const x = new Date(tParsed); x.setDate(x.getDate() + 1); return x; })() : todayEnd;
      // Guard: swap if user picked them backwards
      if (f.getTime() >= t.getTime()) return { from: t, to: new Date(f.getTime() + 86400000) };
      return { from: f, to: t };
    }
    if (range === "all") {
      const f = allFrom ? startOfDay(allFrom) : (() => { const d = startOfDay(new Date()); d.setDate(d.getDate() - 365); return d; })();
      return { from: f, to: todayEnd };
    }
    const days = range === "1" ? 1 : range === "7" ? 7 : range === "30" ? 30 : range === "90" ? 90 : 7;
    const f = startOfDay(new Date());
    f.setDate(f.getDate() - (days - 1));
    return { from: f, to: todayEnd };
  }, [range, customFrom, customTo, allFrom]);

  // For "all", discover the earliest invoice date once
  useEffect(() => {
    if ((range !== "all" && range !== "custom") || allFrom || !user) return;
    supabase
      .from("invoices")
      .select("created_at")
      .not("status", "in", "(voided,draft,cancelled)")
      .order("created_at", { ascending: true })
      .limit(1)
      .then(({ data }) => {
        const first = (data as any)?.[0]?.created_at;
        if (first) setAllFrom(new Date(first));
        else setAllFrom(new Date()); // no data — collapse to today
      });
  }, [range, allFrom, user]);

  const load = async () => {
    const { data } = await supabase
      .from("invoices")
      .select("created_at,total,paid_amount,status")
      .not("status", "in", "(voided,draft,cancelled)")
      .gte("created_at", from.toISOString())
      .lt("created_at", to.toISOString())
      .order("created_at", { ascending: true });
    setInvoices((data as any) ?? []);
  };

  const loadIncoming = async () => {
    // POs expected to arrive within the same period
    const { data: pos } = await supabase
      .from("purchase_orders")
      .select("id")
      .in("status", ["ordered", "shipped", "in_warehouse"])
      .gte("expected_arrival_at", from.toISOString())
      .lt("expected_arrival_at", to.toISOString());
    const ids = ((pos as any) ?? []).map((p: any) => p.id);
    if (ids.length === 0) { setIncoming({ pos: 0, units: 0 }); return; }
    const { data: items } = await supabase
      .from("purchase_order_items")
      .select("po_id,quantity,received_qty")
      .in("po_id", ids);
    const units = ((items as any) ?? []).reduce((s: number, it: any) => s + Math.max(0, Number(it.quantity || 0) - Number(it.received_qty || 0)), 0);
    setIncoming({ pos: ids.length, units });
  };

  useEffect(() => { if (user) { load(); loadIncoming(); } /* eslint-disable-next-line */ }, [user, from.getTime(), to.getTime()]);
  useRealtimeTable("invoices", () => { if (user) load(); });
  useRealtimeTable("purchase_orders", () => { if (user) loadIncoming(); });
  useRealtimeTable("purchase_order_items", () => { if (user) loadIncoming(); });

  const [prevTotal, setPrevTotal] = useState<number>(0);
  useEffect(() => {
    if (!user) return;
    const span = to.getTime() - from.getTime();
    const prevTo = new Date(from);
    const prevFrom = new Date(from.getTime() - span);
    supabase
      .from("invoices")
      .select("total,paid_amount,status")
      .not("status", "in", "(voided,draft,cancelled)")
      .gte("created_at", prevFrom.toISOString())
      .lt("created_at", prevTo.toISOString())
      .then(({ data }) => {
        const filtered = ((data as any) ?? []).filter((i: any) => payFilter === "all" || classifyPay(i) === payFilter);
        setPrevTotal(filtered.reduce((s: number, i: any) => s + Number(i.total || 0), 0));
      });
  }, [user, from.getTime(), to.getTime(), payFilter]);

  const filtered = useMemo(() => invoices.filter((i) => payFilter === "all" || classifyPay(i) === payFilter), [invoices, payFilter]);

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
        const key = cursor.toISOString().slice(0, 10);
        buckets.set(key, { date: new Date(cursor), sales: 0, count: 0 });
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    let totalSales = 0, totalPaid = 0, count = 0;
    filtered.forEach((i) => {
      const d = new Date(i.created_at);
      const key = byMonth
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        : d.toISOString().slice(0, 10);
      const b = buckets.get(key);
      const t = Number(i.total || 0);
      const p = Number(i.paid_amount || 0);
      totalSales += t;
      totalPaid += p;
      count += 1;
      if (b) { b.sales += t; b.count += 1; }
    });
    const monthFmt = new Intl.DateTimeFormat((isAr ? "ar-EG" : "en-GB") + "-u-nu-latn", { month: "short", year: "2-digit" });
    const series = Array.from(buckets.values()).map((b) => ({
      label: byMonth ? monthFmt.format(b.date) : fmtDayLabel(b.date, isAr),
      sales: Math.round(b.sales * 100) / 100,
      count: b.count,
    }));
    const avg = count > 0 ? totalSales / count : 0;
    const delta = prevTotal > 0 ? ((totalSales - prevTotal) / prevTotal) * 100 : (totalSales > 0 ? 100 : 0);
    return { series, totalSales, totalPaid, count, avg, delta };
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
      className="relative overflow-hidden rounded-3xl border bg-card p-5 sm:p-7 shadow-[0_30px_60px_-30px_color-mix(in_oklab,var(--primary)_30%,transparent)]"
    >
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute -top-32 -end-32 h-72 w-72 rounded-full bg-gradient-to-br from-primary/30 to-transparent blur-3xl" />
        <div className="absolute -bottom-32 -start-24 h-72 w-72 rounded-full bg-gradient-to-tr from-amber-500/20 to-transparent blur-3xl" />
      </div>

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
              className={`relative rounded-full px-3 py-1.5 text-xs font-medium transition ${
                range === o.key ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {range === o.key && (
                <motion.span
                  layoutId="sales-range-pill"
                  className="absolute inset-0 rounded-full bg-gradient-to-r from-primary to-primary/80 shadow"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                {o.key === "custom" && <CalendarIcon className="h-3 w-3" />}
                {o.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {range === "custom" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="relative mt-4 flex flex-wrap items-center gap-2"
          >
            <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 w-auto" />
            <span className="text-xs text-muted-foreground">→</span>
            <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-9 w-auto" />
            {(!customFrom || !customTo) && (
              <span className="text-xs text-muted-foreground">{isAr ? "اختر الفترة" : "Pick a range"}</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pay status filter */}
      <div className="relative mt-4 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {isAr ? "حالة الدفع" : "Payment status"}:
        </span>
        {payOptions.map((o) => (
          <button
            key={o.key}
            onClick={() => setPayFilter(o.key)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
              payFilter === o.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="relative mt-6 grid gap-4 sm:grid-cols-3">
        <motion.div
          key={`total-${totalSales}-${payFilter}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="col-span-1 sm:col-span-1 rounded-2xl border bg-background/50 p-4 backdrop-blur"
        >
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{isAr ? "إجمالي المبيعات" : "Total sales"}</div>
          <div className="mt-1 font-display text-3xl font-bold tabular-nums">{fmtMoney(totalSales, "EGP", lang)}</div>
          <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${positive ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-rose-500/10 text-rose-700 dark:text-rose-400"}`}>
            {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(delta).toFixed(1)}% {isAr ? "مقارنة بالفترة السابقة" : "vs previous"}
          </div>
        </motion.div>

        <div className="rounded-2xl border bg-background/50 p-4 backdrop-blur">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Receipt className="h-3 w-3" /> {isAr ? "عدد الفواتير" : "Invoices"}
          </div>
          <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{count}</div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            {isAr ? "متوسط الفاتورة" : "Avg invoice"}: <span className="font-semibold text-foreground">{fmtMoney(avg, "EGP", lang)}</span>
          </div>
        </div>

        <div className="rounded-2xl border bg-background/50 p-4 backdrop-blur">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Wallet className="h-3 w-3" /> {isAr ? "المحصّل / المتوقع" : "Collected / Expected"}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-display text-2xl font-semibold tabular-nums">{fmtMoney(totalPaid, "EGP", lang)}</span>
            <span className="text-xs text-muted-foreground">/ {fmtMoney(totalSales, "EGP", lang)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all"
              style={{ width: `${Math.min(100, collectionRate)}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{collectionRate.toFixed(1)}% {isAr ? "تحصيل" : "collected"}</span>
            <span className="text-amber-700 dark:text-amber-400 font-semibold">
              {isAr ? "متبقي" : "Outstanding"}: {fmtMoney(outstanding, "EGP", lang)}
            </span>
          </div>
        </div>
      </div>

      {/* Sales vs Incoming link card */}
      <Link
        to="/in-transit"
        className="relative mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed bg-background/40 p-4 backdrop-blur transition hover:border-primary/50 hover:bg-background/70"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/20 to-sky-500/20">
            <Truck className="h-5 w-5 text-violet-700 dark:text-violet-400" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Target className="h-3 w-3" />
              {isAr ? "ربط مع الشحنات القادمة" : "Linked to incoming"}
            </div>
            <div className="mt-0.5 text-sm font-semibold">
              {isAr
                ? `${incoming.pos} أمر شراء متوقع وصوله • ${incoming.units} وحدة قادمة خلال نفس الفترة`
                : `${incoming.pos} POs expected • ${incoming.units} units arriving in this window`}
            </div>
          </div>
        </div>
        <div className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
          {isAr ? "عرض تفاصيل المنتجات" : "View product breakdown"}
          <ArrowRight className={`h-3.5 w-3.5 ${isAr ? "rotate-180" : ""}`} />
        </div>
      </Link>

      <div className="relative mt-6 h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary, 220 90% 56%))" stopOpacity={0.5} />
                <stop offset="100%" stopColor="hsl(var(--primary, 220 90% 56%))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.4} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => Intl.NumberFormat("en-US", { notation: "compact" }).format(v)} />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 12,
                fontSize: 12,
              }}
              formatter={(v: any) => [fmtMoney(Number(v), "EGP", lang), isAr ? "المبيعات" : "Sales"]}
            />
            <Area type="monotone" dataKey="sales" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#salesGradient)" activeDot={{ r: 5 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.section>
  );
}
