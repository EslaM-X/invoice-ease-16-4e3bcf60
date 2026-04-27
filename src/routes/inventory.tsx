import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { Product } from "@/lib/data";
import { AlertTriangle, Boxes, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { fmtDate, fmtMoney } from "@/lib/utils-money";
import { useRealtimeTable } from "@/lib/realtime";

export const Route = createFileRoute("/inventory")({ component: () => <AppShell><Inventory /></AppShell> });

function Inventory() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [logs, setLogs] = useState<any[]>([]);

  const load = async () => {
    // Fetch products + latest inventory_logs in parallel. products.stock_quantity is the
    // authoritative reconciled value (every inventory_log mutates it inside the same SQL
    // transaction), so price × stock_quantity equals the true current stock value.
    const [{ data: p }, { data: l }] = await Promise.all([
      supabase.from("products").select("*").order("name"),
      supabase.from("inventory_logs").select("*, products(name)").order("created_at", { ascending: false }).limit(30),
    ]);
    setProducts((p ?? []) as Product[]);
    setLogs(l ?? []);
  };
  useEffect(() => { if (user) load(); }, [user]);
  useRealtimeTable("products", () => { if (user) load(); });
  useRealtimeTable("inventory_logs", () => { if (user) load(); });
  useRealtimeTable("invoices", () => { if (user) load(); });
  useRealtimeTable("invoice_items", () => { if (user) load(); });

  const lowStock = products.filter((p) => p.stock_quantity <= p.low_stock_threshold);
  const totalUnits = products.reduce((s, p) => s + p.stock_quantity, 0);
  const valued = products
    .map((p) => ({ ...p, value: Number(p.price ?? 0) * Number(p.stock_quantity ?? 0) }))
    .sort((a, b) => b.value - a.value);
  const totalStockValue = valued.reduce((s, p) => s + p.value, 0);
  const topValued = valued.filter((p) => p.value > 0).slice(0, 8);


  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("inventory")}</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-muted-foreground">{lang === "ar" ? "إجمالي قيمة المخزون" : "Total Stock Value"}</div>
            <Wallet className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-primary">{fmtMoney(totalStockValue, "EGP", lang)}</div>
          <div className="mt-1 text-xs text-muted-foreground">{lang === "ar" ? "السعر × الكمية لكل المنتجات" : "Price × Qty for all products"}</div>
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{t("in_stock")}</div>
            <Boxes className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 text-2xl font-bold">{totalUnits}</div>
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{t("low_stock")}</div>
            <AlertTriangle className="h-4 w-4 text-warning-foreground" />
          </div>
          <div className="mt-2 text-2xl font-bold">{lowStock.length}</div>
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{t("total_products")}</div>
            <Boxes className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 text-2xl font-bold">{products.length}</div>
        </div>
      </div>

      {lowStock.length > 0 && (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-5">
          <div className="mb-3 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{t("stock_low_alert")}</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {lowStock.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border bg-card p-3 text-sm">
                <span className="font-medium">{p.name}</span>
                <span className="font-bold text-warning-foreground">{p.stock_quantity}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="mb-4 font-semibold">{t("inventory_log")}</h3>
        {logs.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{t("no_data")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t("date")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("product_name")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("change")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("reason")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 text-muted-foreground">{fmtDate(l.created_at, lang)}</td>
                    <td className="px-3 py-2 font-medium">{l.products?.name ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 font-semibold ${l.change < 0 ? "text-destructive" : "text-success"}`}>
                        {l.change < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                        {l.change > 0 ? `+${l.change}` : l.change}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{l.reason || "—"}</td>
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
