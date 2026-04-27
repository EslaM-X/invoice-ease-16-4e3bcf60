import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Wrench,
  RotateCcw,
  Trash2,
  Pencil,
  ClipboardList,
  X,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/sales-today")({
  head: () => ({
    meta: [
      { title: "حركة المبيعات اليومية | Daily Sales Movement" },
      { name: "description", content: "تقرير دقيق ولحظي لكل حركات المخزون اليوم: بيع، إلغاء، حذف، تعديل، تصحيح يدوي." },
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
  sold_qty: number;
  total_value: number;
  invoices: Set<string>;
  last_at: string;
  movements: LogRow[];
};

type MovementKind = "sale" | "void" | "delete" | "edit-resale" | "edit-revert" | "manual" | "other";

function classifyReason(reason: string | null): { kind: MovementKind; cleanReason: string } {
  if (!reason) return { kind: "other", cleanReason: "" };
  const r = reason.toLowerCase();
  if (r.startsWith("sale ")) return { kind: "sale", cleanReason: reason };
  if (r.startsWith("void ")) return { kind: "void", cleanReason: reason };
  if (r.startsWith("delete ")) return { kind: "delete", cleanReason: reason };
  if (r.startsWith("edit-resale ")) return { kind: "edit-resale", cleanReason: reason };
  if (r.startsWith("edit-revert ")) return { kind: "edit-revert", cleanReason: reason };
  if (r.startsWith("manual:")) return { kind: "manual", cleanReason: reason.slice(7).trim() };
  return { kind: "other", cleanReason: reason };
}

function dateBoundsISO(yyyyMmDd: string) {
  const start = new Date(yyyyMmDd + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

const PAGE_SIZE = 25;

function SalesToday() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [poOpen, setPoOpen] = useState(false);

  // Debounce realtime reloads to avoid thrashing under bursts of changes
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingRef = useRef(false);

  const load = async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
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
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) toast.error(error.message);
    setLogs((data ?? []) as unknown as LogRow[]);
    setLoading(false);
    isLoadingRef.current = false;
  };

  const debouncedLoad = () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => load(), 600);
  };

  useEffect(() => {
    if (user) load();
    setPage(0);
    setExpanded(new Set());
    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, date]);

  // Realtime — debounced. Only reload when changes are within the viewing day.
  useRealtimeTable("inventory_logs", (payload) => {
    const ts = (payload.new?.created_at ?? payload.old?.created_at) as string | undefined;
    if (!ts) return debouncedLoad();
    const { start, end } = dateBoundsISO(date);
    if (ts >= start && ts < end) debouncedLoad();
  });
  useRealtimeTable("products", () => debouncedLoad());

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
        movements: [],
      };
      cur.sold_qty += -l.change;
      if (l.invoices?.invoice_number) cur.invoices.add(l.invoices.invoice_number);
      if (l.created_at > cur.last_at) cur.last_at = l.created_at;
      cur.movements.push(l);
      map.set(p.id, cur);
    }
    const arr = Array.from(map.values())
      .filter((r) => r.sold_qty !== 0 || r.movements.length > 0)
      .map((r) => ({ ...r, total_value: r.sold_qty * r.price }))
      .sort((a, b) => Math.abs(b.sold_qty) - Math.abs(a.sold_qty));

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

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  // Purchase Order rows: only items actually sold (positive net), sorted by urgency
  const poRows = useMemo(() => {
    return rows
      .filter((r) => r.sold_qty > 0)
      .map((r) => {
        const deficit = Math.max(0, r.low_stock_threshold - r.current_stock);
        // Suggested reorder = today's sold qty + deficit to refill safety stock
        const suggested = r.sold_qty + deficit;
        return { ...r, deficit, suggested };
      })
      .sort((a, b) => {
        // urgency: out of stock first, then below min, then by sold qty
        const aUrg = a.current_stock <= 0 ? 2 : a.current_stock <= a.low_stock_threshold ? 1 : 0;
        const bUrg = b.current_stock <= 0 ? 2 : b.current_stock <= b.low_stock_threshold ? 1 : 0;
        if (aUrg !== bUrg) return bUrg - aUrg;
        return b.sold_qty - a.sold_qty;
      });
  }, [rows]);

  const poTotals = useMemo(() => {
    return poRows.reduce(
      (acc, r) => {
        acc.units += r.sold_qty;
        acc.suggested += r.suggested;
        acc.distinct += 1;
        return acc;
      },
      { units: 0, suggested: 0, distinct: 0 }
    );
  }, [poRows]);

  const exportPurchaseOrderCSV = () => {
    const headers = [
      "product_name","serial_number","color","unit_price_egp",
      "sold_today_qty","current_stock","low_stock_threshold","stock_deficit","suggested_order_qty",
    ];
    const lines = poRows.map((r) =>
      [
        r.name, r.serial_number ?? "", r.color ?? "",
        r.price.toFixed(2), r.sold_qty, r.current_stock, r.low_stock_threshold, r.deficit, r.suggested,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    );
    const csv = "\uFEFF" + headers.join(",") + "\n" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchase-order-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };


  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportCSV = () => {
    const headers = [
      "product_name","serial_number","color","unit_price_egp",
      "net_qty","total_value_egp","current_stock","low_stock_threshold",
      "movements_count","invoices","last_movement_at",
    ];
    const lines = rows.map((r) =>
      [
        r.name, r.serial_number ?? "", r.color ?? "",
        r.price.toFixed(2), r.sold_qty, r.total_value.toFixed(2),
        r.current_stock, r.low_stock_threshold, r.movements.length,
        Array.from(r.invoices).join(" | "), r.last_at,
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

  const exportMovementsCSV = () => {
    const headers = ["timestamp","product_name","serial","color","change","kind","reason","invoice","actor_email"];
    const lines: string[] = [];
    for (const r of rows) {
      for (const m of r.movements) {
        const { kind, cleanReason } = classifyReason(m.reason);
        lines.push(
          [
            m.created_at, r.name, r.serial_number ?? "", r.color ?? "",
            m.change, kind, cleanReason, m.invoices?.invoice_number ?? "", m.actor_email ?? "",
          ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
        );
      }
    }
    const csv = "\uFEFF" + headers.join(",") + "\n" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `movements-${date}.csv`;
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
              ? "كل المنتجات التي تحركت في المخزون اليوم — صافي البيع بعد الإلغاء/الحذف/التعديل، مع تفصيل كل حركة وسببها."
              : "All products that moved today — net of voids/deletes/edits, with every movement detailed by reason."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <Button size="sm" variant="outline" onClick={exportCSV} disabled={rows.length === 0}>
            <Download className="me-1.5 h-4 w-4" />
            {lang === "ar" ? "ملخص CSV" : "Summary CSV"}
          </Button>
          <Button size="sm" variant="outline" onClick={exportMovementsCSV} disabled={rows.length === 0}>
            <Download className="me-1.5 h-4 w-4" />
            {lang === "ar" ? "كل الحركات CSV" : "All movements CSV"}
          </Button>
          <Button
            size="sm"
            onClick={() => setPoOpen(true)}
            disabled={poRows.length === 0}
            className="bg-gradient-to-r from-primary to-primary/80 shadow-md"
          >
            <ClipboardList className="me-1.5 h-4 w-4" />
            {lang === "ar"
              ? `إجمالي المباع (${poTotals.distinct})`
              : `Total Sold (${poTotals.distinct})`}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon={<ShoppingCart className="h-4 w-4 text-primary" />}
          label={lang === "ar" ? "صافي الوحدات المباعة" : "Net Units Sold"}
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
          label={lang === "ar" ? "صافي قيمة المباع" : "Net Sold Value"}
          value={fmtMoney(totals.value, "EGP", lang)}
          tone="success"
        />
        <SummaryCard
          icon={<AlertTriangle className="h-4 w-4 text-warning-foreground" />}
          label={lang === "ar" ? "تحت الحد الأدنى الآن" : "Below Min Now"}
          value={String(totals.lowAfter)}
          tone="warning"
        />
      </div>

      <div className="rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
          <h3 className="font-semibold">
            {lang === "ar" ? "تفاصيل المنتجات والحركات" : "Products & Movements Detail"}
          </h3>
          <span className="text-xs text-muted-foreground">
            {lang === "ar" ? "محدّث لحظياً" : "Updates live"} • {fmtDate(date, lang)}
          </span>
        </div>

        {loading && rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            {lang === "ar" ? "جاري التحميل..." : "Loading..."}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <div className="text-sm text-muted-foreground">
              {lang === "ar" ? "لا توجد حركات في هذا اليوم بعد" : "No movements recorded for this date yet"}
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[920px]">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="w-8 px-2 py-3" />
                    <th className="px-3 py-3 text-start font-medium">{lang === "ar" ? "المنتج" : "Product"}</th>
                    <th className="px-3 py-3 text-start font-medium">{lang === "ar" ? "تسلسلي" : "Serial"}</th>
                    <th className="px-3 py-3 text-start font-medium">{lang === "ar" ? "اللون" : "Color"}</th>
                    <th className="px-3 py-3 text-end font-medium">{lang === "ar" ? "السعر" : "Price"}</th>
                    <th className="px-3 py-3 text-end font-medium">{lang === "ar" ? "صافي" : "Net"}</th>
                    <th className="px-3 py-3 text-end font-medium">{lang === "ar" ? "القيمة" : "Value"}</th>
                    <th className="px-3 py-3 text-end font-medium">{lang === "ar" ? "المخزون" : "Stock"}</th>
                    <th className="px-3 py-3 text-end font-medium">{lang === "ar" ? "حركات" : "Moves"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pageRows.map((r) => {
                    const low = r.current_stock <= r.low_stock_threshold;
                    const out = r.current_stock <= 0;
                    const isExpanded = expanded.has(r.product_id);
                    return (
                      <>
                        <tr
                          key={r.product_id}
                          className="cursor-pointer hover:bg-muted/30"
                          onClick={() => toggleExpand(r.product_id)}
                        >
                          <td className="px-2 py-3 text-muted-foreground">
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </td>
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
                                <div className="text-[11px] text-muted-foreground">{fmtDate(r.last_at, lang)}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 font-mono text-[11px] text-muted-foreground">
                            {r.serial_number ?? "—"}
                          </td>
                          <td className="px-3 py-3">
                            {r.color ? (
                              <span className="inline-flex items-center gap-1.5 text-xs">
                                <span className="inline-block h-2.5 w-2.5 rounded-full border" style={{ background: r.color }} aria-hidden />
                                {r.color}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-end tabular-nums">{fmtMoney(r.price, "EGP", lang)}</td>
                          <td className="px-3 py-3 text-end">
                            <span
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-bold tabular-nums ${
                                r.sold_qty > 0
                                  ? "bg-primary/10 text-primary"
                                  : r.sold_qty < 0
                                  ? "bg-success/15 text-success"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {r.sold_qty > 0 ? `+${r.sold_qty}` : r.sold_qty}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-end font-bold tabular-nums text-success">
                            {fmtMoney(r.total_value, "EGP", lang)}
                          </td>
                          <td className="px-3 py-3 text-end tabular-nums">
                            <span className={`font-bold ${out ? "text-destructive" : low ? "text-warning-foreground" : ""}`}>
                              {r.current_stock}
                            </span>
                            <span className="text-[11px] text-muted-foreground"> / {r.low_stock_threshold}</span>
                            {out && <span className="ms-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold text-destructive">{lang === "ar" ? "نفد" : "OUT"}</span>}
                            {!out && low && <span className="ms-1 rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold text-warning-foreground">{lang === "ar" ? "منخفض" : "LOW"}</span>}
                          </td>
                          <td className="px-3 py-3 text-end font-mono text-xs text-muted-foreground">{r.movements.length}</td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-muted/20">
                            <td />
                            <td colSpan={8} className="px-3 py-3">
                              <MovementsTable movements={r.movements} lang={lang} />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t px-5 py-3 text-sm">
                <div className="text-muted-foreground">
                  {lang === "ar"
                    ? `صفحة ${page + 1} من ${totalPages} • ${rows.length} منتج`
                    : `Page ${page + 1} of ${totalPages} • ${rows.length} products`}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {lang === "ar"
          ? "ملاحظة: «صافي» = البيع − الإرجاع. أي إلغاء/حذف/تعديل لفاتورة أو تصحيح يدوي يظهر داخل تفاصيل المنتج بسببه واسم من قام به."
          : "Note: «Net» = sales − refunds. Every void/delete/edit and manual adjustment is shown inside product details with its reason and actor."}
      </p>
    </div>
  );
}

function MovementsTable({ movements, lang }: { movements: LogRow[]; lang: "ar" | "en" }) {
  const sorted = [...movements].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <table className="w-full text-xs">
        <thead className="bg-muted/40">
          <tr>
            <th className="px-2 py-2 text-start font-medium">{lang === "ar" ? "الوقت" : "Time"}</th>
            <th className="px-2 py-2 text-start font-medium">{lang === "ar" ? "نوع الحركة" : "Type"}</th>
            <th className="px-2 py-2 text-end font-medium">{lang === "ar" ? "التغيير" : "Change"}</th>
            <th className="px-2 py-2 text-start font-medium">{lang === "ar" ? "السبب / الفاتورة" : "Reason / Invoice"}</th>
            <th className="px-2 py-2 text-start font-medium">{lang === "ar" ? "بواسطة" : "By"}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sorted.map((m) => {
            const { kind, cleanReason } = classifyReason(m.reason);
            const meta = kindMeta(kind, lang);
            const time = new Date(m.created_at).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US", {
              hour: "2-digit", minute: "2-digit", second: "2-digit",
            });
            return (
              <tr key={m.id}>
                <td className="px-2 py-2 font-mono text-muted-foreground">{time}</td>
                <td className="px-2 py-2">
                  <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${meta.cls}`}>
                    {meta.icon} {meta.label}
                  </span>
                </td>
                <td className="px-2 py-2 text-end font-bold tabular-nums">
                  <span className={m.change < 0 ? "text-destructive" : "text-success"}>
                    {m.change > 0 ? `+${m.change}` : m.change}
                  </span>
                </td>
                <td className="px-2 py-2">
                  {m.invoices?.invoice_number ? (
                    <span className="font-mono">{m.invoices.invoice_number}</span>
                  ) : kind === "manual" ? (
                    <span className="italic">{cleanReason || "—"}</span>
                  ) : (
                    <span className="text-muted-foreground">{cleanReason || "—"}</span>
                  )}
                </td>
                <td className="px-2 py-2 text-muted-foreground">{m.actor_email ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function kindMeta(kind: MovementKind, lang: "ar" | "en") {
  const map: Record<MovementKind, { label: string; cls: string; icon: React.ReactNode }> = {
    sale: {
      label: lang === "ar" ? "بيع" : "Sale",
      cls: "bg-primary/10 text-primary",
      icon: <ShoppingCart className="h-3 w-3" />,
    },
    void: {
      label: lang === "ar" ? "إلغاء" : "Void",
      cls: "bg-warning/20 text-warning-foreground",
      icon: <RotateCcw className="h-3 w-3" />,
    },
    delete: {
      label: lang === "ar" ? "حذف فاتورة" : "Deleted",
      cls: "bg-destructive/15 text-destructive",
      icon: <Trash2 className="h-3 w-3" />,
    },
    "edit-resale": {
      label: lang === "ar" ? "تعديل (بيع)" : "Edit (sale)",
      cls: "bg-primary/10 text-primary",
      icon: <Pencil className="h-3 w-3" />,
    },
    "edit-revert": {
      label: lang === "ar" ? "تعديل (تراجع)" : "Edit (revert)",
      cls: "bg-success/15 text-success",
      icon: <Pencil className="h-3 w-3" />,
    },
    manual: {
      label: lang === "ar" ? "تصحيح يدوي" : "Manual",
      cls: "bg-accent text-accent-foreground",
      icon: <Wrench className="h-3 w-3" />,
    },
    other: {
      label: lang === "ar" ? "أخرى" : "Other",
      cls: "bg-muted text-muted-foreground",
      icon: null,
    },
  };
  return map[kind];
}

function SummaryCard({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "primary" | "success" | "warning";
}) {
  const ring =
    tone === "primary" ? "border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5" :
    tone === "success" ? "border-success/30 bg-success/5" :
    tone === "warning" ? "border-warning/40 bg-warning/10" : "bg-card";
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
