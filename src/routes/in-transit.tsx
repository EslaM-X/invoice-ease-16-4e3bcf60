import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtDateTime } from "@/lib/utils-money";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Truck, Package, Boxes, Search, Calendar, ShoppingBag, Warehouse, X } from "lucide-react";
import { POTrackerDialog, statusBadge } from "@/components/po-tracker-dialog";
import { COLLECTIONS } from "@/lib/data";
import { collectionPillClass, collectionDotClass } from "@/lib/collection-styles";

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
  const [trackId, setTrackId] = useState<string | null>(null);

  const load = async () => {
    const [{ data: prods }, { data: posRows }] = await Promise.all([
      supabase.from("products").select("id,name,serial_number,color,image_url,stock_quantity").limit(2000),
      supabase.from("purchase_orders").select("id,po_number,supplier_name,status,expected_arrival_at,shipped_at").in("status", IN_TRANSIT_STATUSES as any).limit(500),
    ]);
    setProducts((prods as any) ?? []);
    const posMap: Record<string, PO> = {};
    (posRows ?? []).forEach((p: any) => { posMap[p.id] = p; });
    setPos(posMap);
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
  useRealtimeTable("purchase_orders", () => { if (user) load(); });
  useRealtimeTable("purchase_order_items", () => { if (user) load(); });
  useRealtimeTable("products", () => { if (user) load(); });

  // Aggregate per product
  const rows = useMemo(() => {
    const m = new Map<string, {
      product_id: string;
      name: string;
      serial_number: string | null;
      color: string | null;
      image_url: string | null;
      in_stock: number;
      in_transit: number;
      lines: { po: PO; qty: number; item: POItem }[];
    }>();
    // Seed with all products that have either stock or in-transit
    products.forEach((p) => {
      m.set(p.id, {
        product_id: p.id,
        name: p.name,
        serial_number: p.serial_number,
        color: p.color,
        image_url: p.image_url,
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
        r = {
          product_id: key,
          name: it.product_name,
          serial_number: it.serial_number,
          color: it.color,
          image_url: it.image_url,
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
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        (r.serial_number ?? "").toLowerCase().includes(q) ||
        (r.color ?? "").toLowerCase().includes(q)
      );
    }
    // Sort: in_transit first desc, then in_stock
    arr.sort((a, b) => (b.in_transit - a.in_transit) || (b.in_stock - a.in_stock));
    return arr;
  }, [products, items, pos, search]);

  const totals = useMemo(() => {
    let inStock = 0, inTransit = 0, transitProducts = 0;
    rows.forEach((r) => {
      inStock += r.in_stock;
      inTransit += r.in_transit;
      if (r.in_transit > 0) transitProducts++;
    });
    return { inStock, inTransit, transitProducts };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-violet-500/10 via-primary/5 to-transparent p-5">
        <div className="absolute -end-12 -top-12 h-44 w-44 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="relative">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/15 text-violet-700 shadow-sm">
              <Truck className="h-5 w-5" />
            </span>
            {isAr ? "المنتجات: المخزون والقادم" : "Products: Stock & In-Transit"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {isAr
              ? "كل منتج بكميته الموجودة في المخزن وكمياته القادمة من أوامر الشراء (تم الطلب / تم الشحن / في المخزن)."
              : "Every product with on-hand stock and incoming quantities from active POs (Ordered / Shipped / In Warehouse)."}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={Boxes} label={isAr ? "إجمالي المخزون" : "Total in stock"} value={totals.inStock} color="text-emerald-600" bg="bg-emerald-500/10" />
        <SummaryCard icon={Truck} label={isAr ? "إجمالي في الطريق" : "Total in transit"} value={totals.inTransit} color="text-violet-600" bg="bg-violet-500/10" />
        <SummaryCard icon={Package} label={isAr ? "منتجات قادمة" : "Products incoming"} value={totals.transitProducts} color="text-primary" bg="bg-primary/10" />
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={isAr ? "ابحث باسم المنتج / السيريال / اللون..." : "Search by name / serial / color..."}
          className="ps-9"
        />
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
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full border" style={{ background: r.color }} />
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

      {trackId && (
        <POTrackerDialog
          poId={trackId}
          open={!!trackId}
          onOpenChange={(v) => { if (!v) setTrackId(null); }}
        />
      )}
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
