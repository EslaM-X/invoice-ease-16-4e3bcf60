import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useBatchedRealtimeTables } from "@/lib/realtime";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Download, Package, RefreshCw, Search, TruckIcon } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/inventory-tracker")({
  component: () => (
    <AppShell>
      <InventoryTrackerPage />
    </AppShell>
  ),
  head: () => ({
    meta: [
      { title: "متتبع المخزون | Inventory Tracker" },
      { name: "description", content: "متابعة لحظية لكل منتج: الرصيد الفعلي، المحجوز، المتاح، الخارج للتوصيل، القادم، والعجز." },
      { property: "og:title", content: "متتبع المخزون | Inventory Tracker" },
      { property: "og:description", content: "متابعة لحظية لكل منتج: الرصيد الفعلي، المحجوز، المتاح، الخارج للتوصيل، القادم، والعجز." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Row = {
  product_id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  collection: string | null;
  image_url: string | null;
  is_spare_part: boolean | null;
  stock_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  out_for_delivery_qty: number;
  incoming_qty: number;
  delivered_qty: number;
  sold_qty: number;
  open_demand_qty: number;
  shortage_qty: number;
  net_after_incoming: number;
  low_stock_threshold: number;
};

type Filter = "all" | "shortage" | "reserved" | "incoming" | "ofd" | "zero";

const n = (v: any) => Number(v ?? 0);

function InventoryTrackerPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_inventory_tracker" as any);
    if (error) {
      toast.error(error.message);
      setRows([]);
    } else {
      setRows(
        ((data as any[]) ?? []).map((r) => ({
          ...r,
          stock_quantity: n(r.stock_quantity),
          reserved_quantity: n(r.reserved_quantity),
          available_quantity: n(r.available_quantity),
          out_for_delivery_qty: n(r.out_for_delivery_qty),
          incoming_qty: n(r.incoming_qty),
          delivered_qty: n(r.delivered_qty),
          sold_qty: n(r.sold_qty),
          open_demand_qty: n(r.open_demand_qty),
          shortage_qty: n(r.shortage_qty),
          net_after_incoming: n(r.net_after_incoming),
          low_stock_threshold: n(r.low_stock_threshold),
        })) as Row[]
      );
      setUpdatedAt(new Date());
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useBatchedRealtimeTables(
    ["products", "invoice_items", "delivery_receipt_items", "delivery_receipts", "purchase_order_items"],
    load,
    1500
  );

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const term = q.trim().toLowerCase();
    return list.filter((r) => {
      if (term) {
        const hay = `${r.product_name} ${r.serial_number ?? ""} ${r.color ?? ""} ${r.collection ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (filter === "shortage") return r.shortage_qty > 0;
      if (filter === "reserved") return r.reserved_quantity > 0;
      if (filter === "incoming") return r.incoming_qty > 0;
      if (filter === "ofd") return r.out_for_delivery_qty > 0;
      if (filter === "zero") return r.stock_quantity <= 0;
      return true;
    });
  }, [rows, q, filter]);

  const totals = useMemo(() => {
    const list = rows ?? [];
    return {
      skus: list.length,
      stock: list.reduce((a, r) => a + r.stock_quantity, 0),
      reserved: list.reduce((a, r) => a + r.reserved_quantity, 0),
      available: list.reduce((a, r) => a + r.available_quantity, 0),
      ofd: list.reduce((a, r) => a + r.out_for_delivery_qty, 0),
      incoming: list.reduce((a, r) => a + r.incoming_qty, 0),
      shortageSkus: list.filter((r) => r.shortage_qty > 0).length,
      shortageUnits: list.reduce((a, r) => a + r.shortage_qty, 0),
    };
  }, [rows]);

  const exportCSV = () => {
    const headers = ar
      ? ["الكود", "المنتج", "المجموعة", "الرصيد", "محجوز", "متاح", "خارج للتوصيل", "قادم", "تم التسليم", "مباع", "طلب مفتوح", "عجز", "الصافي بعد القادم"]
      : ["Serial", "Product", "Collection", "Stock", "Reserved", "Available", "Out for delivery", "Incoming", "Delivered", "Sold", "Open demand", "Shortage", "Net after incoming"];
    const esc = (v: any) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")].concat(
      filtered.map((r) =>
        [
          r.serial_number ?? "",
          r.product_name,
          r.collection ?? "",
          r.stock_quantity,
          r.reserved_quantity,
          r.available_quantity,
          r.out_for_delivery_qty,
          r.incoming_qty,
          r.delivered_qty,
          r.sold_qty,
          r.open_demand_qty,
          r.shortage_qty,
          r.net_after_incoming,
        ]
          .map(esc)
          .join(",")
      )
    );
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-tracker-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const chips: { key: Filter; ar: string; en: string }[] = [
    { key: "all", ar: "الكل", en: "All" },
    { key: "shortage", ar: "عجز", en: "Shortage" },
    { key: "reserved", ar: "محجوز", en: "Reserved" },
    { key: "ofd", ar: "خارج للتوصيل", en: "Out for delivery" },
    { key: "incoming", ar: "قادم", en: "Incoming" },
    { key: "zero", ar: "رصيد صفر", en: "Zero stock" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{ar ? "متتبع المخزون" : "Inventory Tracker"}</h1>
          <p className="text-sm text-muted-foreground">
            {ar
              ? "صورة لحظية مطابقة للجرد الفعلي: الرصيد، المحجوز، المتاح، الخارج للتوصيل، القادم، والعجز."
              : "Live picture matching the physical count: stock, reserved, available, out for delivery, incoming and shortages."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span className="ms-2">{ar ? "تحديث" : "Refresh"}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!filtered.length}>
            <Download className="h-4 w-4" />
            <span className="ms-2">CSV</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Package className="h-3.5 w-3.5" /> {ar ? "أصناف / رصيد" : "SKUs / Stock"}
          </div>
          <div className="mt-1 text-2xl font-semibold">{totals.skus} / {totals.stock}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{ar ? "محجوز / متاح" : "Reserved / Available"}</div>
          <div className="mt-1 text-2xl font-semibold">{totals.reserved} / {totals.available}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TruckIcon className="h-3.5 w-3.5" /> {ar ? "خارج للتوصيل / قادم" : "OFD / Incoming"}
          </div>
          <div className="mt-1 text-2xl font-semibold">{totals.ofd} / {totals.incoming}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" /> {ar ? "أصناف بها عجز" : "Shortage SKUs"}
          </div>
          <div className="mt-1 text-2xl font-semibold text-destructive">
            {totals.shortageSkus} <span className="text-base">({totals.shortageUnits})</span>
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={ar ? "بحث بالكود أو الاسم…" : "Search serial or name…"}
            className="ps-9"
          />
        </div>
        {chips.map((c) => (
          <Button
            key={c.key}
            size="sm"
            variant={filter === c.key ? "default" : "outline"}
            onClick={() => setFilter(c.key)}
          >
            {ar ? c.ar : c.en}
          </Button>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="p-3 text-start">{ar ? "الكود" : "Serial"}</th>
              <th className="p-3 text-start">{ar ? "المنتج" : "Product"}</th>
              <th className="p-3 text-center">{ar ? "الرصيد" : "Stock"}</th>
              <th className="p-3 text-center">{ar ? "محجوز" : "Reserved"}</th>
              <th className="p-3 text-center">{ar ? "متاح" : "Available"}</th>
              <th className="p-3 text-center">{ar ? "خارج للتوصيل" : "OFD"}</th>
              <th className="p-3 text-center">{ar ? "قادم" : "Incoming"}</th>
              <th className="p-3 text-center">{ar ? "مباع" : "Sold"}</th>
              <th className="p-3 text-center">{ar ? "عجز" : "Shortage"}</th>
            </tr>
          </thead>
          <tbody>
            {loading && !rows ? (
              <tr>
                <td colSpan={9} className="p-6 text-center text-muted-foreground">
                  {ar ? "جاري التحميل…" : "Loading…"}
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-6 text-center text-muted-foreground">
                  {ar ? "لا توجد نتائج" : "No results"}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.product_id} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="p-3 font-mono text-xs">{r.serial_number ?? "—"}</td>
                  <td className="p-3">
                    <div className="font-medium">{r.product_name}</div>
                    {r.collection ? (
                      <Badge variant="outline" className="mt-1 text-[10px]">{r.collection}</Badge>
                    ) : null}
                  </td>
                  <td className="p-3 text-center font-semibold">{r.stock_quantity}</td>
                  <td className="p-3 text-center">{r.reserved_quantity}</td>
                  <td className={`p-3 text-center font-semibold ${r.available_quantity < 0 ? "text-destructive" : ""}`}>
                    {r.available_quantity}
                  </td>
                  <td className="p-3 text-center">{r.out_for_delivery_qty || "—"}</td>
                  <td className="p-3 text-center">{r.incoming_qty || "—"}</td>
                  <td className="p-3 text-center">{r.sold_qty || "—"}</td>
                  <td className="p-3 text-center">
                    {r.shortage_qty > 0 ? (
                      <Badge variant="destructive">-{r.shortage_qty}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {updatedAt ? (
        <p className="text-xs text-muted-foreground">
          {ar ? "آخر تحديث:" : "Last updated:"} {updatedAt.toLocaleTimeString()}
        </p>
      ) : null}
    </div>
  );
}
