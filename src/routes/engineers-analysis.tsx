import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { fmtMoney, fmtDate } from "@/lib/utils-money";
import { Users, Search, Globe2, Calendar, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/engineers-analysis")({
  component: () => <AppShell><EngineersAnalysis /></AppShell>,
});

type Row = {
  customer_id: string;
  name: string;
  phone: string | null;
  company_name: string | null;
  sales_channel: string | null;
  invoice_count: number;
  total_sales: number;
  outstanding: number;
  first_invoice: string | null;
  last_invoice: string | null;
};

function EngineersAnalysis() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [channel, setChannel] = useState<"all" | "online" | "offline">("all");
  const [days, setDays] = useState<number>(0); // 0 = all-time

  const load = async () => {
    if (!user) return;
    // Get all engineer customers
    const { data: customers } = await (supabase.from as any)("customers")
      .select("id,name,phone,company_name,sales_channel")
      .eq("category", "engineer");
    const ids = (customers ?? []).map((c: any) => c.id);
    if (ids.length === 0) { setRows([]); return; }

    let invQuery = (supabase.from as any)("invoices")
      .select("id,customer_id,total,paid_amount,created_at")
      .in("customer_id", ids)
      .neq("status", "draft");
    if (days > 0) {
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      invQuery = invQuery.gte("created_at", since);
    }
    const { data: invs } = await invQuery;

    const byCustomer = new Map<string, { count: number; total: number; outstanding: number; first: string | null; last: string | null }>();
    (invs ?? []).forEach((i: any) => {
      const cur = byCustomer.get(i.customer_id) ?? { count: 0, total: 0, outstanding: 0, first: null, last: null };
      cur.count += 1;
      cur.total += Number(i.total || 0);
      cur.outstanding += Math.max(0, Number(i.total || 0) - Number(i.paid_amount || 0));
      if (!cur.first || i.created_at < cur.first) cur.first = i.created_at;
      if (!cur.last || i.created_at > cur.last) cur.last = i.created_at;
      byCustomer.set(i.customer_id, cur);
    });

    const list: Row[] = (customers ?? []).map((c: any) => {
      const stats = byCustomer.get(c.id) ?? { count: 0, total: 0, outstanding: 0, first: null, last: null };
      return {
        customer_id: c.id,
        name: c.name,
        phone: c.phone,
        company_name: c.company_name,
        sales_channel: c.sales_channel,
        invoice_count: stats.count,
        total_sales: stats.total,
        outstanding: stats.outstanding,
        first_invoice: stats.first,
        last_invoice: stats.last,
      };
    });
    list.sort((a, b) => b.total_sales - a.total_sales);
    setRows(list);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id, days]);
  useRealtimeTable("invoices", () => load());
  useRealtimeTable("customers", () => load());

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (channel === "online" && r.sales_channel !== "online") return false;
      if (channel === "offline" && r.sales_channel === "online") return false;
      if (!s) return true;
      return [r.name, r.phone ?? "", r.company_name ?? ""].some((x) => x.toLowerCase().includes(s));
    });
  }, [rows, q, channel]);

  const totals = useMemo(() => filtered.reduce((acc, r) => ({
    customers: acc.customers + 1,
    invoices: acc.invoices + r.invoice_count,
    sales: acc.sales + r.total_sales,
    outstanding: acc.outstanding + r.outstanding,
  }), { customers: 0, invoices: 0, sales: 0, outstanding: 0 }), [filtered]);

  const onlineCount = filtered.filter((r) => r.sales_channel === "online").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gradient-gold">{isAr ? "تحليل المهندسين" : "Engineers Analysis"}</h1>
          <p className="text-xs text-muted-foreground">{isAr ? "تقرير لحظي بالمهندسين والفواتير والمبيعات المرتبطة بهم" : "Real-time engineer customers, invoices, sales"}</p>
        </div>
        <div className="flex gap-1 rounded-full border bg-muted/30 p-1 text-xs">
          {[{k:0,ar:"الكل",en:"All-time"},{k:7,ar:"7 أيام",en:"7d"},{k:30,ar:"30 يوم",en:"30d"},{k:90,ar:"90 يوم",en:"90d"}].map((p) => (
            <button key={p.k} onClick={() => setDays(p.k)} className={`rounded-full px-3 py-1 ${days===p.k?"bg-foreground text-background":"text-muted-foreground hover:text-foreground"}`}>{isAr?p.ar:p.en}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={Users} label={isAr ? "المهندسين" : "Engineers"} value={String(totals.customers)} />
        <Stat icon={Globe2} label={isAr ? "أونلاين" : "Online"} value={`${onlineCount}`} tone="cyan" />
        <Stat icon={TrendingUp} label={isAr ? "إجمالي المبيعات" : "Sales"} value={fmtMoney(totals.sales, "EGP", lang)} tone="emerald" />
        <Stat icon={Calendar} label={isAr ? "عدد الفواتير" : "Invoices"} value={String(totals.invoices)} />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={isAr ? "بحث بالاسم أو الموبايل أو الشركة" : "Search"} className="ps-9" />
        </div>
        <div className="flex gap-1 rounded-full border bg-muted/30 p-1 text-xs">
          {[{k:"all",ar:"كل المصادر",en:"All"},{k:"online",ar:"أونلاين",en:"Online"},{k:"offline",ar:"غير أونلاين",en:"Offline"}].map((p) => (
            <button key={p.k} onClick={() => setChannel(p.k as any)} className={`rounded-full px-3 py-1 ${channel===p.k?"bg-foreground text-background":"text-muted-foreground hover:text-foreground"}`}>{isAr?p.ar:p.en}</button>
          ))}
        </div>
      </div>

      <div className="surface-elevated overflow-hidden rounded-2xl border bg-card">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{isAr ? "لا توجد بيانات" : "No data"}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start">{isAr ? "المهندس" : "Engineer"}</th>
                  <th className="px-3 py-2 text-start">{isAr ? "الشركة/الموبايل" : "Company / Phone"}</th>
                  <th className="px-3 py-2 text-center">{isAr ? "المصدر" : "Source"}</th>
                  <th className="px-3 py-2 text-end">{isAr ? "الفواتير" : "Invoices"}</th>
                  <th className="px-3 py-2 text-end">{isAr ? "الإجمالي" : "Total"}</th>
                  <th className="px-3 py-2 text-end">{isAr ? "المتبقي" : "Outstanding"}</th>
                  <th className="px-3 py-2 text-start">{isAr ? "آخر نشاط" : "Last activity"}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => (
                  <tr key={r.customer_id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{[r.company_name, r.phone].filter(Boolean).join(" • ") || "—"}</td>
                    <td className="px-3 py-2 text-center">
                      {r.sales_channel === "online"
                        ? <Badge variant="outline" className="border-cyan-400/40 text-cyan-600 dark:text-cyan-300"><Globe2 className="me-1 h-3 w-3" /> Online</Badge>
                        : <span className="text-xs text-muted-foreground">{r.sales_channel || "—"}</span>}
                    </td>
                    <td className="px-3 py-2 text-end font-bold tabular-nums">{r.invoice_count}</td>
                    <td className="px-3 py-2 text-end font-bold tabular-nums">{fmtMoney(r.total_sales, "EGP", lang)}</td>
                    <td className={`px-3 py-2 text-end tabular-nums ${r.outstanding > 0 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}`}>{fmtMoney(r.outstanding, "EGP", lang)}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{r.last_invoice ? fmtDate(r.last_invoice, lang) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone = "default" }: { icon: any; label: string; value: string; tone?: "default" | "emerald" | "cyan" }) {
  const cls = tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : tone === "cyan" ? "text-cyan-600 dark:text-cyan-400" : "";
  return (
    <div className="ios-card flex items-center gap-3 p-3">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-muted/50 ${cls}`}><Icon className="h-4 w-4" /></div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
        <div className={`truncate text-base font-bold tabular-nums ${cls}`}>{value}</div>
      </div>
    </div>
  );
}
