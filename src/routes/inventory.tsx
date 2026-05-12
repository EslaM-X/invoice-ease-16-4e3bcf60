import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { Product } from "@/lib/data";
import { AlertTriangle, Boxes, ShoppingCart, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { fmtDate, fmtMoney } from "@/lib/utils-money";
import { useRealtimeTable } from "@/lib/realtime";
import { CardsSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { RestockOrderDialog } from "@/components/restock-order-dialog";

export const Route = createFileRoute("/inventory")({ component: () => <AppShell><Inventory /></AppShell> });

function Inventory() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderInitialId, setOrderInitialId] = useState<string | null>(null);

  const load = async () => {
    const [{ data: p }, { data: l }] = await Promise.all([
      supabase.from("products").select("*").order("name"),
      supabase.from("inventory_logs").select("*, products(name, serial_number, color, image_url, collection, price)").order("created_at", { ascending: false }).limit(30),
    ]);
    setProducts((p ?? []) as Product[]);
    setLogs(l ?? []);
    setLoading(false);
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
      <h1 className="text-2xl font-bold tracking-tight text-gradient-gold">{t("inventory")}</h1>

      {loading ? <CardsSkeleton count={4} /> : (
      <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card-premium rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-muted-foreground">{lang === "ar" ? "إجمالي قيمة المخزون" : "Total Stock Value"}</div>
            <Wallet className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-primary">{fmtMoney(totalStockValue, "EGP", lang)}</div>
          <div className="mt-1 text-xs text-muted-foreground">{lang === "ar" ? "السعر × الكمية لكل المنتجات" : "Price × Qty for all products"}</div>
        </div>

        <div className="card-premium rounded-2xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{t("in_stock")}</div>
            <Boxes className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 text-2xl font-bold">{totalUnits}</div>
        </div>
        <div className="card-premium rounded-2xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{t("low_stock")}</div>
            <AlertTriangle className="h-4 w-4 text-warning-foreground" />
          </div>
          <div className="mt-2 text-2xl font-bold">{lowStock.length}</div>
        </div>
        <div className="card-premium rounded-2xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{t("total_products")}</div>
            <Boxes className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 text-2xl font-bold">{products.length}</div>
        </div>
      </div>
      )}

      {topValued.length > 0 && (
        <div className="card-premium rounded-2xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">{lang === "ar" ? "أعلى المنتجات قيمة في المخزون" : "Top Valued Products in Stock"}</h3>
            <span className="text-xs text-muted-foreground">{lang === "ar" ? "السعر × الكمية" : "Price × Qty"}</span>
          </div>
          <div className="space-y-2">
            {topValued.map((p) => {
              const pct = totalStockValue > 0 ? (p.value / totalStockValue) * 100 : 0;
              return (
                <div key={p.id} className="rounded-lg border bg-background/50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        {p.serial_number && (
                          <span className="font-mono">
                            {lang === "ar" ? "ت: " : "S/N: "}{p.serial_number}
                          </span>
                        )}
                        {p.color && (
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full border"
                              style={{ background: p.color }}
                              aria-hidden
                            />
                            {p.color}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {fmtMoney(Number(p.price ?? 0), "EGP", lang)} × {p.stock_quantity}
                      </div>
                    </div>
                    <div className="text-end">
                      <div className="text-sm font-bold tabular-nums text-primary">{fmtMoney(p.value, "EGP", lang)}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">{pct.toFixed(1)}%</div>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}


      {lowStock.length > 0 && (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            {t("stock_low_alert")}
            <span className="rounded-full bg-warning/30 px-2 py-0.5 text-xs font-bold">
              {lowStock.length}
            </span>
            <Button
              size="sm"
              className="ms-auto"
              onClick={() => { setOrderInitialId(null); setOrderOpen(true); }}
            >
              <ShoppingCart className="me-1 h-4 w-4" />
              {lang === "ar" ? "إنشاء طلب لكل المنتجات" : "Create order for all"}
            </Button>
          </div>
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto pe-1 sm:grid-cols-2 lg:grid-cols-3">
            {lowStock.map((p) => {
              const isOut = p.stock_quantity <= 0;
              return (
                <div
                  key={p.id}
                  className={`flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm shadow-sm ${
                    isOut ? "border-destructive/50" : "border-warning/40"
                  }`}
                >
                  <div className="flex gap-3">
                    <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border bg-muted">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                      ) : (
                        <Boxes className="h-full w-full p-3 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 truncate font-semibold">{p.name}</div>
                        {isOut && (
                          <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
                            {lang === "ar" ? "نفد" : "OUT"}
                          </span>
                        )}
                      </div>
                      {p.serial_number && (
                        <div className="truncate font-mono text-[11px] text-muted-foreground">
                          {lang === "ar" ? "ت: " : "S/N: "}{p.serial_number}
                        </div>
                      )}
                      {p.color && (
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full border"
                            style={{ background: p.color }}
                            aria-hidden
                          />
                          {lang === "ar" ? "اللون: " : "Color: "}{p.color}
                        </div>
                      )}
                      <div className="flex items-baseline gap-1 pt-0.5">
                        <span
                          className={`text-lg font-bold tabular-nums ${
                            isOut ? "text-destructive" : "text-warning-foreground"
                          }`}
                        >
                          {p.stock_quantity}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          / {p.low_stock_threshold} {lang === "ar" ? "حد أدنى" : "min"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => { setOrderInitialId(p.id); setOrderOpen(true); }}
                  >
                    <ShoppingCart className="me-1 h-3.5 w-3.5" />
                    {lang === "ar" ? "طلبية" : "Order"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <RestockOrderDialog
        open={orderOpen}
        onOpenChange={setOrderOpen}
        products={lowStock}
        initialProductId={orderInitialId}
      />


      <div className="card-premium rounded-2xl border bg-card p-5">
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
                  <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "السيريال" : "S/N"}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "اللون" : "Color"}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "الكولكشن" : "Collection"}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("change")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("reason")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((l) => {
                  const p = l.products;
                  return (
                    <tr key={l.id}>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(l.created_at, lang)}</td>
                      <td className="px-3 py-2 font-medium">
                        <div className="flex items-center gap-2">
                          {p?.image_url ? (
                            <img src={p.image_url} alt={p.name} className="h-8 w-8 rounded border object-cover" />
                          ) : (
                            <div className="h-8 w-8 rounded border bg-muted" />
                          )}
                          <span className="truncate">{p?.name ?? "—"}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p?.serial_number || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {p?.color ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="inline-block h-2.5 w-2.5 rounded-full border" style={{ background: p.color }} aria-hidden />
                            {p.color}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{p?.collection || "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 font-semibold ${l.change < 0 ? "text-destructive" : "text-success"}`}>
                          {l.change < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                          {l.change > 0 ? `+${l.change}` : l.change}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{l.reason || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
