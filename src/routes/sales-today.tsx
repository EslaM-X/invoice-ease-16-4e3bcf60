import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtDate, fmtMoney } from "@/lib/utils-money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Calendar as CalendarIcon,
  Download,
  Package,
  ShoppingCart,
  TrendingDown,
  AlertTriangle,
  Boxes,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/sales-today")({
  head: () => ({
    meta: [
      { title: "حركة المبيعات اليومية | Daily Sales Movement" },
      { name: "description", content: "تقرير دقيق ولحظي لكل المنتجات التي تم بيعها أو نقصت من المخزون اليوم لإعداد طلبية الشراء." },
    ],
  }),
  component: () => (
    <AppShell>
      <SalesToday />
    </AppShell>
  ),
});

type LogRow = {
  id: string;
  product_id: string;
  change: number;
  reason: string | null;
  invoice_id: string | null;
  actor_email: string | null;
  created_at: string;
  products: {
    id: string;
    name: string;
    serial_number: string | null;
    color: string | null;
    price: number;
    stock_quantity: number;
    low_stock_threshold: number;
    image_url: string | null;
  } | null;
  invoices: { invoice_number: string | null; status: string | null } | null;
};

type Aggregated = {
  product_id: string;
  name: string;
  serial_number: string | null;
  color: string | null;
  price: number;
  current_stock: number;
  low_stock_threshold: number;
  image_url: string | null;
  sold_qty: number;       // net outflow (positive = sold)
  total_value: number;    // sold_qty * price
  invoices: Set<string>;
  last_at: string;
};

function todayBoundsISO() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function dateBoundsISO(yyyyMmDd: string) {
  const start = new Date(yyyyMmDd + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function SalesToday() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const [date, setDate] = useState<string>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  });
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { start, end } = dateBoundsISO(date);
    const { data, error } = await supabase
      .from("inventory_logs")
      .select(
        "id,product_id,change,reason,invoice_id,actor_email,created_at," +
          "products(id,name,serial_number,color,price,stock_quantity,low_stock_threshold,image_url)," +
          "invoices(invoice_number,status)"
      )
      .gte("created_at", start)
      .lt("created_at", end)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message);
    }
    setLogs((data ?? []) as unknown as LogRow[]);
    setLoading(false);
  };

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, date]);

  // Realtime: any inventory change anywhere reloads instantly across all 4 accounts
  useRealtimeTable("inventory_logs", () => {
    if (user) load();
  });
  useRealtimeTable("products", () => {
    if (user) load();
  });

  const { rows, totals } = useMemo(() => {
    const map = new Map<string, Aggregated>();
    for (const l of logs) {
      if (!l.products) continue;
      const p = l.products;
      const cur = map.get(p.id) ?? {
        product_id: p.id,
        name: p.name,
        serial_number: p.serial_number,
        color: p.color,
        price: Number(p.price ?? 0),
        current_stock: p.stock_quantity,
        low_stock_threshold: p.low_stock_threshold,
        image_url: p.image_url,
        sold_qty: 0,
        total_value: 0,
        invoices: new Set<string>(),
        last_at: l.created_at,
      };
      // change is negative for outflows (sale / edit-resale), positive for refunds
      // (void / delete / edit-revert). Net negative change == net sold quantity.
      cur.sold_qty += -l.change;
      if (l.invoices?.invoice_number) cur.invoices.add(l.invoices.invoice_number);
      if (l.created_at > cur.last_at) cur.last_at = l.created_at;
      map.set(p.id, cur);
    }
    const arr = Array.from(map.values())
      .filter((r) => r.sold_qty !== 0)
      .map((r) => ({ ...r, total_value: r.sold_qty * r.price }))
      .sort((a, b) => b.sold_qty - a.sold_qty);

    const t = arr.reduce(
      (acc, r) => {
        acc.units += r.sold_qty;
        acc.value += r.total_value;
        if (r.current_stock <= r.low_stock_threshold) acc.lowAfter += 1;
        return acc;
      },
      { units: 0, value: 0, lowAfter: 0 }
    );
    return { rows: arr, totals: { ...t, distinct: arr.length } };
  }, [logs]);

  const exportCSV = () => {
    const headers = [
      "product_name",
      "serial_number",
      "color",
      "unit_price_egp",
      "sold_qty",
      "total_value_egp",
      "current_stock",
      "low_stock_threshold",
      "invoices",
      "last_movement_at",
    ];
    const lines = rows.map((r) =>
      [
        r.name,
        r.serial_number ?? "",
        r.color ?? "",
        r.price.toFixed(2),
        r.sold_qty,
        r.total_value.toFixed(2),
        r.current_stock,
        r.low_stock_threshold,
        Array.from(r.invoices).join(" | "),
        r.last_at,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = "\uFEFF" + headers.join(",") + "\n" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isToday = date === new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {lang === "ar" ? "حركة المبيعات اليومية" : "Daily Sales Movement"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {lang === "ar"
              ? "كل المنتجات التي خرجت من المخزون اليوم — صافي البيع بعد الإلغاء والحذف والتعديل. لإعداد طلبيات الشراء بدقة."
              : "Every product that left stock today — net of voids, deletions, and edits. Use it to plan purchase orders."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <CalendarIcon className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="ps-8 w-40"
              max={new Date().toISOString().slice(0, 10)}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDate(new Date().toISOString().slice(0, 10))}
            disabled={isToday}
          >
            {lang === "ar" ? "اليوم" : "Today"}
          </Button>
          <Button size="sm" onClick={exportCSV} disabled={rows.length === 0}>
            <Download className="me-1.5 h-4 w-4" />
            {lang === "ar" ? "نسخة احتياطية CSV" : "Backup CSV"}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon={<ShoppingCart className="h-4 w-4 text-primary" />}
          label={lang === "ar" ? "إجمالي الوحدات المباعة" : "Total Units Sold"}
          value={String(totals.units)}
          tone="primary"
        />
        <SummaryCard
          icon={<Boxes className="h-4 w-4 text-primary" />}
          label={lang === "ar" ? "عدد المنتجات المختلفة" : "Distinct Products"}
          value={String(totals.distinct)}
        />
        <SummaryCard
          icon={<TrendingDown className="h-4 w-4 text-success" />}
          label={lang === "ar" ? "إجمالي قيمة المباع" : "Total Sold Value"}
          value={fmtMoney(totals.value, "EGP", lang)}
          tone="success"
        />
        <SummaryCard
          icon={<AlertTriangle className="h-4 w-4 text-warning-foreground" />}
          label={lang === "ar" ? "تحت الحد الأدنى الآن" : "Below Min After Today"}
          value={String(totals.lowAfter)}
          tone="warning"
        />
      </div>

      {/* Detailed table */}
      <div className="rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h3 className="font-semibold">
            {lang === "ar" ? "تفاصيل المنتجات المباعة" : "Sold Products Detail"}
          </h3>
          <span className="text-xs text-muted-foreground">
            {lang === "ar" ? "محدّث لحظياً" : "Updates live"} • {fmtDate(date, lang)}
          </span>
        </div>
        {loading ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            {lang === "ar" ? "جاري التحميل..." : "Loading..."}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <div className="text-sm text-muted-foreground">
              {lang === "ar"
                ? "لا توجد مبيعات في هذا اليوم بعد"
                : "No sales recorded for this date yet"}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-3 text-start font-medium">
                    {lang === "ar" ? "المنتج" : "Product"}
                  </th>
                  <th className="px-3 py-3 text-start font-medium">
                    {lang === "ar" ? "الرقم التسلسلي" : "Serial"}
                  </th>
                  <th className="px-3 py-3 text-start font-medium">
                    {lang === "ar" ? "اللون" : "Color"}
                  </th>
                  <th className="px-3 py-3 text-end font-medium">
                    {lang === "ar" ? "السعر" : "Price"}
                  </th>
                  <th className="px-3 py-3 text-end font-medium">
                    {lang === "ar" ? "الكمية المباعة" : "Sold Qty"}
                  </th>
                  <th className="px-3 py-3 text-end font-medium">
                    {lang === "ar" ? "إجمالي القيمة" : "Total"}
                  </th>
                  <th className="px-3 py-3 text-end font-medium">
                    {lang === "ar" ? "المخزون الحالي" : "Current Stock"}
                  </th>
                  <th className="px-3 py-3 text-start font-medium">
                    {lang === "ar" ? "الفواتير" : "Invoices"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => {
                  const low = r.current_stock <= r.low_stock_threshold;
                  const out = r.current_stock <= 0;
                  return (
                    <tr key={r.product_id} className="hover:bg-muted/30">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded border bg-muted">
                            {r.image_url ? (
                              <img src={r.image_url} alt={r.name} className="h-full w-full object-cover" />
                            ) : (
                              <Package className="h-full w-full p-2 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-semibold">{r.name}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {fmtDate(r.last_at, lang)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-muted-foreground">
                        {r.serial_number ?? "—"}
                      </td>
                      <td className="px-3 py-3">
                        {r.color ? (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full border"
                              style={{ background: r.color }}
                              aria-hidden
                            />
                            {r.color}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-end tabular-nums">
                        {fmtMoney(r.price, "EGP", lang)}
                      </td>
                      <td className="px-3 py-3 text-end">
                        <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 font-bold tabular-nums text-primary">
                          {r.sold_qty}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-end font-bold tabular-nums text-success">
                        {fmtMoney(r.total_value, "EGP", lang)}
                      </td>
                      <td className="px-3 py-3 text-end tabular-nums">
                        <span
                          className={`font-bold ${
                            out ? "text-destructive" : low ? "text-warning-foreground" : ""
                          }`}
                        >
                          {r.current_stock}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {" "}/ {r.low_stock_threshold}
                        </span>
                        {out && (
                          <span className="ms-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
                            {lang === "ar" ? "نفد" : "OUT"}
                          </span>
                        )}
                        {!out && low && (
                          <span className="ms-1 rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold text-warning-foreground">
                            {lang === "ar" ? "منخفض" : "LOW"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {Array.from(r.invoices).slice(0, 3).map((inv) => (
                            <span
                              key={inv}
                              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                            >
                              {inv}
                            </span>
                          ))}
                          {r.invoices.size > 3 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{r.invoices.size - 3}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-muted/40 font-semibold">
                <tr>
                  <td className="px-3 py-3" colSpan={4}>
                    {lang === "ar" ? "الإجمالي" : "Total"}
                  </td>
                  <td className="px-3 py-3 text-end tabular-nums">{totals.units}</td>
                  <td className="px-3 py-3 text-end tabular-nums text-success">
                    {fmtMoney(totals.value, "EGP", lang)}
                  </td>
                  <td className="px-3 py-3" colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {lang === "ar"
          ? "ملاحظة: الكميات محسوبة كصافي خروج (بيع - إرجاع). أي إلغاء أو حذف أو تعديل لفاتورة يُعكس فوراً ودقيقاً."
          : "Note: Quantities are net outflows (sales − refunds). Any invoice void, deletion, or edit is reflected instantly and accurately."}
      </p>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "primary" | "success" | "warning";
}) {
  const ring =
    tone === "primary"
      ? "border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5"
      : tone === "success"
      ? "border-success/30 bg-success/5"
      : tone === "warning"
      ? "border-warning/40 bg-warning/10"
      : "bg-card";
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${ring}`}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
