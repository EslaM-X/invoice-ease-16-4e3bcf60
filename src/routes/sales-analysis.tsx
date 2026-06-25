import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { fmtMoney, fmtDate } from "@/lib/utils-money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { BarChart3, CalendarDays, Globe2, Plus, Sparkles, Store, Users } from "lucide-react";
import type { SalesEvent } from "@/lib/data";
import { CUSTOMER_CATEGORIES, SALES_CHANNELS, labelForCustomerCategory, labelForSalesChannel } from "@/lib/sales-classification";

export const Route = createFileRoute("/sales-analysis")({ component: () => <AppShell><SalesAnalysis /></AppShell> });

type Inv = { id: string; invoice_number: string; created_at: string; total: number; customer_name: string | null; customer_phone: string | null; customer_category: string | null; sales_channel: string | null; sales_event_id: string | null; status: string | null };

function SalesAnalysis() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [invoices, setInvoices] = useState<Inv[]>([]);
  const [events, setEvents] = useState<SalesEvent[]>([]);
  const [category, setCategory] = useState("all");
  const [channel, setChannel] = useState("all");
  const [eventId, setEventId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [newEvent, setNewEvent] = useState({ name: "", year: String(new Date().getFullYear()), location: "" });

  const load = async () => {
    const [{ data: inv }, { data: ev }] = await Promise.all([
      supabase.from("invoices").select("id,invoice_number,created_at,total,customer_name,customer_phone,customer_category,sales_channel,sales_event_id,status").not("status", "in", "(voided,draft)").order("created_at", { ascending: false }).range(0, 9999),
      (supabase.from as any)("sales_events").select("*").order("year", { ascending: false }).order("name"),
    ]);
    setInvoices((inv ?? []) as Inv[]);
    setEvents((ev ?? []) as SalesEvent[]);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => invoices.filter((i) => {
    if (category !== "all" && (i.customer_category ?? "") !== category) return false;
    if (channel !== "all" && (i.sales_channel ?? "") !== channel) return false;
    if (eventId !== "all" && (i.sales_event_id ?? "") !== eventId) return false;
    if (from && i.created_at < from) return false;
    if (to && i.created_at > `${to}T23:59:59`) return false;
    return true;
  }), [invoices, category, channel, eventId, from, to]);

  const sum = (rows: Inv[]) => rows.reduce((s, i) => s + Number(i.total ?? 0), 0);
  const total = sum(filtered);
  const onlineEngineers = filtered.filter((i) => i.sales_channel === "online" && i.customer_category === "engineer");
  const byChannel = SALES_CHANNELS.map((c) => ({ key: c.value, label: isAr ? c.ar : c.en, rows: filtered.filter((i) => i.sales_channel === c.value) })).filter((x) => x.rows.length);
  const byCategory = CUSTOMER_CATEGORIES.map((c) => ({ key: c.value, label: isAr ? c.ar : c.en, rows: filtered.filter((i) => i.customer_category === c.value) })).filter((x) => x.rows.length);
  const byEvent = events.map((ev) => ({ key: ev.id, label: `${ev.name}${ev.year ? ` ${ev.year}` : ""}`, rows: filtered.filter((i) => i.sales_event_id === ev.id) })).filter((x) => x.rows.length);

  const addEvent = async () => {
    if (!newEvent.name.trim()) return toast.error(isAr ? "اسم المعرض مطلوب" : "Event name required");
    const { error } = await (supabase.from as any)("sales_events").insert({ name: newEvent.name.trim(), year: Number(newEvent.year) || null, location: newEvent.location.trim() || null, event_type: "exhibition", is_active: true });
    if (error) return toast.error(error.message);
    toast.success(isAr ? "تم إضافة المعرض" : "Event added");
    setNewEvent({ name: "", year: String(new Date().getFullYear()), location: "" });
    load();
  };

  return <div className="space-y-6">
    <div className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-zinc-950 via-zinc-900 to-amber-950/50 p-6 text-white shadow-2xl">
      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, #f5c66b 0, transparent 28%), radial-gradient(circle at 80% 10%, #7dd3fc 0, transparent 25%)" }} />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div><div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-amber-300"><Sparkles className="h-4 w-4" /> {isAr ? "تحليل احترافي" : "Premium analytics"}</div><h1 className="text-3xl font-black">{isAr ? "تحليل المبيعات والمعارض" : "Sales & Events Analysis"}</h1><p className="mt-2 max-w-2xl text-sm text-white/65">{isAr ? "اعرف مبيعات كل معرض، الأونلاين، الموزعين، المهندسين، وشركات التشطيب بالأرقام والفواتير." : "Track events, online, distributors, engineers and finishing companies with invoices."}</p></div>
        <div className="rounded-2xl border border-white/15 bg-white/10 p-4 text-end backdrop-blur"><div className="text-xs text-white/55">{isAr ? "إجمالي الفلتر" : "Filtered total"}</div><div className="text-2xl font-black tabular-nums text-amber-200">{fmtMoney(total, "EGP", lang)}</div><div className="text-xs text-white/55">{filtered.length} {isAr ? "فاتورة" : "invoices"}</div></div>
      </div>
    </div>

    <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
      <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="all">{isAr ? "كل العملاء" : "All customers"}</option>{CUSTOMER_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{isAr ? c.ar : c.en}</option>)}</select>
      <select value={channel} onChange={(e) => setChannel(e.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="all">{isAr ? "كل القنوات" : "All channels"}</option>{SALES_CHANNELS.map((c) => <option key={c.value} value={c.value}>{isAr ? c.ar : c.en}</option>)}</select>
      <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="all">{isAr ? "كل المعارض" : "All events"}</option>{events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}{ev.year ? ` ${ev.year}` : ""}</option>)}</select>
    </div>

    <div className="grid gap-3 md:grid-cols-4">
      <Metric icon={Store} title={isAr ? "مبيعات المعارض" : "Events sales"} value={fmtMoney(sum(filtered.filter((i) => i.sales_channel === "event" || !!i.sales_event_id)), "EGP", lang)} />
      <Metric icon={Globe2} title={isAr ? "مبيعات الأونلاين" : "Online sales"} value={fmtMoney(sum(filtered.filter((i) => i.sales_channel === "online")), "EGP", lang)} />
      <Metric icon={Users} title={isAr ? "مهندسين أونلاين" : "Online engineers"} value={fmtMoney(sum(onlineEngineers), "EGP", lang)} sub={`${onlineEngineers.length} ${isAr ? "فاتورة" : "invoices"}`} />
      <Metric icon={CalendarDays} title={isAr ? "عدد المعارض" : "Events"} value={events.length} />
    </div>

    <div className="grid gap-4 lg:grid-cols-3">
      <Breakdown title={isAr ? "حسب قناة البيع" : "By channel"} rows={byChannel} total={total} lang={lang} />
      <Breakdown title={isAr ? "حسب نوع العميل" : "By customer type"} rows={byCategory} total={total} lang={lang} />
      <Breakdown title={isAr ? "حسب المعرض / الحدث" : "By event"} rows={byEvent} total={total} lang={lang} />
    </div>

    <div className="rounded-2xl border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 font-bold"><Plus className="h-4 w-4" /> {isAr ? "إضافة معرض / حدث جديد" : "Add event"}</div>
      <div className="grid gap-2 sm:grid-cols-[1fr_120px_1fr_auto]"><Input placeholder={isAr ? "مثال: Le Marché" : "Event name"} value={newEvent.name} onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })} /><Input placeholder="2026" value={newEvent.year} onChange={(e) => setNewEvent({ ...newEvent, year: e.target.value })} /><Input placeholder={isAr ? "المكان" : "Location"} value={newEvent.location} onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })} /><Button onClick={addEvent}>{isAr ? "إضافة" : "Add"}</Button></div>
    </div>

    <div className="overflow-hidden rounded-2xl border bg-card"><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/50"><tr><th className="px-4 py-3 text-start">{isAr ? "الفاتورة" : "Invoice"}</th><th className="px-4 py-3 text-start">{isAr ? "العميل" : "Customer"}</th><th className="px-4 py-3 text-start">Catgry</th><th className="px-4 py-3 text-start">{isAr ? "المصدر" : "Channel"}</th><th className="px-4 py-3 text-start">{isAr ? "التاريخ" : "Date"}</th><th className="px-4 py-3 text-end">{isAr ? "الإجمالي" : "Total"}</th></tr></thead><tbody className="divide-y">{filtered.map((i) => <tr key={i.id} className="hover:bg-muted/30"><td className="px-4 py-3 font-semibold"><Link to="/invoices/$id" params={{ id: i.id }} className="hover:underline">{i.invoice_number}</Link></td><td className="px-4 py-3">{i.customer_name || "—"}<div className="text-[11px] text-muted-foreground">{i.customer_phone}</div></td><td className="px-4 py-3">{labelForCustomerCategory(i.customer_category, lang as any)}</td><td className="px-4 py-3">{labelForSalesChannel(i.sales_channel, lang as any)}</td><td className="px-4 py-3 text-muted-foreground">{fmtDate(i.created_at, lang)}</td><td className="px-4 py-3 text-end font-bold">{fmtMoney(i.total, "EGP", lang)}</td></tr>)}</tbody></table></div>
  </div>;
}

function Metric({ icon: Icon, title, value, sub }: any) { return <div className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-center justify-between"><div className="text-xs text-muted-foreground">{title}</div><Icon className="h-5 w-5 text-amber-500" /></div><div className="mt-3 text-xl font-black tabular-nums">{value}</div>{sub && <div className="text-xs text-muted-foreground">{sub}</div>}</div>; }
function Breakdown({ title, rows, total, lang }: any) { return <div className="rounded-2xl border bg-card p-4"><div className="mb-3 flex items-center gap-2 font-bold"><BarChart3 className="h-4 w-4 text-amber-500" />{title}</div><div className="space-y-3">{rows.length === 0 ? <div className="text-sm text-muted-foreground">—</div> : rows.map((r: any) => { const val = r.rows.reduce((s: number, i: Inv) => s + Number(i.total || 0), 0); const pct = total > 0 ? Math.round((val / total) * 100) : 0; return <div key={r.key}><div className="mb-1 flex justify-between text-sm"><span>{r.label}</span><span className="font-bold tabular-nums">{fmtMoney(val, "EGP", lang)}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-200" style={{ width: `${pct}%` }} /></div><div className="mt-0.5 text-[10px] text-muted-foreground">{r.rows.length} invoices · {pct}%</div></div>; })}</div></div>; }
