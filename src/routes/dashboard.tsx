import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { fmtMoney, fmtDate } from "@/lib/utils-money";
import { Users, Package, FileText, TrendingUp, AlertTriangle, Plus, ScanLine, Eye, EyeOff } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useRealtimeTable } from "@/lib/realtime";
import { ActivityFeed } from "@/components/activity-feed";
import { useHideNumbers } from "@/lib/use-hide-numbers";

export const Route = createFileRoute("/dashboard")({ component: DashboardPage });

function DashboardPage() {
  return <AppShell><Dashboard /></AppShell>;
}

function Dashboard() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const { hidden, toggle, mask } = useHideNumbers();
  const [stats, setStats] = useState({ sales: 0, invoices: 0, customers: 0, products: 0, lowStock: 0 });
  const [recent, setRecent] = useState<any[]>([]);
  const [top, setTop] = useState<any[]>([]);
  const navigate = useNavigate();

  const load = async () => {
    const [{ data: invs }, { count: cust }, { data: prods }, { data: items }] = await Promise.all([
      supabase.from("invoices").select("id, total, customer_name, created_at, invoice_number, status").neq("status", "voided").order("created_at", { ascending: false }).limit(50),
      supabase.from("customers").select("*", { count: "exact", head: true }),
      supabase.from("products").select("id, name, stock_quantity, low_stock_threshold"),
      supabase.from("invoice_items").select("product_name, quantity, line_total, invoices!inner(status)").neq("invoices.status", "voided"),
    ]);
    const sales = (invs ?? []).reduce((s: number, i: any) => s + Number(i.total ?? 0), 0);
    const lowStock = (prods ?? []).filter((p: any) => p.stock_quantity <= p.low_stock_threshold).length;
    setStats({
      sales,
      invoices: invs?.length ?? 0,
      customers: cust ?? 0,
      products: prods?.length ?? 0,
      lowStock,
    });
    setRecent((invs ?? []).slice(0, 5));
    const map = new Map<string, { name: string; qty: number; total: number }>();
    (items ?? []).forEach((it: any) => {
      const prev = map.get(it.product_name) ?? { name: it.product_name, qty: 0, total: 0 };
      prev.qty += Number(it.quantity ?? 0);
      prev.total += Number(it.line_total ?? 0);
      map.set(it.product_name, prev);
    });
    setTop([...map.values()].sort((a, b) => b.total - a.total).slice(0, 5));
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);
  useRealtimeTable("invoices", () => { if (user) load(); });
  useRealtimeTable("invoice_items", () => { if (user) load(); });
  useRealtimeTable("products", () => { if (user) load(); });
  useRealtimeTable("customers", () => { if (user) load(); });

  const cards = [
    { label: t("total_sales"), value: hidden ? "•••••" : fmtMoney(stats.sales, "EGP", lang), Icon: TrendingUp, accent: "text-success", sensitive: true },
    { label: t("total_invoices"), value: stats.invoices, Icon: FileText, accent: "text-primary", sensitive: false },
    { label: t("total_customers"), value: stats.customers, Icon: Users, accent: "text-primary", sensitive: false },
    { label: t("total_products"), value: stats.products, Icon: Package, accent: "text-primary", sensitive: false },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t("dashboard")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("welcome")}</p>
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
          <Button onClick={() => navigate({ to: "/invoices/new" })} className="gap-2 rounded-full px-5 shadow-glow">
            <Plus className="h-4 w-4" /> {t("new_invoice")}
          </Button>
        </div>
      </div>

      {stats.lowStock > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <span className="font-medium">{t("stock_low_alert")}: {stats.lowStock}</span>
          <Link to="/inventory" className="ms-auto text-xs font-semibold text-primary hover:underline">{t("view")} →</Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ label, value, Icon, accent }) => (
          <div key={label} className="group rounded-2xl border border-border/60 bg-card p-5 transition hover:shadow-md">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
              <div className={`flex h-7 w-7 items-center justify-center rounded-lg bg-accent ${accent}`}>
                <Icon className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-card p-6">
          <h3 className="mb-4 text-sm font-semibold tracking-tight">{t("recent_invoices")}</h3>
          {recent.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{t("no_data")}</div>
          ) : (
            <div className="-mx-2 divide-y divide-border/60">
              {recent.map((r) => (
                <Link key={r.id} to="/invoices/$id" params={{ id: r.id }} className="flex items-center justify-between rounded-lg px-2 py-3 transition hover:bg-accent/50">
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
        <div className="rounded-2xl border border-border/60 bg-card p-6">
          <h3 className="mb-4 text-sm font-semibold tracking-tight">{t("top_products")}</h3>
          {top.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{t("no_data")}</div>
          ) : (
            <div className="divide-y divide-border/60">
              {top.map((p) => (
                <div key={p.name} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">× {p.qty}</div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums">{fmtMoney(p.total, "EGP", lang)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ActivityFeed limit={10} />
    </div>
  );
}
