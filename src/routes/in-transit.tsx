import { swatchStyle } from "@/lib/color-swatch";
import { ColorSwatch } from "@/components/color-swatch";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useBatchedRealtimeTables } from "@/lib/realtime";
import { fmtDateTime } from "@/lib/utils-money";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Truck, Package, Boxes, Search, Calendar, ShoppingBag, Warehouse, X, TrendingUp, AlertTriangle, AlertCircle, Bell, ChevronDown, ChevronUp, FileSpreadsheet, FileText } from "lucide-react";
import { POTrackerDialog, statusBadge } from "@/components/po-tracker-dialog";
import { RestockOrderDialog } from "@/components/restock-order-dialog";
import { COLLECTIONS } from "@/lib/data";
import { collectionPillClass, collectionDotClass } from "@/lib/collection-styles";
import { toast } from "sonner";
import { exportRowsToExcel, exportRowsToPDF, type ExportColumn } from "@/lib/critical-export";

export const Route = createFileRoute("/in-transit")({
  component: () => (
    <AppShell>
      <InTransitPage />
    </AppShell>
  ),
});

const IN_TRANSIT_STATUSES = ["ordered", "shipped", "in_warehouse"] as const;

type Product = {
  id: string;
  name: string;
  serial_number: string | null;
  color: string | null;
  image_url: string | null;
  stock_quantity: number;
  collection: string | null;
  low_stock_threshold: number;
  cost_price: number | null;
  price: number | null;
};

type POItem = {
  id: string;
  po_id: string;
  product_id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  image_url: string | null;
  quantity: number;
};

type PO = {
  id: string;
  po_number: string;
  supplier_name: string | null;
  status: string;
  expected_arrival_at: string | null;
  shipped_at: string | null;
};

function InTransitPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<POItem[]>([]);
  const [pos, setPos] = useState<Record<string, PO>>({});
  const [search, setSearch] = useState("");
  const [collectionFilter, setCollectionFilter] = useState<string>("");
  const [colorFilter, setColorFilter] = useState<string>("");
  const [trackId, setTrackId] = useState<string | null>(null);
  const [activeReservations, setActiveReservations] = useState<any[]>([]);
  const [soldByProduct, setSoldByProduct] = useState<Record<string, number>>({});
  const [reservedByProductMap, setReservedByProductMap] = useState<Record<string, number>>({});
  const [deliveredByProduct, setDeliveredByProduct] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<"transit" | "reserved">("transit");

  const load = async () => {
    const [{ data: prods }, { data: posRows }, { data: activeResv }, { data: sold }, { data: reservedRpc }] = await Promise.all([
      supabase.from("products").select("id,name,serial_number,color,image_url,stock_quantity,collection,low_stock_threshold,cost_price,price").limit(2000),
      supabase.from("purchase_orders").select("id,po_number,supplier_name,status,expected_arrival_at,shipped_at").in("status", IN_TRANSIT_STATUSES as any).limit(500),
      supabase.rpc("get_active_invoice_reservations" as any),
      supabase.rpc("get_sold_qty_by_product" as any),
      supabase.rpc("get_reserved_qty_by_product" as any),
    ]);
    setProducts((prods as any) ?? []);
    const posMap: Record<string, PO> = {};
    (posRows ?? []).forEach((p: any) => { posMap[p.id] = p; });
    setPos(posMap);
    setActiveReservations((activeResv as any) ?? []);
    const soldMap: Record<string, number> = {};
    ((sold as any) ?? []).forEach((row: any) => { soldMap[row.product_id] = Number(row.sold_qty || 0); });
    setSoldByProduct(soldMap);
    const reservedMap: Record<string, number> = {};
    ((reservedRpc as any) ?? []).forEach((row: any) => { reservedMap[row.product_id] = Number(row.reserved_qty || 0); });
    setReservedByProductMap(reservedMap);

    // Compute "delivered" per product from delivery_receipt_items, excluding cancelled receipts.
    // This is the authoritative number of units physically handed over via signed receipts.
    const { data: driRows } = await supabase
      .from("delivery_receipt_items" as any)
      .select("quantity, delivery_receipts!inner(status), invoice_items!inner(product_id)")
      .neq("delivery_receipts.status", "cancelled");
    const delivMap: Record<string, number> = {};
    ((driRows as any) ?? []).forEach((row: any) => {
      const pid = row.invoice_items?.product_id;
      if (!pid) return;
      delivMap[pid] = (delivMap[pid] ?? 0) + Number(row.quantity || 0);
    });
    setDeliveredByProduct(delivMap);

    const ids = Object.keys(posMap);
    if (ids.length > 0) {
      const { data: its } = await supabase
        .from("purchase_order_items")
        .select("id,po_id,product_id,product_name,serial_number,color,image_url,quantity")
        .in("po_id", ids);
      setItems((its as any) ?? []);
    } else {
      setItems([]);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);
  useBatchedRealtimeTables(
    ["purchase_orders", "purchase_order_items", "products", "invoice_items", "invoices", "delivery_receipts", "delivery_receipt_items"],
    () => { if (user) load(); },
    [user?.id],
  );


  const reservedTotalUnits = useMemo(
    () => activeReservations.reduce((s, r: any) => s + Number(r.reserved_qty || 0), 0),
    [activeReservations]
  );

  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    products.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  const rows = useMemo(() => {
    const m = new Map<string, {
      product_id: string;
      name: string;
      serial_number: string | null;
      color: string | null;
      image_url: string | null;
      collection: string | null;
      in_stock: number;
      in_transit: number;
      lines: { po: PO; qty: number; item: POItem }[];
    }>();
    products.forEach((p) => {
      m.set(p.id, {
        product_id: p.id,
        name: p.name,
        serial_number: p.serial_number,
        color: p.color,
        image_url: p.image_url,
        collection: p.collection ?? null,
        in_stock: p.stock_quantity ?? 0,
        in_transit: 0,
        lines: [],
      });
    });
    items.forEach((it) => {
      const po = pos[it.po_id];
      if (!po) return;
      const key = it.product_id;
      let r = m.get(key);
      if (!r) {
        const prod = productMap.get(key);
        r = {
          product_id: key,
          name: it.product_name,
          serial_number: it.serial_number,
          color: it.color,
          image_url: it.image_url,
          collection: prod?.collection ?? null,
          in_stock: 0,
          in_transit: 0,
          lines: [],
        };
        m.set(key, r);
      }
      r.in_transit += it.quantity || 0;
      r.lines.push({ po, qty: it.quantity || 0, item: it });
    });
    let arr = Array.from(m.values());
    if (collectionFilter) {
      if (collectionFilter === "__none__") arr = arr.filter((r) => !r.collection);
      else arr = arr.filter((r) => r.collection === collectionFilter);
    }
    if (colorFilter) {
      arr = arr.filter((r) => (r.color ?? "").toLowerCase() === colorFilter.toLowerCase());
    }
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        (r.serial_number ?? "").toLowerCase().includes(q) ||
        (r.color ?? "").toLowerCase().includes(q) ||
        (r.collection ?? "").toLowerCase().includes(q)
      );
    }
    arr.sort((a, b) => (b.in_transit - a.in_transit) || (b.in_stock - a.in_stock));
    return arr;
  }, [products, items, pos, productMap, search, collectionFilter, colorFilter]);

  // Counts based on full set (after collection filter for color counts to make sense)
  const collectionCounts = useMemo(() => {
    const counts: Record<string, number> = { __all__: 0, __none__: 0 };
    COLLECTIONS.forEach((c) => (counts[c] = 0));
    const seen = new Set<string>();
    products.forEach((p) => { seen.add(p.id); });
    items.forEach((it) => seen.add(it.product_id));
    seen.forEach((id) => {
      const prod = productMap.get(id);
      counts.__all__++;
      const c = prod?.collection;
      if (c && counts[c] !== undefined) counts[c]++;
      else if (!c) counts.__none__++;
    });
    return counts;
  }, [products, items, productMap]);

  const colorOptions = useMemo(() => {
    const map = new Map<string, number>();
    const consider = (color: string | null, collection: string | null) => {
      if (!color) return;
      if (collectionFilter) {
        if (collectionFilter === "__none__" && collection) return;
        if (collectionFilter !== "__none__" && collection !== collectionFilter) return;
      }
      map.set(color, (map.get(color) ?? 0) + 1);
    };
    products.forEach((p) => consider(p.color, p.collection ?? null));
    items.forEach((it) => {
      const prod = productMap.get(it.product_id);
      // skip if already counted via products
      if (prod) return;
      consider(it.color, null);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).map(([color, count]) => ({ color, count }));
  }, [products, items, productMap, collectionFilter]);

  const totals = useMemo(() => {
    let inStock = 0, inTransit = 0, transitProducts = 0, reserved = 0, sold = 0;
    rows.forEach((r) => {
      inStock += r.in_stock;
      inTransit += r.in_transit;
      if (r.in_transit > 0) transitProducts++;
      reserved += reservedByProductMap[r.product_id] ?? 0;
      sold += soldByProduct[r.product_id] ?? 0;
    });
    return { inStock, inTransit, transitProducts, reserved, sold };
  }, [rows, reservedByProductMap, soldByProduct]);

  // ====== Smart alerts ======
  // critical: reserved in invoices, but 0 in stock AND 0 incoming  → must order NOW
  // shortfall: reserved > in_stock + in_transit                    → partial coverage
  // covered: reserved > in_stock (covered only by incoming)        → info
  type Alert = {
    product: Product;
    reserved: number;
    inStock: number;
    inTransit: number;
    shortBy: number; // reserved - (inStock + inTransit), clamped >=0
    severity: "critical" | "shortfall" | "covered";
  };
  const alerts = useMemo<Alert[]>(() => {
    const out: Alert[] = [];
    products.forEach((p) => {
      const reserved = reservedByProductMap[p.id] ?? 0;
      if (reserved <= 0) return;
      const inStock = p.stock_quantity ?? 0;
      const inTransit = rows.find((r) => r.product_id === p.id)?.in_transit ?? 0;
      const coverage = inStock + inTransit;
      if (reserved <= inStock) return; // fully covered by stock
      const shortBy = Math.max(0, reserved - coverage);
      let severity: Alert["severity"];
      if (inStock === 0 && inTransit === 0) severity = "critical";
      else if (reserved > coverage) severity = "shortfall";
      else severity = "covered";
      out.push({ product: p, reserved, inStock, inTransit, shortBy, severity });
    });
    const rank = { critical: 0, shortfall: 1, covered: 2 } as const;
    out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.shortBy - a.shortBy || b.reserved - a.reserved);
    return out;
  }, [products, rows, reservedByProductMap]);

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const shortfallCount = alerts.filter((a) => a.severity === "shortfall").length;
  const coveredCount = alerts.filter((a) => a.severity === "covered").length;

  const [alertsOpen, setAlertsOpen] = useState(true);
  const [restockOpen, setRestockOpen] = useState(false);
  const [restockPid, setRestockPid] = useState<string | null>(null);
  const seenCritsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(alerts.filter((a) => a.severity === "critical").map((a) => a.product.id));
    if (seenCritsRef.current === null) {
      seenCritsRef.current = ids;
      return;
    }
    const fresh: Alert[] = [];
    alerts.forEach((a) => {
      if (a.severity === "critical" && !seenCritsRef.current!.has(a.product.id)) fresh.push(a);
    });
    if (fresh.length > 0) {
      fresh.slice(0, 3).forEach((a) => {
        toast(isAr ? "⚠️ منتج محجوز وغير متوفر" : "⚠️ Reserved product unavailable", {
          duration: 12000,
          description: (
            <div className="space-y-0.5 text-xs">
              <div className="font-semibold text-foreground">{a.product.name}</div>
              {a.product.serial_number && <div className="font-mono text-muted-foreground">S/N: {a.product.serial_number}</div>}
              <div className="text-destructive font-semibold">
                {isAr
                  ? `محجوز ${a.reserved} · في المخزن 0 · قادم 0 — اطلبه فورًا`
                  : `Reserved ${a.reserved} · in stock 0 · incoming 0 — order now`}
              </div>
            </div>
          ),
        });
      });
    }
    seenCritsRef.current = ids;
  }, [alerts, isAr]);

  const openRestock = (pid: string) => { setRestockPid(pid); setRestockOpen(true); };

  const alertColumns: ExportColumn<typeof alerts[number]>[] = [
    { header: isAr ? "الخطورة" : "Severity", value: (a) => a.severity, width: 12 },
    { header: isAr ? "اسم المنتج" : "Product Name", value: (a) => a.product.name, width: 40 },
    { header: "S/N", value: (a) => a.product.serial_number ?? "", width: 18 },
    { header: isAr ? "اللون" : "Color", value: (a) => a.product.color ?? "", width: 14 },
    { header: isAr ? "المجموعة" : "Collection", value: (a) => a.product.collection ?? "", width: 16 },
    { header: isAr ? "محجوز" : "Reserved", value: (a) => a.reserved, width: 10 },
    { header: isAr ? "بالمخزن" : "In Stock", value: (a) => a.inStock, width: 10 },
    { header: isAr ? "قادم" : "Incoming", value: (a) => a.inTransit, width: 10 },
    { header: isAr ? "النقص" : "Short By", value: (a) => a.shortBy, width: 10 },
    { header: isAr ? "سعر التكلفة" : "Cost Price", value: (a) => Number(a.product.cost_price ?? 0), width: 14 },
    { header: isAr ? "سعر البيع" : "Sale Price", value: (a) => Number(a.product.price ?? 0), width: 14 },
    { header: isAr ? "قيمة النقص" : "Shortfall Value", value: (a) => Math.round(a.shortBy * Number(a.product.cost_price ?? a.product.price ?? 0) * 100) / 100, width: 16 },
    { header: "Product ID", value: (a) => a.product.id, width: 38 },
  ];
  const exportAlertsExcel = () => exportRowsToExcel(alerts, alertColumns, {
    fileName: "inventory_alerts_critical_and_shortfall",
    sheetName: isAr ? "تنبيهات" : "Alerts",
    title: isAr ? "تنبيهات المخزون — الحرج والنقص" : "Inventory Alerts — Critical & Shortfall",
  });
  const exportAlertsPDF = () => exportRowsToPDF(alerts, alertColumns, {
    fileName: "inventory_alerts_critical_and_shortfall",
    title: isAr ? "تنبيهات المخزون — الحرج والنقص" : "Inventory Alerts — Critical & Shortfall",
    orientation: "l",
  });




  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-violet-500/10 via-primary/5 to-transparent p-5">
        <div className="absolute -end-12 -top-12 h-44 w-44 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="relative">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/15 text-violet-700 shadow-sm">
              <Truck className="h-5 w-5" />
            </span>
            {isAr ? "متتبع المخزون" : "Inventory Tracker"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {isAr
              ? "كل منتج بكميته الموجودة في المخزن وكمياته القادمة من أوامر الشراء (تم الطلب / تم الشحن / في المخزن)."
              : "Every product with on-hand stock and incoming quantities from active POs (Ordered / Shipped / In Warehouse)."}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard icon={Boxes} label={isAr ? "إجمالي المخزون" : "Total in stock"} value={totals.inStock} color="text-emerald-600" bg="bg-emerald-500/10" />
        <SummaryCard icon={Truck} label={isAr ? "إجمالي في الطريق" : "Total in transit"} value={totals.inTransit} color="text-violet-600" bg="bg-violet-500/10" />
        <SummaryCard icon={Package} label={isAr ? "منتجات قادمة" : "Products incoming"} value={totals.transitProducts} color="text-primary" bg="bg-primary/10" />
        <SummaryCard icon={ShoppingBag} label={isAr ? "محجوز في فواتير" : "Reserved in invoices"} value={totals.reserved} color="text-amber-600" bg="bg-amber-500/10" />
        <SummaryCard icon={TrendingUp} label={isAr ? "إجمالي المباع" : "Total sold"} value={totals.sold} color="text-blue-600" bg="bg-blue-500/10" />
      </div>

      {alerts.length > 0 && (
        <Card className={`overflow-hidden border-2 ${criticalCount > 0 ? "border-destructive/40 bg-destructive/5" : shortfallCount > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-blue-500/30 bg-blue-500/5"}`}>
          <button
            type="button"
            onClick={() => setAlertsOpen((v) => !v)}
            className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-muted/30"
          >
            <div className={`relative grid h-10 w-10 place-items-center rounded-xl ${criticalCount > 0 ? "bg-destructive/15 text-destructive" : shortfallCount > 0 ? "bg-amber-500/15 text-amber-700" : "bg-blue-500/15 text-blue-700"}`}>
              <Bell className="h-5 w-5" />
              {criticalCount > 0 && (
                <span className="absolute -end-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                  {criticalCount}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
                {isAr ? "تنبيهات ذكية للحجوزات" : "Smart reservation alerts"}
                {criticalCount > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertCircle className="h-3 w-3" /> {criticalCount} {isAr ? "حرج" : "critical"}
                  </Badge>
                )}
                {shortfallCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                    <AlertTriangle className="h-3 w-3" /> {shortfallCount} {isAr ? "نقص" : "shortfall"}
                  </span>
                )}
                {coveredCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                    {coveredCount} {isAr ? "بانتظار وصول" : "awaiting arrival"}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {isAr
                  ? "منتجات محجوزة في فواتير لكن لا تغطيها كمية المخزن الحالية"
                  : "Products reserved in invoices that on-hand stock alone cannot cover"}
              </div>
            </div>
            {alertsOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>

          {alertsOpen && alerts.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-background/40 px-4 py-2">
              <span className="me-auto text-[11px] text-muted-foreground">
                {isAr ? `تصدير الكل (${alerts.length} منتج) — يشمل كل البيانات حتى لو آلاف المنتجات.` : `Export all (${alerts.length} items) — full details, scales to thousands of products.`}
              </span>
              <Button size="sm" variant="outline" onClick={exportAlertsExcel}>
                <FileSpreadsheet className="h-3.5 w-3.5 me-1" /> Excel
              </Button>
              <Button size="sm" variant="outline" onClick={exportAlertsPDF}>
                <FileText className="h-3.5 w-3.5 me-1" /> PDF
              </Button>
            </div>
          )}

          {alertsOpen && (
            <div className="divide-y border-t">
              {alerts.map((a) => {
                const tone =
                  a.severity === "critical"
                    ? { wrap: "bg-destructive/5", chip: "bg-destructive text-destructive-foreground", icon: AlertCircle, label: isAr ? "اطلبه فورًا" : "Order now", text: "text-destructive" }
                    : a.severity === "shortfall"
                      ? { wrap: "", chip: "bg-amber-500 text-white", icon: AlertTriangle, label: isAr ? "نقص في التغطية" : "Shortfall", text: "text-amber-700" }
                      : { wrap: "", chip: "bg-blue-500 text-white", icon: Truck, label: isAr ? "بانتظار وصول الشحنة" : "Awaiting arrival", text: "text-blue-700" };
                const Icon = tone.icon;
                return (
                  <div key={a.product.id} className={`flex flex-wrap items-center gap-3 p-3 ${tone.wrap}`}>
                    <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded border bg-muted">
                      {a.product.image_url ? <img src={a.product.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Package className="h-full w-full p-2 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{a.product.name}</div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        {a.product.serial_number && <span className="font-mono">S/N: {a.product.serial_number}</span>}
                        {a.product.color && (
                          <span className="inline-flex items-center gap-1">
                            <ColorSwatch value={a.product.color} size="sm" />{a.product.color}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-bold text-amber-700">
                          {isAr ? "محجوز" : "Reserved"}: {a.reserved}
                        </span>
                        <span className={`rounded px-1.5 py-0.5 font-bold ${a.inStock > 0 ? "bg-emerald-500/15 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                          {isAr ? "بالمخزن" : "Stock"}: {a.inStock}
                        </span>
                        <span className={`rounded px-1.5 py-0.5 font-bold ${a.inTransit > 0 ? "bg-violet-500/15 text-violet-700" : "bg-muted text-muted-foreground"}`}>
                          {isAr ? "قادم" : "Incoming"}: {a.inTransit}
                        </span>
                        {a.shortBy > 0 && (
                          <span className="rounded bg-destructive/15 px-1.5 py-0.5 font-bold text-destructive">
                            {isAr ? "ناقص" : "Short by"}: {a.shortBy}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${tone.chip}`}>
                      <Icon className="h-3 w-3" /> {tone.label}
                    </span>
                    <Button
                      size="sm"
                      variant={a.severity === "critical" ? "destructive" : "outline"}
                      onClick={() => openRestock(a.product.id)}
                    >
                      <ShoppingBag className="h-3.5 w-3.5 me-1" />
                      {isAr ? "اطلب الآن" : "Order now"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}


      <div className="flex gap-2 border-b">
        <button
          onClick={() => setTab("transit")}
          className={`px-4 py-2 text-sm font-semibold transition border-b-2 -mb-px ${tab === "transit" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {isAr ? "القادم في الطريق" : "Incoming"}
        </button>
        <button
          onClick={() => setTab("reserved")}
          className={`px-4 py-2 text-sm font-semibold transition border-b-2 -mb-px ${tab === "reserved" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {isAr ? "المحجوز للفواتير" : "Reserved for Invoices"} ({reservedTotalUnits})
        </button>
      </div>

      {tab === "transit" && (<>
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? "ابحث باسم المنتج / السيريال / اللون / الكولكشن..." : "Search by name / serial / color / collection..."}
            className="ps-9"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCollectionFilter("")}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${collectionFilter === "" ? "bg-primary text-primary-foreground shadow" : "bg-muted hover:bg-muted/70"}`}
          >
            {isAr ? "كل الكولكشن" : "All collections"} ({collectionCounts.__all__})
          </button>
          {COLLECTIONS.map((c) => (
            <button
              key={c}
              onClick={() => setCollectionFilter(c)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${collectionPillClass(c, collectionFilter === c)}`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${collectionDotClass(c)}`} aria-hidden />
              {c} ({collectionCounts[c] ?? 0})
            </button>
          ))}
          {collectionCounts.__none__ > 0 && (
            <button
              onClick={() => setCollectionFilter("__none__")}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${collectionFilter === "__none__" ? "bg-primary text-primary-foreground shadow" : "bg-muted hover:bg-muted/70"}`}
            >
              {isAr ? "بدون كولكشن" : "No collection"} ({collectionCounts.__none__})
            </button>
          )}
        </div>

        {colorOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {isAr ? "اللون" : "Color"}
            </span>
            <button
              onClick={() => setColorFilter("")}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${colorFilter === "" ? "bg-primary text-primary-foreground shadow" : "bg-muted hover:bg-muted/70"}`}
            >
              {isAr ? "الكل" : "All"}
            </button>
            {colorOptions.map(({ color, count }) => {
              const active = colorFilter.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={color}
                  onClick={() => setColorFilter(active ? "" : color)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted hover:bg-muted/70"}`}
                  title={color}
                >
                  <ColorSwatch value={color} size="sm" />
                  <span className="max-w-[80px] truncate">{color}</span>
                  <span className="text-muted-foreground">({count})</span>
                </button>
              );
            })}
            {colorFilter && (
              <button
                onClick={() => setColorFilter("")}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] hover:bg-muted/70"
                aria-label="clear"
              >
                <X className="h-3 w-3" /> {isAr ? "مسح" : "Clear"}
              </button>
            )}
          </div>
        )}
      </div>


      <Card className="overflow-hidden">
        <div className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {rows.length} {isAr ? "منتج" : "products"}
        </div>
        <div className="divide-y">
          {rows.length === 0 && (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {isAr ? "لا توجد منتجات." : "No products."}
            </div>
          )}
          {rows.map((r) => (
            <div key={r.product_id} className="p-3 sm:p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded border bg-muted">
                  {r.image_url ? <img src={r.image_url} alt={r.name} className="h-full w-full object-cover" loading="lazy" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <Link to="/products" className="block truncate text-sm font-semibold hover:underline">
                    {r.name}
                  </Link>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {r.serial_number && <span className="font-mono">S/N: {r.serial_number}</span>}
                    {r.color && (
                      <span className="inline-flex items-center gap-1.5">
                        <ColorSwatch value={r.color} size="md" />
                        {r.color}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-md bg-emerald-500/10 px-3 py-1.5 text-end">
                    <div className="text-[10px] font-medium text-emerald-700">{isAr ? "في المخزن" : "In stock"}</div>
                    <div className="text-lg font-bold tabular-nums text-emerald-700">{r.in_stock}</div>
                  </div>
                  <div className={`rounded-md px-3 py-1.5 text-end ${r.in_transit > 0 ? "bg-violet-500/10" : "bg-muted/40"}`}>
                    <div className={`text-[10px] font-medium ${r.in_transit > 0 ? "text-violet-700" : "text-muted-foreground"}`}>
                      {isAr ? "قادم في الطريق" : "Incoming"}
                    </div>
                    <div className={`text-lg font-bold tabular-nums ${r.in_transit > 0 ? "text-violet-700" : "text-muted-foreground"}`}>
                      {r.in_transit}
                    </div>
                  </div>
                  {(() => { const rv = reservedByProductMap[r.product_id] ?? 0; return (
                    <div className={`rounded-md px-3 py-1.5 text-end ${rv > 0 ? "bg-amber-500/10" : "bg-muted/40"}`}>
                      <div className={`text-[10px] font-medium ${rv > 0 ? "text-amber-700" : "text-muted-foreground"}`}>
                        {isAr ? "محجوز في فواتير" : "Reserved"}
                      </div>
                      <div className={`text-lg font-bold tabular-nums ${rv > 0 ? "text-amber-700" : "text-muted-foreground"}`}>
                        {rv}
                      </div>
                    </div>
                  ); })()}
                  {(() => { const sv = soldByProduct[r.product_id] ?? 0; return (
                    <div className={`rounded-md px-3 py-1.5 text-end ${sv > 0 ? "bg-blue-500/10" : "bg-muted/40"}`}>
                      <div className={`text-[10px] font-medium ${sv > 0 ? "text-blue-700" : "text-muted-foreground"}`}>
                        {isAr ? "تم بيعه" : "Sold"}
                      </div>
                      <div className={`text-lg font-bold tabular-nums ${sv > 0 ? "text-blue-700" : "text-muted-foreground"}`}>
                        {sv}
                      </div>
                    </div>
                  ); })()}
                  {(() => { const dv = deliveredByProduct[r.product_id] ?? 0; return (
                    <div className={`rounded-md px-3 py-1.5 text-end ${dv > 0 ? "bg-teal-500/10" : "bg-muted/40"}`}>
                      <div className={`text-[10px] font-medium ${dv > 0 ? "text-teal-700" : "text-muted-foreground"}`}>
                        {isAr ? "تم تسليمه" : "Delivered"}
                      </div>
                      <div className={`text-lg font-bold tabular-nums ${dv > 0 ? "text-teal-700" : "text-muted-foreground"}`}>
                        {dv}
                      </div>
                    </div>
                  ); })()}
                </div>
              </div>

              {r.lines.length > 0 && (
                <div className="mt-3 space-y-1.5 ps-[68px]">
                  {r.lines.map((l, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setTrackId(l.po.id)}
                        className="font-mono font-semibold text-primary hover:underline"
                      >
                        {l.po.po_number}
                      </button>
                      {statusBadge(l.po.status, isAr)}
                      <span className="text-muted-foreground">·</span>
                      <span>{l.po.supplier_name || (isAr ? "بدون مورد" : "No supplier")}</span>
                      {l.po.expected_arrival_at && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="inline-flex items-center gap-1 text-violet-700">
                            <Calendar className="h-3 w-3" />
                            {isAr ? "وصول متوقع:" : "ETA:"} {fmtDateTime(l.po.expected_arrival_at, lang)}
                          </span>
                        </>
                      )}
                      <span className="ms-auto inline-flex items-center gap-1 font-semibold tabular-nums">
                        {l.po.status === "in_warehouse" ? <Warehouse className="h-3 w-3" /> : l.po.status === "shipped" ? <Truck className="h-3 w-3" /> : <ShoppingBag className="h-3 w-3" />}
                        {l.qty} {isAr ? "قطعة" : "units"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
      </>
      )}

      {tab === "reserved" && (() => {
        // Enrich reservations with product info, then filter
        const enriched = activeReservations.map((r: any) => {
          const prod = productMap.get(r.product_id);
          return { ...r, _prod: prod, _color: prod?.color ?? null, _collection: prod?.collection ?? null };
        });
        // Collection counts within reservations
        const rColCounts: Record<string, number> = { __all__: enriched.length, __none__: 0 };
        COLLECTIONS.forEach((c) => (rColCounts[c] = 0));
        enriched.forEach((r) => {
          const c = r._collection;
          if (c && rColCounts[c] !== undefined) rColCounts[c]++;
          else if (!c) rColCounts.__none__++;
        });
        // Color counts (after collection filter)
        const colorMap = new Map<string, number>();
        enriched.forEach((r) => {
          if (collectionFilter) {
            if (collectionFilter === "__none__" && r._collection) return;
            if (collectionFilter !== "__none__" && r._collection !== collectionFilter) return;
          }
          if (!r._color) return;
          colorMap.set(r._color, (colorMap.get(r._color) ?? 0) + 1);
        });
        const rColors = Array.from(colorMap.entries()).sort((a, b) => b[1] - a[1]);
        // Filter
        const filteredR = enriched.filter((r) => {
          if (collectionFilter) {
            if (collectionFilter === "__none__" && r._collection) return false;
            if (collectionFilter !== "__none__" && r._collection !== collectionFilter) return false;
          }
          if (colorFilter && (r._color ?? "").toLowerCase() !== colorFilter.toLowerCase()) return false;
          return true;
        });
        const filteredUnits = filteredR.reduce((s: number, r: any) => s + Number(r.reserved_qty || 0), 0);
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setCollectionFilter("")}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${collectionFilter === "" ? "bg-primary text-primary-foreground shadow" : "bg-muted hover:bg-muted/70"}`}
              >
                {isAr ? "كل الكولكشن" : "All collections"} ({rColCounts.__all__})
              </button>
              {COLLECTIONS.map((c) => (
                rColCounts[c] > 0 && (
                  <button
                    key={c}
                    onClick={() => setCollectionFilter(c)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${collectionPillClass(c, collectionFilter === c)}`}
                  >
                    <span className={`inline-block h-2 w-2 rounded-full ${collectionDotClass(c)}`} aria-hidden />
                    {c} ({rColCounts[c]})
                  </button>
                )
              ))}
              {rColCounts.__none__ > 0 && (
                <button
                  onClick={() => setCollectionFilter("__none__")}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${collectionFilter === "__none__" ? "bg-primary text-primary-foreground shadow" : "bg-muted hover:bg-muted/70"}`}
                >
                  {isAr ? "بدون كولكشن" : "No collection"} ({rColCounts.__none__})
                </button>
              )}
            </div>

            {rColors.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {isAr ? "اللون" : "Color"}
                </span>
                <button
                  onClick={() => setColorFilter("")}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${colorFilter === "" ? "bg-primary text-primary-foreground shadow" : "bg-muted hover:bg-muted/70"}`}
                >
                  {isAr ? "الكل" : "All"}
                </button>
                {rColors.map(([color, count]) => {
                  const active = colorFilter.toLowerCase() === color.toLowerCase();
                  return (
                    <button
                      key={color}
                      onClick={() => setColorFilter(active ? "" : color)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted hover:bg-muted/70"}`}
                      title={color}
                    >
                      <ColorSwatch value={color} size="sm" />
                      <span className="max-w-[80px] truncate">{color}</span>
                      <span className="text-muted-foreground">({count})</span>
                    </button>
                  );
                })}
                {(colorFilter || collectionFilter) && (
                  <button
                    onClick={() => { setColorFilter(""); setCollectionFilter(""); }}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] hover:bg-muted/70"
                  >
                    <X className="h-3 w-3" /> {isAr ? "مسح الفلتر" : "Clear filters"}
                  </button>
                )}
              </div>
            )}

            <Card className="overflow-hidden">
              <div className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {filteredR.length} {isAr ? "بند فاتورة" : "invoice lines"} · {filteredUnits} {isAr ? "قطعة محجوزة" : "units reserved"}
              </div>
              <div className="divide-y">
                {filteredR.length === 0 && (
                  <div className="p-10 text-center text-sm text-muted-foreground">
                    {isAr ? "لا توجد حجوزات مطابقة." : "No matching reservations."}
                  </div>
                )}
                {filteredR.map((r: any) => {
                  const prod = r._prod as Product | undefined;
                  return (
                    <div key={r.invoice_item_id} className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
                      <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded border bg-muted">
                        {prod?.image_url ? <img src={prod.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{prod?.name ?? r.product_name ?? "—"}</div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          {prod?.serial_number && <span className="font-mono">S/N: {prod.serial_number}</span>}
                          {prod?.color && (
                            <span className="inline-flex items-center gap-1.5">
                              <ColorSwatch value={prod.color} size="sm" />{prod.color}
                            </span>
                          )}
                          {prod?.collection && (
                            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 ${collectionPillClass(prod.collection, false)}`}>
                              <span className={`inline-block h-1.5 w-1.5 rounded-full ${collectionDotClass(prod.collection)}`} aria-hidden />
                              {prod.collection}
                            </span>
                          )}
                          <span>{fmtDateTime(r.created_at, lang)}</span>
                        </div>
                      </div>
                      <Link
                        to="/invoices/$id"
                        params={{ id: r.invoice_id }}
                        className="rounded-md bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20"
                      >
                        #{r.invoice_number} · {r.customer_name || (isAr ? "بدون اسم" : "No name")}
                      </Link>
                      <div className="rounded-md bg-amber-500/10 px-3 py-1.5 text-end">
                        <div className="text-[10px] font-medium text-amber-700">{isAr ? "محجوز" : "Reserved"}</div>
                        <div className="text-lg font-bold tabular-nums text-amber-700">{r.reserved_qty}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        );
      })()}


      {trackId && (
        <POTrackerDialog
          poId={trackId}
          open={!!trackId}
          onOpenChange={(v) => { if (!v) setTrackId(null); }}
        />
      )}

      <RestockOrderDialog
        open={restockOpen}
        onOpenChange={setRestockOpen}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          serial_number: p.serial_number,
          color: p.color,
          stock_quantity: p.stock_quantity,
          low_stock_threshold: p.low_stock_threshold ?? 0,
          cost_price: p.cost_price ?? 0,
          price: p.price ?? 0,
          image_url: p.image_url,
        }))}
        initialProductId={restockPid}
      />
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color, bg }: { icon: any; label: string; value: number; color: string; bg: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={`grid h-10 w-10 place-items-center rounded-lg ${bg} ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-2xl font-bold tabular-nums">{value}</div>
        </div>
      </div>
    </Card>
  );
}
