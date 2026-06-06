import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { fmtMoney, fmtDate } from "@/lib/utils-money";
import { Users, FileText, TrendingUp, AlertTriangle, Plus, ScanLine, Eye, EyeOff, CheckCircle2, Truck, Clock } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useRealtimeTable } from "@/lib/realtime";
import { ActivityFeed } from "@/components/activity-feed";
import { useHideNumbers } from "@/lib/use-hide-numbers";
import { IncomingShipmentsStrip } from "@/components/incoming-shipments-strip";
import { SalesOverview } from "@/components/sales-overview";
import { TopProductsInteractive } from "@/components/top-products-interactive";
import { cachedListFetch } from "@/lib/list-cache";

export const Route = createFileRoute("/dashboard")({ component: DashboardPage });

function DashboardPage() {
  return <AppShell><Dashboard /></AppShell>;
}

function Dashboard() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const { hidden, toggle } = useHideNumbers();
  const [stats, setStats] = useState({ sales: 0, invoices: 0, closed: 0, partial: 0, open: 0, customers: 0, products: 0, lowStock: 0 });
  const [recent, setRecent] = useState<any[]>([]);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  const load = async (forceRefresh = false) => {
    const [{ data: invs }, { count: cust }, productsResult] = await Promise.all([
      supabase.from("invoices")
        .select("id, total, paid_amount, delivery_status, customer_name, created_at, invoice_number, status")
        .not("status", "in", "(voided,draft)")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("customers").select("*", { count: "exact", head: true }),
      cachedListFetch(
        "dashboard:product-stock",
        async () => {
          const { data } = await supabase.from("products").select("stock_quantity, low_stock_threshold");
          return (data as any[]) ?? [];
        },
        { ttl: 60_000, forceRefresh },
      ),
    ]);
    const prods = productsResult.data;

    const sales = (invs ?? []).reduce((s: number, i: any) => s + Number(i.total ?? 0), 0);
    const lowStock = (prods ?? []).filter((p: any) => p.stock_quantity <= p.low_stock_threshold).length;
    
    let closed = 0, partial = 0, open = 0;
    (invs ?? []).forEach((i: any) => {
      const total = Number(i.total ?? 0);
      const paid = Number(i.paid_amount ?? 0);
      const fullyPaid = total > 0 && paid >= total - 0.001;
      if (fullyPaid && i.delivery_status === "delivered") closed++;
      else if (i.delivery_status === "partial") partial++;
      else open++;
    });

    setStats({
      sales,
      invoices: invs?.length ?? 0,
      closed,
      partial,
      open,
      customers: cust ?? 0,
      products: prods?.length ?? 0,
      lowStock,
    });
    setRecent((invs ?? []).slice(0, 5));
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);
  useEffect(() => () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
  }, []);

  const scheduleRealtimeRefresh = () => {
    if (!user) return;
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      void load(true);
    }, 300);
  };

  useRealtimeTable("invoices", scheduleRealtimeRefresh, [user?.id]);
  useRealtimeTable("products", scheduleRealtimeRefresh, [user?.id]);
  useRealtimeTable("customers", scheduleRealtimeRefresh, [user?.id]);

  const cards = [
    { label: t("total_sales"), value: hidden ? "•••••" : fmtMoney(stats.sales, "EGP", lang), Icon: TrendingUp, sensitive: true },
    { label: t("total_invoices"), value: stats.invoices, Icon: FileText, sensitive: false },
    { label: t("closed_invoices"), value: stats.closed, Icon: CheckCircle2, sensitive: false, accent: "text-emerald-700 dark:text-emerald-400" },
    { label: t("partial_delivery_invoices"), value: stats.partial, Icon: Truck, sensitive: false, accent: "text-amber-700 dark:text-amber-400" },
    { label: t("open_invoices"), value: stats.open, Icon: Clock, sensitive: false, accent: "text-sky-700 dark:text-sky-400" },
    { label: t("total_customers"), value: stats.customers, Icon: Users, sensitive: false },
  ];

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-border pb-6">
        <div>
          <div className="eyebrow mb-3">{t("welcome")}</div>
          <h1 className="display-xl text-foreground">{t("dashboard")}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={toggle}
            className="rounded-full"
            title={hidden ? "إظهار الأرقام" : "إخفاء الأرقام"}
          >
            {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const isPhone = typeof window !== "undefined" && window.innerWidth < 768;
              if (isPhone) navigate({ to: "/scan-and-sell" });
              else navigate({ to: "/invoices/new", search: { scan: true } });
            }}
            className="gap-2 rounded-full px-5"
          >
            <ScanLine className="h-4 w-4" /> {t("scan_and_sell")}
          </Button>
          <Button onClick={() => navigate({ to: "/invoices/new" })} className="gap-2 rounded-full px-5 press-spring">
            <Plus className="h-4 w-4" /> {t("new_invoice")}
          </Button>
        </div>
      </header>

      {stats.lowStock > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-foreground/15 bg-muted/40 px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4" />
          <span className="font-medium">{t("stock_low_alert")}: {stats.lowStock}</span>
          <Link to="/inventory" className="ms-auto text-xs font-semibold underline-offset-4 hover:underline">{t("view")} →</Link>
        </div>
      )}

      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ label, value, Icon, accent }) => (
          <div key={label} className="ios-card group relative p-4 sm:p-6 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="eyebrow">{label}</div>
              <div className={`flex h-9 w-9 items-center justify-center rounded-full bg-muted/60 ${accent ?? "text-muted-foreground group-hover:text-foreground"} transition-colors`}>
                <Icon className="h-4 w-4" />
              </div>
            </div>
            <div className={`ltr-nums mt-5 font-display text-2xl font-medium tracking-tight tabular-nums sm:text-3xl break-words ${accent ?? "text-foreground"}`}>{value}</div>
          </div>
        ))}
      </div>

      <IncomingShipmentsStrip />

      <SalesOverview />

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="ios-card p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="eyebrow">{t("recent_invoices")}</h3>
            <div className="h-px flex-1 mx-4 bg-border" />
          </div>
          {recent.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{t("no_data")}</div>
          ) : (
            <div className="divide-y divide-border">
              {recent.map((r) => (
                <Link key={r.id} to="/invoices/$id" params={{ id: r.id }} className="flex items-center justify-between py-3 transition hover:opacity-70">
                  <div>
                    <div className="text-sm font-medium">{r.invoice_number}</div>
                    <div className="text-xs text-muted-foreground">{r.customer_name || "—"} · {fmtDate(r.created_at, lang)}</div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums">{fmtMoney(Number(r.total), "EGP", lang)}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
        <TopProductsInteractive rangeDays={30} limit={8} />
      </div>

      <ActivityFeed limit={10} />
    </div>
  );
}
