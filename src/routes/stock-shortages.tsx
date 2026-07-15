import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useBatchedRealtimeTables } from "@/lib/realtime";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Package, TruckIcon, RefreshCw, Search, Copy, Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/stock-shortages")({
  component: () => (
    <AppShell>
      <StockShortagesPage />
    </AppShell>
  ),
});

type ShortageInvoice = {
  invoice_id: string;
  invoice_number: string;
  customer_name: string | null;
  quantity: number;
  created_at: string;
  status: string;
};

type ShortageRow = {
  product_id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  collection: string | null;
  image_url: string | null;
  is_spare_part: boolean | null;
  stock_quantity: number;
  incoming_qty: number;
  needed_qty: number;
  net_shortage: number;
  invoices: ShortageInvoice[];
};

function StockShortagesPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [rows, setRows] = useState<ShortageRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_stock_shortages" as any);
    if (error) {
      toast.error(error.message);
      setRows([]);
    } else {
      setRows((data as any) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  useBatchedRealtimeTables(
    ["invoice_po_reservations", "purchase_order_items", "products"],
    () => {
      load();
    },
    [],
    { debounceMs: 400 },
  );


  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.product_name.toLowerCase().includes(needle) ||
        (r.serial_number ?? "").toLowerCase().includes(needle) ||
        (r.color ?? "").toLowerCase().includes(needle) ||
        (r.collection ?? "").toLowerCase().includes(needle) ||
        r.invoices.some(
          (i) =>
            (i.invoice_number ?? "").toLowerCase().includes(needle) ||
            (i.customer_name ?? "").toLowerCase().includes(needle),
        ),
    );
  }, [rows, q]);

  const totals = useMemo(() => {
    const src = filtered;
    return {
      lines: src.length,
      needed: src.reduce((s, r) => s + (r.needed_qty || 0), 0),
      shortage: src.reduce((s, r) => s + Math.max(0, r.needed_qty - r.incoming_qty), 0),
      incoming: src.reduce((s, r) => s + (r.incoming_qty || 0), 0),
    };
  }, [filtered]);

  const copySummary = async () => {
    const lines = filtered.map((r) => {
      const bits: string[] = [r.product_name];
      if (r.serial_number) bits.push(`SN: ${r.serial_number}`);
      if (r.color) bits.push(r.color);
      if (r.collection) bits.push(r.collection);
      bits.push(`${ar ? "مطلوب" : "Needed"}: ${r.needed_qty}`);
      bits.push(`${ar ? "قادم" : "Incoming"}: ${r.incoming_qty}`);
      bits.push(`${ar ? "نقص" : "Shortage"}: ${Math.max(0, r.needed_qty - r.incoming_qty)}`);
      return bits.join(" | ");
    });
    await navigator.clipboard.writeText(lines.join("\n"));
    toast.success(ar ? "تم النسخ" : "Copied");
  };

  const downloadCsv = () => {
    const header = ["Product", "Serial", "Color", "Collection", "Stock", "Incoming", "Needed", "Shortage"];
    const rowsCsv = filtered.map((r) =>
      [
        r.product_name,
        r.serial_number ?? "",
        r.color ?? "",
        r.collection ?? "",
        r.stock_quantity,
        r.incoming_qty,
        r.needed_qty,
        Math.max(0, r.needed_qty - r.incoming_qty),
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...rowsCsv].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-shortages-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
      {/* Header */}
      <div className="noir-surface gold-hairline rounded-2xl p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-700/10 border border-amber-500/30 p-2.5">
              <AlertTriangle className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-amber-100">
                {ar ? "تقرير النواقص" : "Stock Shortages"}
              </h1>
              <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
                {ar
                  ? "كل المنتجات المطلوبة في فواتير مفتوحة وليست متاحة في المخزون أو أوامر الشراء الحالية."
                  : "Every product needed by open invoices that isn't covered by stock or existing POs."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="h-4 w-4 me-2" />
              {ar ? "تحديث" : "Refresh"}
            </Button>
            <Button variant="outline" size="sm" onClick={copySummary} disabled={filtered.length === 0}>
              <Copy className="h-4 w-4 me-2" />
              {ar ? "نسخ" : "Copy"}
            </Button>
            <Button variant="outline" size="sm" onClick={downloadCsv} disabled={filtered.length === 0}>
              <Download className="h-4 w-4 me-2" />
              CSV
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <KPI label={ar ? "منتجات في نقص" : "Products short"} value={totals.lines} tone="amber" />
          <KPI label={ar ? "إجمالي المطلوب" : "Total needed"} value={totals.needed} tone="rose" />
          <KPI label={ar ? "قادم في PO" : "Incoming in POs"} value={totals.incoming} tone="emerald" />
          <KPI label={ar ? "نقص فعلي" : "Net shortage"} value={totals.shortage} tone="red" />
        </div>

        <div className="relative mt-4">
          <Search className="h-4 w-4 absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
          <Input
            className="ps-9"
            placeholder={ar ? "ابحث بالمنتج، سيريال، لون، فاتورة، عميل…" : "Search by product, serial, color, invoice, customer…"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* Body */}
      {loading && !rows ? (
        <div className="noir-surface gold-hairline rounded-2xl p-10 text-center text-muted-foreground">
          {ar ? "جاري التحميل…" : "Loading…"}
        </div>
      ) : filtered.length === 0 ? (
        <div className="noir-surface gold-hairline rounded-2xl p-10 text-center">
          <Package className="h-10 w-10 mx-auto mb-3 text-emerald-500" />
          <div className="font-semibold text-amber-100">
            {ar ? "لا يوجد نواقص" : "No shortages"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {ar
              ? "كل الفواتير المفتوحة مغطاة بالمخزون أو بأوامر الشراء الحالية."
              : "Every open invoice is covered by stock or an existing purchase order."}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const net = Math.max(0, r.needed_qty - r.incoming_qty);
            const isOpen = !!expanded[r.product_id];
            return (
              <div
                key={r.product_id}
                className="noir-surface gold-hairline rounded-2xl p-4 md:p-5 hover:border-amber-500/40 transition-colors"
              >
                <div className="flex items-start gap-4">
                  {r.image_url ? (
                    <img
                      src={r.image_url}
                      alt=""
                      loading="lazy"
                      className="h-20 w-20 md:h-24 md:w-24 rounded-lg object-cover border border-amber-500/20 shrink-0"
                    />
                  ) : (
                    <div className="h-20 w-20 md:h-24 md:w-24 rounded-lg border border-amber-500/20 flex items-center justify-center text-muted-foreground bg-black/30 shrink-0">
                      <Package className="h-8 w-8" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-amber-100 truncate">{r.product_name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                          {r.serial_number && <span>SN: {r.serial_number}</span>}
                          {r.color && <span>{r.color}</span>}
                          {r.collection && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">{r.collection}</span>}
                          {r.is_spare_part && (
                            <span className="px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-300">
                              {ar ? "قطعة غيار" : "Spare part"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <Chip label={ar ? "المخزون" : "Stock"} value={r.stock_quantity} tone="slate" />
                        <Chip label={ar ? "قادم" : "Incoming"} value={r.incoming_qty} tone="emerald" icon={<TruckIcon className="h-3 w-3" />} />
                        <Chip label={ar ? "مطلوب" : "Needed"} value={r.needed_qty} tone="amber" />
                        <Chip label={ar ? "نقص فعلي" : "Shortage"} value={net} tone={net > 0 ? "red" : "emerald"} bold />
                      </div>
                    </div>

                    <button
                      className="mt-3 text-xs text-amber-400 hover:text-amber-300 underline-offset-4 hover:underline"
                      onClick={() => setExpanded((p) => ({ ...p, [r.product_id]: !isOpen }))}
                    >
                      {isOpen
                        ? ar
                          ? "إخفاء الفواتير"
                          : "Hide invoices"
                        : ar
                          ? `عرض ${r.invoices.length} فاتورة`
                          : `Show ${r.invoices.length} invoice${r.invoices.length === 1 ? "" : "s"}`}
                    </button>

                    {isOpen && (
                      <div className="mt-3 rounded-lg border border-amber-500/15 divide-y divide-amber-500/10 overflow-hidden">
                        {r.invoices.map((inv) => (
                          <Link
                            key={inv.invoice_id}
                            to="/invoices/$id"
                            params={{ id: inv.invoice_id }}
                            className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-amber-500/5"
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-amber-100 truncate">{inv.invoice_number}</div>
                              <div className="text-xs text-muted-foreground truncate">
                                {inv.customer_name ?? (ar ? "بدون عميل" : "No customer")} ·{" "}
                                {new Date(inv.created_at).toLocaleDateString(ar ? "ar-EG-u-nu-latn" : "en-GB")}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-semibold text-rose-300">
                                {inv.quantity} {ar ? "قطعة" : inv.quantity === 1 ? "unit" : "units"}
                              </div>
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{inv.status}</div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KPI({ label, value, tone }: { label: string; value: number; tone: "amber" | "rose" | "emerald" | "red" }) {
  const toneMap: Record<string, string> = {
    amber: "text-amber-300 border-amber-500/25 bg-amber-500/5",
    rose: "text-rose-300 border-rose-500/25 bg-rose-500/5",
    emerald: "text-emerald-300 border-emerald-500/25 bg-emerald-500/5",
    red: "text-red-400 border-red-500/30 bg-red-500/5",
  };
  return (
    <div className={`rounded-xl border p-3 ${toneMap[tone]}`}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1 tabular-nums">{value.toLocaleString("en-GB")}</div>
    </div>
  );
}

function Chip({
  label,
  value,
  tone,
  icon,
  bold,
}: {
  label: string;
  value: number;
  tone: "slate" | "emerald" | "amber" | "red";
  icon?: React.ReactNode;
  bold?: boolean;
}) {
  const toneMap: Record<string, string> = {
    slate: "border-slate-500/30 text-slate-200 bg-slate-500/5",
    emerald: "border-emerald-500/30 text-emerald-300 bg-emerald-500/5",
    amber: "border-amber-500/30 text-amber-300 bg-amber-500/5",
    red: "border-red-500/40 text-red-300 bg-red-500/10",
  };
  return (
    <div className={`px-2.5 py-1 rounded-md border text-xs flex items-center gap-1.5 ${toneMap[tone]}`}>
      {icon}
      <span className="text-[10px] uppercase tracking-wider opacity-80">{label}</span>
      <span className={`tabular-nums ${bold ? "font-bold" : "font-semibold"}`}>{value.toLocaleString("en-GB")}</span>
    </div>
  );
}
