import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { fmtMoney, fmtDate } from "@/lib/utils-money";
import { Users, Package, FileText, TrendingUp, AlertTriangle, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dashboard")({ component: DashboardPage });

function DashboardPage() {
  return <AppShell><Dashboard /></AppShell>;
}

function Dashboard() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [stats, setStats] = useState({ sales: 0, invoices: 0, customers: 0, products: 0, lowStock: 0 });
  const [recent, setRecent] = useState<any[]>([]);
  const [top, setTop] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: invs }, { count: cust }, { data: prods }] = await Promise.all([
        supabase.from("invoices").select("id, total, customer_name, created_at, invoice_number").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
        supabase.from("customers").select("*", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("products").select("id, name, stock_quantity, low_stock_threshold").eq("user_id", user.id),
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
      // top products by line_total
      const { data: items } = await supabase
        .from("invoice_items")
        .select("product_name, quantity, line_total, invoice_id, invoices!inner(user_id)")
        .eq("invoices.user_id", user.id);
      const map = new Map<string, { name: string; qty: number; total: number }>();
      (items ?? []).forEach((it: any) => {
        const prev = map.get(it.product_name) ?? { name: it.product_name, qty: 0, total: 0 };
        prev.qty += Number(it.quantity ?? 0);
        prev.total += Number(it.line_total ?? 0);
        map.set(it.product_name, prev);
      });
      setTop([...map.values()].sort((a, b) => b.total - a.total).slice(0, 5));
    })();
  }, [user]);

  const cards = [
    { label: t("total_sales"), value: fmtMoney(stats.sales, "SAR", lang), Icon: TrendingUp, accent: "text-success" },
    { label: t("total_invoices"), value: stats.invoices, Icon: FileText, accent: "text-primary" },
    { label: t("total_customers"), value: stats.customers, Icon: Users, accent: "text-primary" },
    { label: t("total_products"), value: stats.products, Icon: Package, accent: "text-primary" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("dashboard")}</h1>
          <p className="text-sm text-muted-foreground">{t("welcome")}</p>
        </div>
        <Button onClick={() => navigate({ to: "/invoices/new" })} className="gap-2 shadow-glow">
          <Plus className="h-4 w-4" /> {t("new_invoice")}
        </Button>
      </div>

      {stats.lowStock > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-warning-foreground" />
          <span>{t("stock_low_alert")}: {stats.lowStock}</span>
          <Link to="/inventory" className="ms-auto font-medium underline">{t("view")}</Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ label, value, Icon, accent }) => (
          <div key={label} className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">{label}</div>
              <Icon className={`h-4 w-4 ${accent}`} />
            </div>
            <div className="mt-2 text-2xl font-bold">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <h3 className="mb-4 font-semibold">{t("recent_invoices")}</h3>
          {recent.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t("no_data")}</div>
          ) : (
            <div className="divide-y">
              {recent.map((r) => (
                <Link key={r.id} to="/invoices/$id" params={{ id: r.id }} className="flex items-center justify-between py-3 hover:bg-muted/50 -mx-2 px-2 rounded">
                  <div>
                    <div className="font-medium">{r.invoice_number}</div>
                    <div className="text-xs text-muted-foreground">{r.customer_name || "—"} · {fmtDate(r.created_at, lang)}</div>
                  </div>
                  <div className="font-semibold">{fmtMoney(Number(r.total), "SAR", lang)}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <h3 className="mb-4 font-semibold">{t("top_products")}</h3>
          {top.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t("no_data")}</div>
          ) : (
            <div className="divide-y">
              {top.map((p) => (
                <div key={p.name} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">× {p.qty}</div>
                  </div>
                  <div className="font-semibold">{fmtMoney(p.total, "SAR", lang)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
