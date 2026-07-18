import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useRole } from "@/lib/use-role";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/lib/realtime";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { BarChart3, Loader2, Star, TrendingUp, Phone, Search, FileText, ExternalLink, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { PageBlockSkeleton, CardsSkeleton } from "@/components/skeletons";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";


export const Route = createFileRoute("/call-center-reports")({
  component: ReportsPage,
});

const COLORS = ["#d4a017", "#1f2937", "#10b981", "#3b82f6", "#a855f7", "#ef4444"];

function ReportsPage() {
  const { isManager, loading: rl } = useRole();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const navigate = useNavigate();
  const [calls, setCalls] = useState<any[]>([]);
  const [ratings, setRatings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {

    if (!rl && !isManager) {
      toast.error(isAr ? "غير مصرح" : "Unauthorized");
      navigate({ to: "/dashboard" });
    }
  }, [rl, isManager, navigate, isAr]);

  const load = async () => {
    if (calls.length === 0 && ratings.length === 0) setLoading(true);

    const [{ data: c }, { data: r }] = await Promise.all([
      supabase.from("call_logs").select("*").order("called_at", { ascending: false }).limit(500),
      supabase.from("customer_ratings").select("*").order("created_at", { ascending: false }).limit(500),
    ]);
    setCalls(c ?? []);
    setRatings(r ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (isManager) load();
  }, [isManager]);
  useRealtimeTable("call_logs", () => isManager && load());
  useRealtimeTable("customer_ratings", () => isManager && load());

  const stats = useMemo(() => {
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const key = d.toISOString().slice(0, 10);
      return {
        date: d.toLocaleDateString(isAr ? "ar-EG" : "en-US", { weekday: "short" }),
        key,
        calls: calls.filter((c) => c.called_at?.slice(0, 10) === key).length,
        incoming: calls.filter((c) => c.called_at?.slice(0, 10) === key && c.call_type === "incoming").length,
        outgoing: calls.filter((c) => c.called_at?.slice(0, 10) === key && c.call_type === "outgoing").length,
      };
    });

    const outcomeMap = new Map<string, number>();
    calls.forEach((c) => {
      const k = c.outcome ?? "other";
      outcomeMap.set(k, (outcomeMap.get(k) ?? 0) + 1);
    });
    const outcomes = Array.from(outcomeMap.entries()).map(([name, value]) => ({ name, value }));

    const ratingDist = [1, 2, 3, 4, 5].map((n) => ({
      stars: `${n}★`,
      count: ratings.filter((r) => r.rating === n).length,
    }));

    const avgRating = ratings.length
      ? (ratings.reduce((s, r) => s + r.rating, 0) / ratings.length)
      : 0;

    const agentMap = new Map<string, { calls: number; ratings: number; avg: number }>();
    calls.forEach((c) => {
      const k = c.agent_email ?? "—";
      if (!agentMap.has(k)) agentMap.set(k, { calls: 0, ratings: 0, avg: 0 });
      agentMap.get(k)!.calls++;
    });
    ratings.forEach((r) => {
      const call = calls.find((c) => c.id === r.call_log_id);
      if (!call) return;
      const k = call.agent_email ?? "—";
      const a = agentMap.get(k);
      if (a) {
        a.avg = (a.avg * a.ratings + r.rating) / (a.ratings + 1);
        a.ratings++;
      }
    });
    const agents = Array.from(agentMap.entries()).map(([email, v]) => ({
      email, ...v, avg: Number(v.avg.toFixed(2)),
    })).sort((a, b) => b.calls - a.calls).slice(0, 10);

    return { last7Days, outcomes, ratingDist, avgRating, agents };
  }, [calls, ratings]);

  if (rl || !isManager) {
    return (
      <AppShell>
        <PageBlockSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-purple-500/10 p-2.5">
            <BarChart3 className="h-6 w-6 text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{isAr ? "تقارير مركز الاتصال" : "Call Center Reports"}</h1>
            <p className="text-sm text-muted-foreground">{isAr ? "تحليلات لحظية للمكالمات والتقييمات" : "Real-time analytics for calls and ratings"}</p>
          </div>
        </div>

        {loading ? (
          <CardsSkeleton count={4} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <KPI icon={<Phone className="h-4 w-4" />} label={isAr ? "إجمالي المكالمات" : "Total calls"} value={calls.length} />
              <KPI icon={<TrendingUp className="h-4 w-4" />} label={isAr ? "آخر 7 أيام" : "Last 7 days"} value={stats.last7Days.reduce((s, d) => s + d.calls, 0)} />
              <KPI icon={<Star className="h-4 w-4" />} label={isAr ? "متوسط التقييم" : "Avg rating"} value={stats.avgRating.toFixed(2)} suffix="★" />
              <KPI icon={<Star className="h-4 w-4" />} label={isAr ? "عدد التقييمات" : "Ratings count"} value={ratings.length} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold">{isAr ? "المكالمات — آخر 7 أيام" : "Calls — last 7 days"}</h2>
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={stats.last7Days}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="date" fontSize={12} />
                      <YAxis fontSize={12} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="incoming" name={isAr ? "واردة" : "Incoming"} fill="#10b981" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="outgoing" name={isAr ? "صادرة" : "Outgoing"} fill="#3b82f6" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold">{isAr ? "توزيع التقييمات" : "Rating distribution"}</h2>
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={stats.ratingDist}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="stars" fontSize={12} />
                      <YAxis fontSize={12} />
                      <Tooltip />
                      <Bar dataKey="count" name={isAr ? "عدد" : "Count"} fill="#d4a017" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold">{isAr ? "نتائج المكالمات" : "Call outcomes"}</h2>
                <div className="h-64">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={stats.outcomes}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label
                      >
                        {stats.outcomes.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold">{isAr ? "اتجاه المكالمات" : "Calls trend"}</h2>
                <div className="h-64">
                  <ResponsiveContainer>
                    <LineChart data={stats.last7Days}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="date" fontSize={12} />
                      <YAxis fontSize={12} />
                      <Tooltip />
                      <Line type="monotone" dataKey="calls" stroke="#d4a017" strokeWidth={2.5} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold">{isAr ? "أداء الموظفين (Top 10)" : "Agent performance (Top 10)"}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border/60 text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 text-start">{isAr ? "الموظف" : "Agent"}</th>
                      <th className="text-end">{isAr ? "المكالمات" : "Calls"}</th>
                      <th className="text-end">{isAr ? "التقييمات" : "Ratings"}</th>
                      <th className="text-end">{isAr ? "المتوسط" : "Average"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.agents.map((a) => (
                      <tr key={a.email} className="border-b border-border/30">
                        <td className="py-2 font-medium">{a.email}</td>
                        <td className="text-end tabular-nums">{a.calls}</td>
                        <td className="text-end tabular-nums">{a.ratings}</td>
                        <td className="text-end tabular-nums">
                          {a.avg > 0 ? `${a.avg} ★` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="p-5">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-semibold flex-1">{isAr ? "بحث في المكالمات" : "Search calls"}</h2>
                <div className="relative w-full sm:w-80">
                  <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={isAr ? "موبايل، رقم فاتورة، اسم، أو موظف…" : "Phone, invoice #, name, or agent…"}
                    className="ps-9"
                  />
                </div>
              </div>
              {(() => {
                const s = search.trim().toLowerCase();
                const digits = s.replace(/[^\d]/g, "");
                const norm = (x: string) => x.replace(/[^\d]/g, "");
                const filtered = !s ? calls.slice(0, 50) : calls.filter((c: any) =>
                  (c.customer_name ?? "").toLowerCase().includes(s) ||
                  (c.customer_phone ?? "").toLowerCase().includes(s) ||
                  (digits.length >= 3 && norm(c.customer_phone ?? "").includes(digits)) ||
                  (c.invoice_number ?? "").toLowerCase().includes(s) ||
                  (c.agent_email ?? "").toLowerCase().includes(s)
                ).slice(0, 100);
                if (filtered.length === 0) {
                  return <div className="py-8 text-center text-sm text-muted-foreground">{isAr ? "لا توجد نتائج" : "No results"}</div>;
                }
                return (
                  <div className="divide-y divide-border/60">
                    {filtered.map((c: any) => (
                      <div key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                        <div className={`rounded-md p-1.5 ${c.call_type === "incoming" ? "bg-emerald-500/10 text-emerald-600" : "bg-blue-500/10 text-blue-600"}`}>
                          {c.call_type === "incoming" ? <PhoneIncoming className="h-3.5 w-3.5" /> : <PhoneOutgoing className="h-3.5 w-3.5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{c.customer_name || c.customer_phone || "—"}</div>
                          <div className="text-[11px] text-muted-foreground truncate" dir="ltr">
                            {c.customer_phone ?? ""} · {c.agent_email ?? ""} · {new Date(c.called_at).toLocaleString(isAr ? "ar-EG" : "en-US")}
                          </div>
                        </div>
                        {c.invoice_id && c.invoice_number && (
                          <Link
                            to="/invoices/$id"
                            params={{ id: c.invoice_id }}
                            className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-mono font-semibold text-primary hover:bg-primary/20"
                          >
                            <FileText className="h-3 w-3" />
                            {c.invoice_number}
                            <ExternalLink className="h-2.5 w-2.5 opacity-70" />
                          </Link>
                        )}
                        {c.outcome && <Badge variant="outline" className="text-[10px]">{c.outcome}</Badge>}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </Card>
          </>
        )}

      </div>
    </AppShell>
  );
}

function KPI({ icon, label, value, suffix }: { icon: React.ReactNode; label: string; value: any; suffix?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">
        {value}{suffix && <span className="ms-1 text-base text-amber-500">{suffix}</span>}
      </div>
    </Card>
  );
}
