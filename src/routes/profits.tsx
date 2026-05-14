import { swatchStyle } from "@/lib/color-swatch";
import { ColorSwatch } from "@/components/color-swatch";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtMoney, fmtNumber, fmtDate } from "@/lib/utils-money";
import { collectionBadgeClass, collectionDotClass } from "@/lib/collection-styles";
import { toast } from "sonner";
import { Download, Save, TrendingUp, Wallet, Coins, Percent, RefreshCw, History, Info, ChevronDown, ChevronUp, Undo2, X, Filter } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { Product } from "@/lib/data";

type Range = "day" | "month" | "year" | "all" | "custom";

type RawItem = {
  invoice_id: string;
  product_id: string | null;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  line_total: number;
  invoices: {
    invoice_number: string;
    status: string;
    created_at: string;
    customer_name: string | null;
    subtotal: number;
    discount: number;
    total: number;
  } | null;
};

const SHIPPING_NAMES = new Set([
  "رسوم شحن",
  "رسوم خدمة / Service Fee",
  "رسوم خدمة",
  "Service Fee",
]);
const isShippingLine = (it: { product_id: string | null; product_name: string }) =>
  it.product_id === null && SHIPPING_NAMES.has(it.product_name);

function rangeBounds(r: Range, day: string, month: string, year: string, from: string, to: string) {
  const now = new Date();
  if (r === "all") return { startISO: null, endISO: null };
  if (r === "day") {
    const d = new Date(day || now.toISOString().slice(0, 10));
    const s = new Date(d); s.setHours(0, 0, 0, 0);
    const e = new Date(s); e.setDate(e.getDate() + 1);
    return { startISO: s.toISOString(), endISO: e.toISOString() };
  }
  if (r === "month") {
    const [y, m] = (month || now.toISOString().slice(0, 7)).split("-").map(Number);
    const s = new Date(y, m - 1, 1);
    const e = new Date(y, m, 1);
    return { startISO: s.toISOString(), endISO: e.toISOString() };
  }
  if (r === "year") {
    const y = Number(year || now.getFullYear());
    return { startISO: new Date(y, 0, 1).toISOString(), endISO: new Date(y + 1, 0, 1).toISOString() };
  }
  // custom
  const s = new Date((from || now.toISOString().slice(0, 10)) + "T00:00:00");
  const e = new Date((to || now.toISOString().slice(0, 10)) + "T00:00:00");
  e.setDate(e.getDate() + 1);
  return { startISO: s.toISOString(), endISO: e.toISOString() };
}

function ProfitsPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<RawItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<Range>("all");
  const today = new Date().toISOString().slice(0, 10);
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [editing, setEditing] = useState<Record<string, { cost: string; sale: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [historyOpen, setHistoryOpen] = useState<Product | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [chartView, setChartView] = useState<"profit" | "all">("profit");
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");

  const toggleSelected = (id: string) => {
    setSelectedIds((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const clearSelected = () => setSelectedIds(new Set());

  const revertHistory = async (h: any) => {
    if (!historyOpen) return;
    setRevertingId(h.id);
    const field = h.field === "cost_price" ? "cost_price" : "price";
    const value = Number(h.old_value ?? 0);
    const { error } = await supabase
      .from("products")
      .update({ [field]: value } as any)
      .eq("id", historyOpen.id);
    setRevertingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(lang === "ar" ? "تم الرجوع للقيمة السابقة" : "Reverted to previous value");
    await loadProducts();
    await openHistory(historyOpen);
  };

  const openHistory = async (p: Product) => {
    setHistoryOpen(p);
    setHistoryLoading(true);
    const { data } = await supabase
      .from("product_price_history" as any)
      .select("*")
      .eq("product_id", p.id)
      .order("changed_at", { ascending: false })
      .limit(200);
    setHistory((data ?? []) as any[]);
    setHistoryLoading(false);
  };

  const loadProducts = async () => {
    const { data } = await supabase.from("products").select("*").order("name");
    setProducts((data ?? []) as Product[]);
  };

  const loadCustomers = async () => {
    const { data } = await supabase.from("customers").select("id,name").order("name");
    setCustomers(((data ?? []) as { id: string; name: string }[]));
  };

  const loadItems = async () => {
    setLoading(true);
    const { startISO, endISO } = rangeBounds(range, day, month, year, from, to);
    let q = supabase
      .from("invoice_items")
      .select(
        "invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total, invoices!inner(invoice_number, status, created_at, customer_name, subtotal, discount, total)"
      )
      .not("invoices.status", "in", "(voided,draft)");
    if (startISO) q = q.gte("invoices.created_at", startISO);
    if (endISO) q = q.lt("invoices.created_at", endISO);
    if (customerId) q = q.eq("invoices.customer_id", customerId);
    const { data, error } = await q.limit(10000);
    if (error) toast.error(error.message);
    setItems((data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    loadProducts();
    loadCustomers();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadItems();
  }, [user, range, day, month, year, from, to, customerId]);

  useRealtimeTable("invoices", () => loadItems());
  useRealtimeTable("invoice_items", () => loadItems());
  useRealtimeTable("products", () => loadProducts());
  useRealtimeTable("customers", () => loadCustomers());

  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  // Per-invoice discount-proration factor: line_total -> net revenue after
  // applying invoice-level discount, distributed proportionally across non-shipping lines.
  // factor = (invoice.total - shippingTotal) / (invoice.subtotal - shippingTotal)
  const invoiceFactor = useMemo(() => {
    const shipByInv = new Map<string, number>();
    const seenInv = new Map<string, { subtotal: number; total: number }>();
    for (const it of items) {
      if (it.invoices && !seenInv.has(it.invoice_id)) {
        seenInv.set(it.invoice_id, {
          subtotal: Number(it.invoices.subtotal ?? 0),
          total: Number(it.invoices.total ?? 0),
        });
      }
      if (isShippingLine(it)) {
        shipByInv.set(it.invoice_id, (shipByInv.get(it.invoice_id) ?? 0) + Number(it.line_total ?? 0));
      }
    }
    const f = new Map<string, number>();
    for (const [id, inv] of seenInv) {
      const ship = shipByInv.get(id) ?? 0;
      const denom = inv.subtotal - ship;
      const num = inv.total - ship;
      f.set(id, denom > 0 ? num / denom : 1);
    }
    return f;
  }, [items]);

  const netRev = (it: RawItem) =>
    Number(it.line_total ?? 0) * (invoiceFactor.get(it.invoice_id) ?? 1);

  const filterSummary = useMemo(() => {
    const customerName = customers.find((c) => c.id === customerId)?.name ?? (lang === "ar" ? "كل العملاء" : "All customers");
    const productSummary = selectedIds.size > 0
      ? `${selectedIds.size} ${lang === "ar" ? "منتج محدد" : "selected product(s)"}`
      : search.trim()
        ? search.trim()
        : (lang === "ar" ? "كل المنتجات" : "All products");

    let rangeLabel = lang === "ar" ? "كل الفترة" : "All time";
    if (range === "day") rangeLabel = day;
    else if (range === "month") rangeLabel = month;
    else if (range === "year") rangeLabel = year;
    else if (range === "custom") rangeLabel = `${from || "—"} → ${to || "—"}`;

    return { rangeLabel, productSummary, customerName };
  }, [customers, customerId, day, from, lang, month, range, search, selectedIds, to, year]);

  // Shipping/service fees aggregate (excluded from revenue/profit but shown for transparency)
  const shippingTotals = useMemo(() => {
    let amount = 0;
    let lines = 0;
    const invoices = new Set<string>();
    for (const it of items) {
      if (!isShippingLine(it)) continue;
      if (selectedIds.size > 0) continue; // when filtering by product, shipping is irrelevant
      amount += Number(it.line_total ?? 0);
      lines += 1;
      invoices.add(it.invoice_id);
    }
    return { amount, lines, invoices: invoices.size };
  }, [items, selectedIds]);

  // Compute profit rows — include ALL products, even those with no sales in range.
  const rows = useMemo(() => {
    const filtered = items.filter((it) => !isShippingLine(it) && it.product_id);
    const byProduct = new Map<
      string,
      { product: Product | null; qty: number; revenue: number; cost: number; lines: number }
    >();
    for (const p of products) {
      byProduct.set(p.id, { product: p, qty: 0, revenue: 0, cost: 0, lines: 0 });
    }
    for (const it of filtered) {
      const p = productById.get(it.product_id!) ?? null;
      const cost = Number(p?.cost_price ?? 0) * it.quantity;
      const rev = netRev(it);
      const cur = byProduct.get(it.product_id!) ?? { product: p, qty: 0, revenue: 0, cost: 0, lines: 0 };
      cur.qty += it.quantity;
      cur.revenue += rev;
      cur.cost += cost;
      cur.lines += 1;
      byProduct.set(it.product_id!, cur);
    }
    const list = Array.from(byProduct.entries())
      .map(([pid, v]) => ({
        product_id: pid,
        product: v.product,
        name: v.product?.name ?? "(محذوف)",
        qty: v.qty,
        revenue: v.revenue,
        cost: v.cost,
        profit: v.revenue - v.cost,
        margin: v.revenue > 0 ? ((v.revenue - v.cost) / v.revenue) * 100 : 0,
        lines: v.lines,
      }))
      .filter((r) => selectedIds.size === 0 || selectedIds.has(r.product_id))
      .filter((r) => {
        if (!search.trim()) return true;
        const s = search.trim().toLowerCase();
        return (
          r.name.toLowerCase().includes(s) ||
          (r.product?.serial_number ?? "").toLowerCase().includes(s) ||
          (r.product?.color ?? "").toLowerCase().includes(s) ||
          (r.product?.collection ?? "").toLowerCase().includes(s)
        );
      })
      .sort((a, b) => {
        if (a.qty === 0 && b.qty === 0) return a.name.localeCompare(b.name);
        if (a.qty === 0) return 1;
        if (b.qty === 0) return -1;
        return b.profit - a.profit;
      });
    const totals = list.reduce(
      (acc, r) => {
        acc.revenue += r.revenue; acc.cost += r.cost; acc.qty += r.qty; acc.lines += r.lines;
        return acc;
      },
      { revenue: 0, cost: 0, qty: 0, lines: 0 }
    );
    // Include custom invoice lines (non-product, non-shipping) so KPI totals
    // reflect the actual invoice value. Shipping fees and voided invoices remain excluded.
    // When a product filter is active, skip extras (they aren't tied to a product).
    let extrasRevenue = 0;
    let extrasLines = 0;
    if (selectedIds.size === 0) {
      for (const it of items) {
        if (it.product_id) continue;
        if (isShippingLine(it)) continue;
        extrasRevenue += netRev(it);
        extrasLines += 1;
      }
    }
    const totalRevenue = totals.revenue + extrasRevenue;
    const totalCost = totals.cost; // custom lines have no cost basis
    return {
      list,
      extras: { revenue: extrasRevenue, lines: extrasLines },
      totals: {
        ...totals,
        revenue: totalRevenue,
        cost: totalCost,
        lines: totals.lines + extrasLines,
        profit: totalRevenue - totalCost,
        margin: totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0,
      },
    };
  }, [items, productById, search, products, selectedIds, invoiceFactor]);

  const totalsMatch = useMemo(() => {
    if (selectedIds.size > 0 || search.trim()) return null;

    const totalsByInvoice = new Map<string, number>();
    for (const it of items) {
      if (!it.invoices) continue;
      totalsByInvoice.set(it.invoice_id, Number(it.invoices.total ?? 0));
    }

    const reportsTotal = Array.from(totalsByInvoice.values()).reduce((sum, value) => sum + value, 0);
    const profitsTotal = Number(rows.totals.revenue ?? 0);
    const diff = Math.abs(profitsTotal - reportsTotal);

    return {
      reportsTotal,
      profitsTotal,
      diff,
      ok: diff < 0.01,
    };
  }, [items, rows.totals.revenue, search, selectedIds]);

  // Per-invoice profit breakdown
  const invoiceRows = useMemo(() => {
    const map = new Map<
      string,
      {
        invoice_id: string;
        invoice_number: string;
        created_at: string;
        customer_name: string | null;
        revenue: number;
        cost: number;
        items: number;
      }
    >();
    for (const it of items) {
      if (isShippingLine(it)) continue;
      if (!it.product_id) continue;
      if (selectedIds.size > 0 && !selectedIds.has(it.product_id)) continue;
      const p = productById.get(it.product_id);
      const cost = Number(p?.cost_price ?? 0) * it.quantity;
      const rev = netRev(it);
      const cur = map.get(it.invoice_id) ?? {
        invoice_id: it.invoice_id,
        invoice_number: it.invoices?.invoice_number ?? "",
        created_at: it.invoices?.created_at ?? "",
        customer_name: it.invoices?.customer_name ?? null,
        revenue: 0,
        cost: 0,
        items: 0,
      };
      cur.revenue += rev;
      cur.cost += cost;
      cur.items += it.quantity;
      map.set(it.invoice_id, cur);
    }
    return Array.from(map.values())
      .map((r) => ({ ...r, profit: r.revenue - r.cost, margin: r.revenue > 0 ? ((r.revenue - r.cost) / r.revenue) * 100 : 0 }))
      .sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
  }, [items, productById, selectedIds, invoiceFactor]);

  // Daily trend (net profit per day) within selected range and product filter
  const dailyTrend = useMemo(() => {
    const map = new Map<string, { date: string; revenue: number; cost: number; profit: number }>();
    for (const it of items) {
      if (isShippingLine(it) || !it.product_id) continue;
      if (selectedIds.size > 0 && !selectedIds.has(it.product_id)) continue;
      const day = (it.invoices?.created_at ?? "").slice(0, 10);
      if (!day) continue;
      const p = productById.get(it.product_id);
      const cost = Number(p?.cost_price ?? 0) * it.quantity;
      const rev = netRev(it);
      const cur = map.get(day) ?? { date: day, revenue: 0, cost: 0, profit: 0 };
      cur.revenue += rev; cur.cost += cost; cur.profit = cur.revenue - cur.cost;
      map.set(day, cur);
    }
    return Array.from(map.values()).sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [items, productById, selectedIds, invoiceFactor]);

  const startEdit = (p: Product) => {
    setEditing((cur) => ({
      ...cur,
      [p.id]: { cost: String(p.cost_price ?? 0), sale: String(p.price ?? 0) },
    }));
  };
  const cancelEdit = (id: string) => {
    setEditing((cur) => {
      const n = { ...cur };
      delete n[id];
      return n;
    });
  };
  const saveEdit = async (p: Product) => {
    const e = editing[p.id];
    if (!e) return;
    const cost = Number(e.cost) || 0;
    const sale = Number(e.sale) || 0;
    if (cost < 0 || sale < 0) {
      toast.error(lang === "ar" ? "قيمة غير صحيحة" : "Invalid value");
      return;
    }
    setSavingId(p.id);
    const { error } = await supabase
      .from("products")
      .update({ cost_price: cost, price: sale } as any)
      .eq("id", p.id);
    setSavingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(lang === "ar" ? "تم الحفظ" : "Saved");
    cancelEdit(p.id);
    await loadProducts();
  };

  const exportXlsx = () => {
    const { startISO, endISO } = rangeBounds(range, day, month, year, from, to);
    const rangeLabel = !startISO
      ? lang === "ar" ? "الإجمالي" : "All"
      : `${startISO.slice(0, 10)} → ${(endISO ?? "").slice(0, 10)}`;

    // Sheet 1: per-product
    const ws1Data = [
      [
        lang === "ar" ? "المنتج" : "Product",
        lang === "ar" ? "الكولكشن" : "Collection",
        lang === "ar" ? "تسلسلي" : "Serial",
        lang === "ar" ? "اللون" : "Color",
        lang === "ar" ? "الكمية المباعة" : "Sold Qty",
        lang === "ar" ? "سعر التكلفة" : "Cost Price",
        lang === "ar" ? "سعر البيع" : "Sale Price",
        lang === "ar" ? "إجمالي التكلفة" : "Total Cost",
        lang === "ar" ? "إجمالي البيع" : "Total Revenue",
        lang === "ar" ? "صافي الربح" : "Net Profit",
        lang === "ar" ? "هامش %" : "Margin %",
      ],
      ...rows.list.map((r) => [
        r.name,
        r.product?.collection ?? "",
        r.product?.serial_number ?? "",
        r.product?.color ?? "",
        r.qty,
        Number(r.product?.cost_price ?? 0),
        Number(r.product?.price ?? 0),
        +r.cost.toFixed(2),
        +r.revenue.toFixed(2),
        +r.profit.toFixed(2),
        +r.margin.toFixed(2),
      ]),
      [],
      [
        lang === "ar" ? "الإجمالي" : "TOTAL",
        "",
        "",
        "",
        rows.totals.qty,
        "",
        "",
        +rows.totals.cost.toFixed(2),
        +rows.totals.revenue.toFixed(2),
        +rows.totals.profit.toFixed(2),
        +rows.totals.margin.toFixed(2),
      ],
    ];

    // Sheet 2: per-invoice
    const ws2Data = [
      [
        lang === "ar" ? "رقم الفاتورة" : "Invoice #",
        lang === "ar" ? "التاريخ" : "Date",
        lang === "ar" ? "العميل" : "Customer",
        lang === "ar" ? "عدد القطع" : "Items",
        lang === "ar" ? "إجمالي البيع" : "Revenue",
        lang === "ar" ? "إجمالي التكلفة" : "Cost",
        lang === "ar" ? "صافي الربح" : "Net Profit",
        lang === "ar" ? "هامش %" : "Margin %",
      ],
      ...invoiceRows.map((r) => [
        r.invoice_number,
        r.created_at.slice(0, 10),
        r.customer_name ?? "",
        r.items,
        +r.revenue.toFixed(2),
        +r.cost.toFixed(2),
        +r.profit.toFixed(2),
        +r.margin.toFixed(2),
      ]),
    ];

    // Sheet 3: meta
    const ws3Data = [
      [lang === "ar" ? "النطاق" : "Range", rangeLabel],
      [lang === "ar" ? "تم في" : "Generated", new Date().toISOString()],
      [lang === "ar" ? "ملاحظة" : "Note", lang === "ar" ? "الفواتير الملغاة والمحذوفة مستبعدة. رسوم الشحن مستبعدة." : "Voided/deleted invoices and shipping fees excluded."],
      [lang === "ar" ? "إجمالي البيع" : "Total Revenue", +rows.totals.revenue.toFixed(2)],
      [lang === "ar" ? "إجمالي التكلفة" : "Total Cost", +rows.totals.cost.toFixed(2)],
      [lang === "ar" ? "صافي الربح" : "Net Profit", +rows.totals.profit.toFixed(2)],
      [lang === "ar" ? "الهامش %" : "Margin %", +rows.totals.margin.toFixed(2)],
    ];

    const wb = XLSX.utils.book_new();
    const ws4Data = [
      [
        lang === "ar" ? "التاريخ" : "Date",
        lang === "ar" ? "البيع" : "Revenue",
        lang === "ar" ? "التكلفة" : "Cost",
        lang === "ar" ? "صافي الربح" : "Net Profit",
      ],
      ...dailyTrend.map((d) => [d.date, +d.revenue.toFixed(2), +d.cost.toFixed(2), +d.profit.toFixed(2)]),
    ];

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ws1Data), lang === "ar" ? "المنتجات" : "Products");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ws2Data), lang === "ar" ? "الفواتير" : "Invoices");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ws4Data), lang === "ar" ? "اليومي" : "Daily");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ws3Data), lang === "ar" ? "ملخص" : "Summary");
    const fname = `profits_${range}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fname);
    toast.success(lang === "ar" ? "تم التصدير" : "Exported");
  };

  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-emerald-500" />
            {t("صافي الأرباح", "Profit Analysis")}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t(
              "حساب الربح الفعلي لكل منتج وكل فاتورة. الفواتير الملغاة/المحذوفة ورسوم الشحن مستبعدة.",
              "Actual profit per product & per invoice. Voided/deleted invoices and shipping fees excluded."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              await Promise.all([loadProducts(), loadItems()]);
              const r = rows.totals;
              toast.success(
                t("تم إعادة الاحتساب", "Recalculated"),
                {
                  description: t(
                    `البيع: ${fmtMoney(r.revenue, "EGP", lang)} · التكلفة: ${fmtMoney(r.cost, "EGP", lang)} · الربح: ${fmtMoney(r.profit, "EGP", lang)} (${r.margin.toFixed(1)}%)`,
                    `Revenue: ${fmtMoney(r.revenue, "EGP", lang)} · Cost: ${fmtMoney(r.cost, "EGP", lang)} · Profit: ${fmtMoney(r.profit, "EGP", lang)} (${r.margin.toFixed(1)}%)`
                  ),
                  duration: 6000,
                }
              );
            }}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {t("إعادة احتساب", "Recalculate")}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="formula">
                <Info className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] text-xs leading-relaxed">
              <div className="font-semibold mb-1">{t("معادلة حساب الربح", "Profit formula")}</div>
              <ul className="space-y-1 list-disc ps-4">
                <li>{t("إجمالي البيع للمنتج = Σ (سعر الوحدة × الكمية − الخصم) لكل بند فاتورة غير ملغية.", "Revenue = Σ (unit_price × qty − discount) across non-voided invoice items.")}</li>
                <li>{t("إجمالي التكلفة = سعر التكلفة × الكمية المباعة.", "Cost = cost_price × sold qty.")}</li>
                <li>{t("صافي الربح = إجمالي البيع − إجمالي التكلفة.", "Profit = Revenue − Cost.")}</li>
                <li>{t("هامش % = (الربح ÷ إجمالي البيع) × 100.", "Margin % = (Profit ÷ Revenue) × 100.")}</li>
                <li>{t("بنود مخصصة (بدون منتج) تُحتسب ضمن إجمالي البيع بتكلفة 0.", "Custom (non-product) lines are added to Revenue with zero cost.")}</li>
                <li>{t("يتم خصم الخصم على مستوى الفاتورة بالتناسب على البنود (باستثناء الشحن).", "Invoice-level discount is prorated across non-shipping lines.")}</li>
                <li className="text-muted-foreground">{t("مستبعد: الفواتير الملغية، الفواتير المحذوفة، رسوم الشحن/الخدمة.", "Excluded: voided invoices, deleted invoices, shipping/service fees.")}</li>
              </ul>
            </PopoverContent>
          </Popover>
          <Button onClick={exportXlsx} className="gap-2">
            <Download className="h-4 w-4" /> {t("تنزيل Excel", "Export Excel")}
          </Button>
        </div>
      </div>

      {/* Range filter */}
      <div className="rounded-2xl border bg-card p-3 sm:p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1.5">
            {([
              ["day", t("يوم", "Day")],
              ["month", t("شهر", "Month")],
              ["year", t("سنة", "Year")],
              ["all", t("الإجمالي", "All")],
              ["custom", t("نطاق", "Range")],
            ] as [Range, string][]).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setRange(k)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  range === k
                    ? "bg-primary text-primary-foreground shadow"
                    : "bg-muted hover:bg-muted/70"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {range === "day" && (
            <div>
              <Label className="text-xs">{t("اليوم", "Day")}</Label>
              <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-[170px]" />
            </div>
          )}
          {range === "month" && (
            <div>
              <Label className="text-xs">{t("الشهر", "Month")}</Label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-[170px]" />
            </div>
          )}
          {range === "year" && (
            <div>
              <Label className="text-xs">{t("السنة", "Year")}</Label>
              <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="w-[120px]" />
            </div>
          )}
          {range === "custom" && (
            <>
              <div>
                <Label className="text-xs">{t("من", "From")}</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[170px]" />
              </div>
              <div>
                <Label className="text-xs">{t("إلى", "To")}</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[170px]" />
              </div>
            </>
          )}
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs">{t("بحث منتج", "Search product")}</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("اسم / تسلسلي / لون / كولكشن", "name / serial / color / collection")} />
          </div>
          <div className="min-w-[220px]">
            <Label className="text-xs">{t("العميل", "Customer")}</Label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
            >
              <option value="">{t("كل العملاء", "All customers")}</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[200px]">
            <Label className="text-xs">{t("فلترة منتجات محددة", "Filter specific products")}</Label>
            <Popover open={productPickerOpen} onOpenChange={setProductPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start gap-2 h-10">
                  <Filter className="h-4 w-4" />
                  {selectedIds.size > 0
                    ? t(`${selectedIds.size} منتج محدد`, `${selectedIds.size} selected`)
                    : t("كل المنتجات", "All products")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[320px] p-0" align="end">
                <div className="p-2 border-b flex items-center gap-2">
                  <Input
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    placeholder={t("بحث...", "Search...")}
                    className="h-8 text-xs"
                  />
                  {selectedIds.size > 0 && (
                    <Button size="sm" variant="ghost" onClick={clearSelected} className="h-8 px-2 text-[10px]">
                      {t("مسح", "Clear")}
                    </Button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto p-1">
                  {products
                    .filter((p) => {
                      const s = pickerSearch.trim().toLowerCase();
                      if (!s) return true;
                      return (
                        p.name.toLowerCase().includes(s) ||
                        (p.serial_number ?? "").toLowerCase().includes(s) ||
                        (p.collection ?? "").toLowerCase().includes(s)
                      );
                    })
                    .map((p) => {
                      const checked = selectedIds.has(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => toggleSelected(p.id)}
                          className={`w-full text-start flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted ${checked ? "bg-primary/10" : ""}`}
                        >
                          <input type="checkbox" readOnly checked={checked} className="pointer-events-none" />
                          <span className="truncate flex-1">{p.name}</span>
                          {p.collection && (
                            <span className={`text-[9px] rounded border px-1 ${collectionBadgeClass(p.collection)}`}>{p.collection}</span>
                          )}
                        </button>
                      );
                    })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        {selectedIds.size > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">{t("المنتجات المحددة:", "Selected:")}</span>
            {Array.from(selectedIds).map((id) => {
              const p = productById.get(id);
              if (!p) return null;
              return (
                <span key={id} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[10px]">
                  {p.name}
                  <button onClick={() => toggleSelected(id)} className="opacity-60 hover:opacity-100"><X className="h-3 w-3" /></button>
                </span>
              );
            })}
            <button onClick={clearSelected} className="text-[10px] text-primary underline ms-1">{t("إلغاء الكل", "Clear all")}</button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-foreground">{t("السياق الحالي", "Current context")}</span>
          <span className="rounded-full border bg-muted/40 px-2.5 py-1">{t("المدى", "Range")}: {filterSummary.rangeLabel}</span>
          <span className="rounded-full border bg-muted/40 px-2.5 py-1">{t("المنتج", "Product")}: {filterSummary.productSummary}</span>
          <span className="rounded-full border bg-muted/40 px-2.5 py-1">{t("العميل", "Customer")}: {filterSummary.customerName}</span>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard icon={<Wallet className="h-5 w-5" />} label={t("إجمالي البيع", "Revenue")} value={fmtMoney(rows.totals.revenue, "EGP", lang)} className="from-sky-500/15 to-sky-500/5 text-sky-600" />
        <KpiCard icon={<Coins className="h-5 w-5" />} label={t("إجمالي التكلفة", "Cost")} value={fmtMoney(rows.totals.cost, "EGP", lang)} className="from-amber-500/15 to-amber-500/5 text-amber-600" />
        <KpiCard icon={<TrendingUp className="h-5 w-5" />} label={t("صافي الربح", "Net Profit")} value={fmtMoney(rows.totals.profit, "EGP", lang)} className="from-emerald-500/20 to-emerald-500/5 text-emerald-600" />
        <KpiCard icon={<Percent className="h-5 w-5" />} label={t("هامش الربح", "Margin")} value={`${rows.totals.margin.toFixed(1)}%`} className="from-violet-500/15 to-violet-500/5 text-violet-600" />
        <KpiCard
          icon={<Coins className="h-5 w-5" />}
          label={t("شحن/خدمة (مستبعد)", "Shipping/Fees (excluded)")}
          value={fmtMoney(shippingTotals.amount, "EGP", lang)}
          className="from-slate-500/15 to-slate-500/5 text-slate-600"
        />
      </div>
      {totalsMatch && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${totalsMatch.ok ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-700" : "border-destructive/30 bg-destructive/8 text-destructive"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">
              {totalsMatch.ok
                ? t("التحقق الآلي نجح: إجمالي البيع مطابق للتقارير", "Auto-check passed: revenue matches reports")
                : t("تنبيه: يوجد فرق بين إجمالي البيع والتقارير", "Alert: revenue differs from reports") }
            </div>
            <div className="text-xs opacity-80">
              {t("التقارير", "Reports")}: {fmtMoney(totalsMatch.reportsTotal, "EGP", lang)} · {t("الأرباح", "Profits")}: {fmtMoney(totalsMatch.profitsTotal, "EGP", lang)}
              {!totalsMatch.ok && ` · ${t("الفرق", "Diff")}: ${fmtMoney(totalsMatch.diff, "EGP", lang)}`}
            </div>
          </div>
        </div>
      )}
      {(selectedIds.size > 0 || search.trim()) && (
        <div className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          {t("مطابقة التقارير التلقائية تُعرض عند عدم تقييد النتائج بفلتر منتج محدد أو بحث نصّي، لأن صفحة التقارير الحالية لا تطبق فلترة على مستوى المنتج.", "Automatic report matching is shown when no product-specific filter or text search is applied, because the reports page currently compares invoice totals rather than product-level subsets.")}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground -mt-1">
        {t(
          `رسوم الشحن/الخدمة (${shippingTotals.lines} بند على ${shippingTotals.invoices} فاتورة) مستبعدة تمامًا من إجمالي البيع وصافي الأرباح. الفواتير الملغاة والمحذوفة كذلك.`,
          `Shipping/service fees (${shippingTotals.lines} line(s) across ${shippingTotals.invoices} invoice(s)) are fully excluded from Revenue and Net Profit. Voided/deleted invoices are also excluded.`
        )}
      </p>

      {/* Daily trend chart */}
      <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            {t("اتجاه صافي الربح اليومي", "Daily net profit trend")}
            <span className="text-[11px] text-muted-foreground font-normal">
              · {t(`${dailyTrend.length} يوم`, `${dailyTrend.length} day(s)`)}
            </span>
          </h3>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-full border bg-muted/40 p-0.5 text-[11px]">
              {(["profit", "all"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setChartView(k)}
                  className={`rounded-full px-2.5 py-1 font-semibold transition ${chartView === k ? "bg-primary text-primary-foreground shadow" : "hover:bg-background"}`}
                >
                  {k === "profit" ? t("صافي الربح فقط", "Profit only") : t("الكل", "All")}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8"
              disabled={dailyTrend.length === 0}
              onClick={() => {
                const headers = [
                  t("التاريخ", "Date"),
                  t("الإيراد", "Revenue"),
                  t("التكلفة", "Cost"),
                  t("صافي الربح", "Net Profit"),
                ];
                const lines = [headers.join(",")];
                for (const d of dailyTrend) {
                  lines.push([d.date, d.revenue.toFixed(2), d.cost.toFixed(2), d.profit.toFixed(2)].join(","));
                }
                const totals = dailyTrend.reduce((a, d) => ({ r: a.r + d.revenue, c: a.c + d.cost, p: a.p + d.profit }), { r: 0, c: 0, p: 0 });
                lines.push([t("الإجمالي", "TOTAL"), totals.r.toFixed(2), totals.c.toFixed(2), totals.p.toFixed(2)].join(","));
                const csv = "\uFEFF" + lines.join("\n");
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `profit_trend_${range}_${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success(t("تم تصدير CSV", "CSV exported"));
              }}
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          </div>
        </div>
        <div className="p-3 h-[260px]" dir={lang === "ar" ? "rtl" : "ltr"}>
          {dailyTrend.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {t("لا توجد بيانات لعرضها", "No data to display")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyTrend} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  reversed={lang === "ar"}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => String(v).slice(5)}
                />
                <YAxis
                  orientation={lang === "ar" ? "right" : "left"}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => fmtNumber(Number(v), lang)}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, direction: lang === "ar" ? "rtl" : "ltr" }}
                  formatter={(v: any, name: any) => [fmtMoney(Number(v), "EGP", lang), name]}
                  labelFormatter={(l) => fmtDate(String(l), lang)}
                />
                <Line type="monotone" dataKey="profit" name={t("صافي الربح", "Net Profit")} stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                {chartView === "all" && (
                  <Line type="monotone" dataKey="revenue" name={t("البيع", "Revenue")} stroke="#0ea5e9" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                )}
                {chartView === "all" && (
                  <Line type="monotone" dataKey="cost" name={t("التكلفة", "Cost")} stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Products table */}
      <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h3 className="font-semibold text-sm">{t("ربح كل منتج", "Per-Product Profit")} ({fmtNumber(rows.list.length, lang)})</h3>
          {loading && <span className="text-[11px] text-muted-foreground">{t("...جاري التحميل", "loading...")}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start">{t("المنتج", "Product")}</th>
                <th className="px-3 py-2 text-end">{t("الكمية", "Qty")}</th>
                <th className="px-3 py-2 text-end">{t("سعر التكلفة", "Cost")}</th>
                <th className="px-3 py-2 text-end">{t("سعر البيع", "Sale")}</th>
                <th className="px-3 py-2 text-end">{t("إجمالي التكلفة", "Total Cost")}</th>
                <th className="px-3 py-2 text-end">{t("إجمالي البيع", "Revenue")}</th>
                <th className="px-3 py-2 text-end">{t("صافي الربح", "Profit")}</th>
                <th className="px-3 py-2 text-end">{t("هامش %", "Margin")}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.list.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-12 text-center text-muted-foreground text-sm">{t("لا توجد بيانات في هذا النطاق", "No data in this range")}</td></tr>
              ) : rows.list.map((r) => {
                const p = r.product;
                const e = p ? editing[p.id] : undefined;
                return (
                  <Fragment key={r.product_id}>
                  <tr className={r.profit >= 0 ? "" : "bg-rose-500/5"}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-9 w-9 shrink-0 overflow-hidden rounded border bg-muted">
                          {p?.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-cover" /> : null}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate flex items-center gap-1.5">
                            {r.name}
                            {p?.collection && (
                              <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold ${collectionBadgeClass(p.collection)}`}>
                                <span className={`inline-block h-1 w-1 rounded-full ${collectionDotClass(p.collection)}`} />
                                {p.collection}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground flex gap-2 flex-wrap">
                            {p?.serial_number && <span className="font-mono">{p.serial_number}</span>}
                            {p?.color && (
                              <span className="inline-flex items-center gap-1">
                                <ColorSwatch value={p.color} size="sm" />
                                {p.color}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">{fmtNumber(r.qty, lang)}</td>
                    <td className="px-3 py-2 text-end">
                      {p && e ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={e.cost}
                          onChange={(ev) => setEditing((cur) => ({ ...cur, [p.id]: { ...cur[p.id], cost: ev.target.value } }))}
                          className="h-8 w-24 text-end"
                        />
                      ) : (
                        <span className="tabular-nums">{fmtMoney(Number(p?.cost_price ?? 0), "EGP", lang)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-end">
                      {p && e ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={e.sale}
                          onChange={(ev) => setEditing((cur) => ({ ...cur, [p.id]: { ...cur[p.id], sale: ev.target.value } }))}
                          className="h-8 w-24 text-end"
                        />
                      ) : (
                        <span className="tabular-nums">{fmtMoney(Number(p?.price ?? 0), "EGP", lang)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">{fmtMoney(r.cost, "EGP", lang)}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{fmtMoney(r.revenue, "EGP", lang)}</td>
                    <td className={`px-3 py-2 text-end tabular-nums font-semibold ${r.profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmtMoney(r.profit, "EGP", lang)}</td>
                    <td className={`px-3 py-2 text-end tabular-nums ${r.margin >= 0 ? "" : "text-rose-600"}`}>{r.margin.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-end">
                      <div className="flex items-center justify-end gap-1">
                        {p && (
                          e ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => cancelEdit(p.id)} className="h-7 px-2">×</Button>
                              <Button size="sm" disabled={savingId === p.id} onClick={() => saveEdit(p)} className="h-7 px-2 gap-1">
                                <Save className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => startEdit(p)} className="h-7 text-xs">
                                {t("تعديل", "Edit")}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => openHistory(p)} className="h-7 px-1.5" title={t("سجل الأسعار", "Price history")}>
                                <History className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setExpanded((cur) => ({ ...cur, [r.product_id]: !cur[r.product_id] }))} className="h-7 px-1.5" title={t("التفاصيل", "Details")}>
                          {expanded[r.product_id] ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {expanded[r.product_id] && (
                    <tr key={r.product_id + ":d"} className="bg-muted/20">
                      <td colSpan={9} className="px-4 py-3">
                        <div className="grid gap-3 md:grid-cols-2 text-xs">
                          <div className="rounded-lg border bg-card p-3">
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                              {t("معادلة الحساب", "Calculation")}
                            </div>
                            <div className="space-y-1.5 font-mono">
                              <div>{t("سعر التكلفة", "Cost")}: <span className="tabular-nums">{fmtMoney(Number(p?.cost_price ?? 0), "EGP", lang)}</span></div>
                              <div>{t("سعر البيع", "Sale")}: <span className="tabular-nums">{fmtMoney(Number(p?.price ?? 0), "EGP", lang)}</span></div>
                              <div>{t("الكمية المباعة", "Sold qty")}: <span className="tabular-nums">{fmtNumber(r.qty, lang)}</span></div>
                              <div>{t("عدد بنود الفواتير", "Invoice lines")}: <span className="tabular-nums">{fmtNumber(r.lines, lang)}</span></div>
                              <div className="pt-1.5 border-t">
                                {t("إجمالي التكلفة", "Total Cost")} = {fmtMoney(Number(p?.cost_price ?? 0), "EGP", lang)} × {fmtNumber(r.qty, lang)} = <span className="font-semibold tabular-nums">{fmtMoney(r.cost, "EGP", lang)}</span>
                              </div>
                              <div>
                                {t("إجمالي البيع", "Revenue")} = Σ(unit × qty − discount) = <span className="font-semibold tabular-nums">{fmtMoney(r.revenue, "EGP", lang)}</span>
                              </div>
                              <div className={`pt-1 font-semibold ${r.profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                {t("صافي الربح", "Profit")} = {fmtMoney(r.revenue, "EGP", lang)} − {fmtMoney(r.cost, "EGP", lang)} = <span className="tabular-nums">{fmtMoney(r.profit, "EGP", lang)}</span>
                              </div>
                              <div>
                                {t("الهامش", "Margin")} = ({fmtMoney(r.profit, "EGP", lang)} ÷ {fmtMoney(r.revenue, "EGP", lang)}) × 100 = <span className="font-semibold">{r.margin.toFixed(2)}%</span>
                              </div>
                            </div>
                          </div>
                          <div className="rounded-lg border bg-card p-3">
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                              {t("بنود الفواتير المعتمدة", "Counted invoice lines")} ({fmtNumber(items.filter((it) => it.product_id === r.product_id && !isShippingLine(it)).length, lang)})
                            </div>
                            <div className="max-h-44 overflow-y-auto divide-y text-[11px]">
                              {items
                                .filter((it) => it.product_id === r.product_id && !isShippingLine(it))
                                .slice(0, 50)
                                .map((it, i) => (
                                  <div key={i} className="py-1 flex items-center justify-between gap-2">
                                    <span className="font-mono">{it.invoices?.invoice_number}</span>
                                    <span className="text-muted-foreground">{it.invoices?.created_at?.slice(0,10)}</span>
                                    <span className="tabular-nums">×{it.quantity}</span>
                                    <span className="tabular-nums">{fmtMoney(Number(it.line_total ?? 0), "EGP", lang)}</span>
                                  </div>
                                ))}
                              {items.filter((it) => it.product_id === r.product_id && !isShippingLine(it)).length === 0 && (
                                <div className="py-3 text-center text-muted-foreground">{t("لا توجد مبيعات في النطاق", "No sales in range")}</div>
                              )}
                            </div>
                            <div className="mt-2 text-[10px] text-muted-foreground">
                              {t("الفواتير الملغية والمحذوفة ورسوم الشحن مستبعدة تلقائيًا.", "Voided/deleted invoices and shipping fees are auto-excluded.")}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-invoice profit */}
      <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h3 className="font-semibold text-sm">{t("ربح كل فاتورة", "Per-Invoice Profit")} ({fmtNumber(invoiceRows.length, lang)})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start">{t("الفاتورة", "Invoice")}</th>
                <th className="px-3 py-2 text-start">{t("التاريخ", "Date")}</th>
                <th className="px-3 py-2 text-start">{t("العميل", "Customer")}</th>
                <th className="px-3 py-2 text-end">{t("القطع", "Items")}</th>
                <th className="px-3 py-2 text-end">{t("البيع", "Revenue")}</th>
                <th className="px-3 py-2 text-end">{t("التكلفة", "Cost")}</th>
                <th className="px-3 py-2 text-end">{t("الربح", "Profit")}</th>
                <th className="px-3 py-2 text-end">{t("هامش", "Margin")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoiceRows.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-12 text-center text-muted-foreground text-sm">{t("لا توجد فواتير", "No invoices")}</td></tr>
              ) : invoiceRows.map((r) => (
                <tr key={r.invoice_id} className={r.profit >= 0 ? "" : "bg-rose-500/5"}>
                  <td className="px-3 py-2 font-mono text-xs">{r.invoice_number}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(r.created_at, lang)}</td>
                  <td className="px-3 py-2">{r.customer_name ?? "—"}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{fmtNumber(r.items, lang)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{fmtMoney(r.revenue, "EGP", lang)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{fmtMoney(r.cost, "EGP", lang)}</td>
                  <td className={`px-3 py-2 text-end tabular-nums font-semibold ${r.profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmtMoney(r.profit, "EGP", lang)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{r.margin.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Price history dialog */}
      <Dialog open={!!historyOpen} onOpenChange={(o) => { if (!o) { setHistoryOpen(null); setHistory([]); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {t("سجل تعديلات الأسعار", "Price change history")}
              {historyOpen && <span className="block text-xs text-muted-foreground font-normal mt-1">{historyOpen.name}</span>}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {historyLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("...جاري التحميل", "Loading...")}</div>
            ) : history.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("لا توجد تعديلات سابقة", "No prior changes")}</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-start">{t("الحقل", "Field")}</th>
                    <th className="px-2 py-1.5 text-end">{t("من", "From")}</th>
                    <th className="px-2 py-1.5 text-end">{t("إلى", "To")}</th>
                    <th className="px-2 py-1.5 text-start">{t("بواسطة", "By")}</th>
                    <th className="px-2 py-1.5 text-start">{t("التاريخ", "When")}</th>
                    <th className="px-2 py-1.5 text-end">{t("إجراء", "Action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {history.map((h) => {
                    const currentVal = historyOpen
                      ? Number((h.field === "cost_price" ? historyOpen.cost_price : historyOpen.price) ?? 0)
                      : 0;
                    const oldVal = Number(h.old_value ?? 0);
                    const isCurrent = currentVal === oldVal;
                    return (
                      <tr key={h.id}>
                        <td className="px-2 py-1.5">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${h.field === "cost_price" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300"}`}>
                            {h.field === "cost_price" ? t("تكلفة", "cost") : t("بيع", "sale")}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums">{fmtMoney(oldVal, "EGP", lang)}</td>
                        <td className="px-2 py-1.5 text-end tabular-nums font-semibold">{fmtMoney(Number(h.new_value ?? 0), "EGP", lang)}</td>
                        <td className="px-2 py-1.5 text-[11px] truncate max-w-[140px]" title={h.changed_by_email ?? ""}>{h.changed_by_email ?? "—"}</td>
                        <td className="px-2 py-1.5 text-[11px] text-muted-foreground">{new Date(h.changed_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB")}</td>
                        <td className="px-2 py-1.5 text-end">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={revertingId === h.id || isCurrent}
                            onClick={() => revertHistory(h)}
                            className="h-7 px-2 text-[10px] gap-1"
                            title={isCurrent ? t("القيمة الحالية", "Current value") : t("استرجاع", "Revert")}
                          >
                            <Undo2 className="h-3 w-3" />
                            {isCurrent ? t("الحالي", "Current") : t("رجوع", "Revert")}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({ icon, label, value, className }: { icon: React.ReactNode; label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-4 shadow-sm ${className ?? ""}`}>
      <div className="flex items-center gap-2 text-xs font-semibold opacity-80">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1.5 text-lg sm:text-xl font-bold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

export const Route = createFileRoute("/profits")({
  component: () => (
    <AppShell>
      <ProfitsPage />
    </AppShell>
  ),
});
