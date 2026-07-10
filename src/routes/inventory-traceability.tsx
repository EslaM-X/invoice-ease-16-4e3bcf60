import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtDateTime } from "@/lib/utils-money";
import {
  AlertTriangle, CheckCircle2, PackageCheck, Search, History, ShieldCheck,
  BarChart3, ArrowRight, X, Package, ArrowDownWideNarrow, ArrowUpWideNarrow,
} from "lucide-react";
import { useRealtimeTable } from "@/lib/realtime";

export const Route = createFileRoute("/inventory-traceability")({
  component: () => (
    <AppShell>
      <Traceability />
    </AppShell>
  ),
});

type Reservation = {
  id: string;
  invoice_id: string;
  invoice_item_id: string;
  product_id: string;
  po_id: string;
  po_item_id: string;
  quantity: number;
  status: string;
  created_at: string;
  fulfilled_at: string | null;
};
type InvItem = { id: string; invoice_id: string; product_id: string | null; product_name: string; quantity: number };
type Invoice = { id: string; invoice_number: string; status: string; created_at: string; customer_name: string | null };
type Product = { id: string; name: string; serial_number?: string | null; color?: string | null; collection?: string | null; stock_quantity?: number; low_stock_threshold?: number; image_url?: string | null };
type PO = { id: string; po_number: string; status: string };
type DRItem = {
  id: string; receipt_id: string; invoice_item_id: string; product_name: string; quantity: number;
  back_deducted_at: string | null; back_deducted_from_po: string | null;
};
type DR = { id: string; receipt_number: string; invoice_id: string; status: string; created_at: string; archived_at: string | null };
type Log = { id: string; product_id: string; change: number; reason: string | null; invoice_id: string | null; created_at: string; actor_email: string | null };

type LineRow = {
  item: InvItem;
  inv: Invoice | undefined;
  fromStock: number;
  reservedFromPO: number;
  reservations: (Reservation & { po: PO | undefined })[];
  deliveredQty: number;
  receipts: { dr: DR; qty: number; di: DRItem }[];
};

function Traceability() {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [items, setItems] = useState<InvItem[]>([]);
  const [resv, setResv] = useState<Reservation[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [dris, setDris] = useState<DRItem[]>([]);
  const [drs, setDrs] = useState<DR[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);

  // Filters
  const [tab, setTab] = useState<string>("lines");
  const [search, setSearch] = useState("");
  const [poFilter, setPoFilter] = useState("");
  const [drFilter, setDrFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [perProdFilter, setPerProdFilter] = useState("");
  const [selected, setSelected] = useState<LineRow | null>(null);
  // Stock levels tab
  const [stockSearch, setStockSearch] = useState("");
  const [stockSort, setStockSort] = useState<"desc" | "asc">("desc");
  const [stockOnly, setStockOnly] = useState<"all" | "in" | "low" | "out">("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [invR, itR, rR, pR, poR, drIR, drR, lR] = await Promise.all([
        supabase.from("invoices").select("id,invoice_number,status,created_at,customer_name").order("created_at", { ascending: false }).limit(500),
        supabase.from("invoice_items").select("id,invoice_id,product_id,product_name,quantity"),
        supabase.from("invoice_po_reservations" as any).select("*"),
        supabase.from("products").select("id,name,serial_number,color,collection,stock_quantity,low_stock_threshold,image_url"),
        supabase.from("purchase_orders").select("id,po_number,status"),
        supabase.from("delivery_receipt_items" as any).select("id,receipt_id,invoice_item_id,product_name,quantity,back_deducted_at,back_deducted_from_po"),
        supabase.from("delivery_receipts" as any).select("id,receipt_number,invoice_id,status,created_at,archived_at"),
        supabase.from("inventory_logs").select("id,product_id,change,reason,invoice_id,created_at,actor_email").order("created_at", { ascending: false }).limit(5000),
      ]);
      setInvoices((invR.data ?? []) as any);
      setItems((itR.data ?? []) as any);
      setResv((rR.data ?? []) as any);
      setProducts((pR.data ?? []) as any);
      setPos((poR.data ?? []) as any);
      setDris((drIR.data ?? []) as any);
      setDrs((drR.data ?? []) as any);
      setLogs((lR.data ?? []) as any);
      setLoading(false);
    })();
  }, []);

  // Real-time stock updates for the Stock levels tab (products table).
  useRealtimeTable("products", async () => {
    const { data } = await supabase
      .from("products")
      .select("id,name,serial_number,color,collection,stock_quantity,low_stock_threshold,image_url");
    if (data) setProducts(data as any);
  });
  // Realtime inventory logs keep the timeline tab live too.
  useRealtimeTable("inventory_logs", async () => {
    const { data } = await supabase
      .from("inventory_logs")
      .select("id,product_id,change,reason,invoice_id,created_at,actor_email")
      .order("created_at", { ascending: false })
      .limit(5000);
    if (data) setLogs(data as any);
  });

  const invById = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);
  const prodById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const poById = useMemo(() => new Map(pos.map((p) => [p.id, p])), [pos]);
  const drById = useMemo(() => new Map(drs.map((d) => [d.id, d])), [drs]);

  // === Per invoice-line: reserved-from-stock vs reserved-from-PO + fulfillment ===
  const allLineRows: LineRow[] = useMemo(() => {
    const drQtyByItem = new Map<string, { qty: number; receipts: { dr: DR; qty: number; di: DRItem }[] }>();
    for (const di of dris) {
      const dr = drById.get(di.receipt_id);
      if (!dr) continue;
      const cur = drQtyByItem.get(di.invoice_item_id) ?? { qty: 0, receipts: [] };
      cur.qty += di.quantity;
      cur.receipts.push({ dr, qty: di.quantity, di });
      drQtyByItem.set(di.invoice_item_id, cur);
    }
    const resvByItem = new Map<string, Reservation[]>();
    for (const r of resv) {
      const arr = resvByItem.get(r.invoice_item_id) ?? [];
      arr.push(r); resvByItem.set(r.invoice_item_id, arr);
    }
    return items
      .filter((it) => it.product_id)
      .map<LineRow>((it) => {
        const inv = invById.get(it.invoice_id);
        const rs = resvByItem.get(it.id) ?? [];
        const reservedFromPO = rs.reduce((s, r) => s + r.quantity, 0);
        const fromStock = Math.max(0, it.quantity - reservedFromPO);
        const drInfo = drQtyByItem.get(it.id) ?? { qty: 0, receipts: [] };
        return {
          item: it, inv, fromStock, reservedFromPO,
          reservations: rs.map((r) => ({ ...r, po: poById.get(r.po_id) })),
          deliveredQty: drInfo.qty, receipts: drInfo.receipts,
        };
      });
  }, [items, invById, resv, dris, drById, poById]);

  const lineRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const po = poFilter.trim().toLowerCase();
    const dr = drFilter.trim().toLowerCase();
    const from = fromDate ? new Date(fromDate).getTime() : null;
    const to = toDate ? new Date(toDate).getTime() + 86_400_000 : null;
    return allLineRows
      .filter((r) => {
        if (q && !(
          r.inv?.invoice_number?.toLowerCase().includes(q) ||
          r.item.product_name?.toLowerCase().includes(q) ||
          r.reservations.some((x) => x.po?.po_number?.toLowerCase().includes(q))
        )) return false;
        if (po && !r.reservations.some((x) => x.po?.po_number?.toLowerCase().includes(po))) return false;
        if (dr && !r.receipts.some((x) => x.dr.receipt_number?.toLowerCase().includes(dr))) return false;
        if (from || to) {
          const t = r.inv ? new Date(r.inv.created_at).getTime() : 0;
          if (from && t < from) return false;
          if (to && t > to) return false;
        }
        return true;
      })
      .sort((a, b) => (b.inv?.created_at ?? "").localeCompare(a.inv?.created_at ?? ""));
  }, [allLineRows, search, poFilter, drFilter, fromDate, toDate]);

  // === Validation: mismatches ===
  const mismatches = useMemo(() => {
    const out: { invoice: Invoice | undefined; item: InvItem; deliveredQty: number; deducted: number; reservedPO: number; status: "over" | "under" | "unfulfilled-resv"; detail: string; drIds: string[] }[] = [];
    const drInfoByItem = new Map<string, { qty: number; drIds: string[] }>();
    for (const di of dris) {
      const dr = drById.get(di.receipt_id);
      if (!dr) continue;
      const cur = drInfoByItem.get(di.invoice_item_id) ?? { qty: 0, drIds: [] };
      cur.qty += di.quantity;
      cur.drIds.push(dr.receipt_number);
      drInfoByItem.set(di.invoice_item_id, cur);
    }
    const resvByItem = new Map<string, Reservation[]>();
    for (const r of resv) {
      const a = resvByItem.get(r.invoice_item_id) ?? [];
      a.push(r); resvByItem.set(r.invoice_item_id, a);
    }
    for (const it of items) {
      if (!it.product_id) continue;
      const inv = invById.get(it.invoice_id);
      if (!inv || inv.status === "voided") continue;
      const info = drInfoByItem.get(it.id) ?? { qty: 0, drIds: [] };
      const rs = resvByItem.get(it.id) ?? [];
      const reservedPO = rs.reduce((s, r) => s + r.quantity, 0);
      const stockDeducted = Math.max(0, it.quantity - reservedPO);

      if (info.qty > it.quantity) {
        out.push({ invoice: inv, item: it, deliveredQty: info.qty, deducted: stockDeducted, reservedPO,
          status: "over", drIds: info.drIds,
          detail: isAr ? `كمية الاستلام (${info.qty}) أكبر من كمية الفاتورة (${it.quantity}) — DRs: ${info.drIds.join(", ")}` : `Delivered (${info.qty}) exceeds invoiced (${it.quantity}) — DRs: ${info.drIds.join(", ")}` });
        continue;
      }
      const activeResv = rs.filter((r) => r.status === "active");
      if (activeResv.length > 0) {
        const poNames = activeResv.map((r) => poById.get(r.po_id)?.po_number ?? "?").join(", ");
        out.push({ invoice: inv, item: it, deliveredQty: info.qty, deducted: stockDeducted, reservedPO,
          status: "unfulfilled-resv", drIds: info.drIds,
          detail: isAr ? `حجز معلّق على أوامر شراء: ${poNames}` : `Active reservation on POs: ${poNames}` });
      }
    }
    return out;
  }, [items, invById, dris, drById, resv, poById, isAr]);

  // === Per-product report ===
  const perProductRows = useMemo(() => {
    type Acc = {
      product_id: string;
      product_name: string;
      totalNeeded: number;
      totalFromStock: number;
      totalReservedPO: number;
      totalDelivered: number;
      poBreakdown: Map<string, number>;
      drBreakdown: Map<string, number>;
      openLines: number;
    };
    const map = new Map<string, Acc>();
    for (const r of allLineRows) {
      const pid = r.item.product_id!;
      const a = map.get(pid) ?? {
        product_id: pid, product_name: r.item.product_name,
        totalNeeded: 0, totalFromStock: 0, totalReservedPO: 0, totalDelivered: 0,
        poBreakdown: new Map(), drBreakdown: new Map(), openLines: 0,
      };
      a.totalNeeded += r.item.quantity;
      a.totalFromStock += r.fromStock;
      a.totalReservedPO += r.reservedFromPO;
      a.totalDelivered += r.deliveredQty;
      if (r.deliveredQty < r.item.quantity) a.openLines += 1;
      for (const rv of r.reservations) {
        const k = rv.po?.po_number ?? "?";
        a.poBreakdown.set(k, (a.poBreakdown.get(k) ?? 0) + rv.quantity);
      }
      for (const rc of r.receipts) {
        const k = rc.dr.receipt_number;
        a.drBreakdown.set(k, (a.drBreakdown.get(k) ?? 0) + rc.qty);
      }
      map.set(pid, a);
    }
    const q = perProdFilter.trim().toLowerCase();
    return [...map.values()]
      .filter((x) => !q || x.product_name.toLowerCase().includes(q))
      .sort((a, b) => b.totalNeeded - a.totalNeeded);
  }, [allLineRows, perProdFilter]);

  // === Stock levels rows (real-time high/low quantity ranking) ===
  const stockRows = useMemo(() => {
    // Movement in the last 30 days = sum of |change| across logs.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const moveMap = new Map<string, number>();
    const lastMoveMap = new Map<string, string>();
    for (const l of logs) {
      const t = new Date(l.created_at).getTime();
      if (!Number.isNaN(t) && t >= cutoff) {
        moveMap.set(l.product_id, (moveMap.get(l.product_id) ?? 0) + Math.abs(Number(l.change) || 0));
      }
      if (!lastMoveMap.has(l.product_id)) lastMoveMap.set(l.product_id, l.created_at);
    }
    const q = stockSearch.trim().toLowerCase();
    const rows = products.map((p) => {
      const qty = Number(p.stock_quantity ?? 0);
      const threshold = Number(p.low_stock_threshold ?? 0);
      let bucket: "in" | "low" | "out" = "in";
      if (qty <= 0) bucket = "out";
      else if (threshold > 0 && qty <= threshold) bucket = "low";
      return {
        product: p,
        qty,
        threshold,
        bucket,
        moved30d: moveMap.get(p.id) ?? 0,
        lastMoveAt: lastMoveMap.get(p.id) ?? null,
      };
    });
    const filtered = rows
      .filter((r) => stockOnly === "all" || r.bucket === stockOnly)
      .filter((r) =>
        !q ||
        r.product.name?.toLowerCase().includes(q) ||
        (r.product.serial_number ?? "").toLowerCase().includes(q) ||
        (r.product.color ?? "").toLowerCase().includes(q),
      );
    filtered.sort((a, b) => (stockSort === "desc" ? b.qty - a.qty : a.qty - b.qty));
    return filtered;
  }, [products, logs, stockSearch, stockSort, stockOnly]);


  // === Audit timeline per product ===
  const timelineRows = useMemo(() => {
    return logs
      .filter((l) => !productFilter || prodById.get(l.product_id)?.name?.toLowerCase().includes(productFilter.toLowerCase()))
      .slice(0, 500)
      .map((l) => {
        const reason = l.reason ?? "";
        let kind: { label: string; cls: string } = { label: isAr ? "أخرى" : "Other", cls: "bg-muted text-muted-foreground" };
        let link: string | null = null;
        if (/^sale /i.test(reason)) { kind = { label: isAr ? "بيع فاتورة" : "Sale", cls: "bg-rose-500/15 text-rose-600 border-rose-500/30" }; }
        else if (/^void /i.test(reason)) { kind = { label: isAr ? "إلغاء فاتورة" : "Void", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30" }; }
        else if (/^PO /i.test(reason)) { kind = { label: isAr ? "استلام أمر شراء" : "PO receipt", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" }; const m = reason.match(/PO-\d{4}-\d{4}/); if (m) link = m[0]; }
        else if (/reservation-fulfilled/i.test(reason)) { kind = { label: isAr ? "تنفيذ حجز" : "Reservation fulfilled", cls: "bg-blue-500/15 text-blue-700 border-blue-500/30" }; }
        else if (/خصم محضر استلام تاريخي/.test(reason)) { kind = { label: isAr ? "خصم محضر تاريخي" : "Historical DR back-deduct", cls: "bg-purple-500/15 text-purple-700 border-purple-500/30" }; }
        else if (/^manual/i.test(reason) || /يدوي/.test(reason)) { kind = { label: isAr ? "تعديل يدوي" : "Manual", cls: "bg-slate-500/15 text-slate-700 border-slate-500/30" }; }
        const inv = l.invoice_id ? invById.get(l.invoice_id) : undefined;
        return { log: l, product: prodById.get(l.product_id), kind, link, invoice: inv };
      });
  }, [logs, prodById, invById, productFilter, isAr]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          {isAr ? "تتبع المخزون والحجوزات (تقرير دقيق)" : "Inventory & Reservation Traceability"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isAr
            ? "تقرير تفصيلي يربط كل سطر فاتورة بمصدر الكمية (مخزون أو أمر شراء) وكل حركة مخزون بمصدرها الأصلي."
            : "Detailed report linking every invoice line to its source (stock vs in-transit PO) and every inventory movement to its origin."}
        </p>
      </div>

      {/* Mismatches banner */}
      {!loading && mismatches.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold text-destructive mb-1">
                {isAr ? `تنبيه: ${mismatches.length} حالة عدم تطابق تحتاج مراجعة` : `Alert: ${mismatches.length} mismatch${mismatches.length === 1 ? "" : "es"} need review`}
              </div>
              <div className="text-muted-foreground text-xs leading-relaxed">
                {isAr
                  ? `أمثلة: ${mismatches.slice(0, 3).map((m) => `${m.invoice?.invoice_number}${m.drIds.length ? ` (DR ${m.drIds.join(",")})` : ""}`).join(" · ")}`
                  : `Examples: ${mismatches.slice(0, 3).map((m) => `${m.invoice?.invoice_number}${m.drIds.length ? ` (DR ${m.drIds.join(",")})` : ""}`).join(" · ")}`}
              </div>
            </div>
          </div>
          <Button size="sm" variant="destructive" onClick={() => setTab("validate")} className="flex-shrink-0">
            {isAr ? "افتح صفحة الفحص" : "Open validation"}
            <ArrowRight className="h-4 w-4 ms-1" />
          </Button>
        </div>
      )}

      {/* Explanation banner */}
      <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-4 text-sm">
        <div className="font-semibold mb-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-purple-600" />
          {isAr ? "ما معنى «جزئي (متبقي بدون خصم: N)» في سجل المخزون؟" : "What does “partial — N units left undeducted” mean?"}
        </div>
        <p className="text-muted-foreground leading-relaxed">
          {isAr
            ? "لما بيتم استلام أمر شراء، النظام بيرجع يطبّق محاضر الاستلام التاريخية اللي كانت محجوزة على الأمر دا. لو في وقت الاستلام المخزون كان أقل من المطلوب (مثلاً كان فيه 3 ومحتاج يخصم 5)، النظام بيخصم اللي قدر عليه فقط (3) ومايخليش المخزون يبقى بالسالب — والباقي (2) بيتسجل في الأودِت لوج كـ shortfall بدون ما يفشل العملية أو يأثر على أي فاتورة/محضر."
            : "When a PO is received, the system back-applies historical delivery receipts. If stock at that moment is lower than needed, only what is available is deducted (never going below zero) and the remaining shortfall is recorded for audit — without failing the operation or affecting any invoice/DR."}
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="lines">
            <PackageCheck className="h-4 w-4 me-2" />
            {isAr ? "تتبع سطور الفواتير" : "Invoice line tracing"}
          </TabsTrigger>
          <TabsTrigger value="per-product">
            <BarChart3 className="h-4 w-4 me-2" />
            {isAr ? "تقرير لكل منتج" : "Per-product report"}
          </TabsTrigger>
          <TabsTrigger value="validate">
            <AlertTriangle className="h-4 w-4 me-2" />
            {isAr ? "فحص التطابق" : "Validation"}
            {mismatches.length > 0 && (
              <Badge variant="destructive" className="ms-2">{mismatches.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="timeline">
            <History className="h-4 w-4 me-2" />
            {isAr ? "الجدول الزمني للمخزون" : "Inventory timeline"}
          </TabsTrigger>
        </TabsList>

        {/* === Lines tab === */}
        <TabsContent value="lines" className="space-y-3">
          {/* Advanced filters */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <div className="relative md:col-span-2">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={isAr ? "ابحث برقم فاتورة، اسم منتج، أو رقم PO..." : "Search invoice #, product, PO #..."}
                className="ps-9" />
            </div>
            <Input value={poFilter} onChange={(e) => setPoFilter(e.target.value)}
              placeholder={isAr ? "رقم PO" : "PO #"} />
            <Input value={drFilter} onChange={(e) => setDrFilter(e.target.value)}
              placeholder={isAr ? "رقم DR" : "DR #"} />
            <div className="grid grid-cols-2 gap-1">
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
          {(search || poFilter || drFilter || fromDate || toDate) && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setPoFilter(""); setDrFilter(""); setFromDate(""); setToDate(""); }}>
              <X className="h-3 w-3 me-1" /> {isAr ? "مسح الفلاتر" : "Clear filters"}
            </Button>
          )}

          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase">
                <tr>
                  <th className="p-2 text-start">{isAr ? "الفاتورة" : "Invoice"}</th>
                  <th className="p-2 text-start">{isAr ? "المنتج" : "Product"}</th>
                  <th className="p-2 text-center">{isAr ? "الكمية" : "Qty"}</th>
                  <th className="p-2 text-center">{isAr ? "من المخزون" : "From stock"}</th>
                  <th className="p-2 text-center">{isAr ? "محجوز من PO" : "Reserved from PO"}</th>
                  <th className="p-2 text-center">{isAr ? "تم تسليم" : "Delivered"}</th>
                  <th className="p-2 text-start">{isAr ? "تفاصيل المصدر" : "Source details"}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">{isAr ? "جاري التحميل..." : "Loading..."}</td></tr>
                ) : lineRows.length === 0 ? (
                  <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">{isAr ? "لا توجد بيانات" : "No data"}</td></tr>
                ) : lineRows.slice(0, 300).map((r) => (
                  <tr key={r.item.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setSelected(r)}>
                    <td className="p-2">
                      <div className="font-mono text-xs">{r.inv?.invoice_number}</div>
                      <div className="text-xs text-muted-foreground">{r.inv?.customer_name}</div>
                    </td>
                    <td className="p-2">{r.item.product_name}</td>
                    <td className="p-2 text-center font-semibold">{r.item.quantity}</td>
                    <td className="p-2 text-center">
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30">{r.fromStock}</Badge>
                    </td>
                    <td className="p-2 text-center">
                      {r.reservedFromPO > 0 ? (
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/30">{r.reservedFromPO}</Badge>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 text-center">
                      {r.deliveredQty === 0 ? <span className="text-muted-foreground">0</span>
                        : r.deliveredQty < r.item.quantity ? <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30">{r.deliveredQty}/{r.item.quantity}</Badge>
                        : <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">{r.deliveredQty} ✓</Badge>}
                    </td>
                    <td className="p-2 text-xs">
                      {r.reservations.slice(0, 2).map((rv) => (
                        <div key={rv.id} className="flex items-center gap-2 mb-1">
                          <span className="font-mono">{rv.po?.po_number}</span>
                          <span>·</span>
                          <span>{rv.quantity}</span>
                          {rv.status === "fulfilled" ? (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30 text-[10px]">
                              <CheckCircle2 className="h-3 w-3 me-1" />
                              {isAr ? "تم" : "Done"}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30 text-[10px]">
                              {isAr ? "انتظار" : "Pending"}
                            </Badge>
                          )}
                        </div>
                      ))}
                      {r.receipts.slice(0, 2).map((rec) => (
                        <div key={rec.dr.id} className="text-muted-foreground">
                          DR #{rec.dr.receipt_number} · {rec.qty}
                        </div>
                      ))}
                      {(r.reservations.length > 2 || r.receipts.length > 2) && (
                        <div className="text-primary text-[11px]">{isAr ? "اضغط لعرض الكل…" : "Click for full trace…"}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lineRows.length > 300 && (
            <div className="text-xs text-muted-foreground text-center">
              {isAr ? `عرض أول 300 من ${lineRows.length}` : `Showing first 300 of ${lineRows.length}`}
            </div>
          )}
        </TabsContent>

        {/* === Per-product report tab === */}
        <TabsContent value="per-product" className="space-y-3">
          <div className="relative max-w-md">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={perProdFilter} onChange={(e) => setPerProdFilter(e.target.value)}
              placeholder={isAr ? "فلتر باسم المنتج..." : "Filter by product..."} className="ps-9" />
          </div>
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase">
                <tr>
                  <th className="p-2 text-start">{isAr ? "المنتج" : "Product"}</th>
                  <th className="p-2 text-center">{isAr ? "إجمالي محتاج" : "Total needed"}</th>
                  <th className="p-2 text-center">{isAr ? "من المخزون" : "From stock"}</th>
                  <th className="p-2 text-center">{isAr ? "محجوز PO" : "Reserved PO"}</th>
                  <th className="p-2 text-center">{isAr ? "تم تسليم" : "Delivered"}</th>
                  <th className="p-2 text-center">{isAr ? "سطور مفتوحة" : "Open lines"}</th>
                  <th className="p-2 text-start">{isAr ? "تفصيل POs" : "PO breakdown"}</th>
                  <th className="p-2 text-start">{isAr ? "تفصيل DRs" : "DR breakdown"}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">{isAr ? "جاري التحميل..." : "Loading..."}</td></tr>
                ) : perProductRows.length === 0 ? (
                  <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">{isAr ? "لا توجد بيانات" : "No data"}</td></tr>
                ) : perProductRows.slice(0, 300).map((p) => (
                  <tr key={p.product_id} className="border-t hover:bg-muted/30">
                    <td className="p-2">{p.product_name}</td>
                    <td className="p-2 text-center font-semibold">{p.totalNeeded}</td>
                    <td className="p-2 text-center">
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30">{p.totalFromStock}</Badge>
                    </td>
                    <td className="p-2 text-center">
                      {p.totalReservedPO > 0
                        ? <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/30">{p.totalReservedPO}</Badge>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 text-center">
                      {p.totalDelivered >= p.totalNeeded
                        ? <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">{p.totalDelivered} ✓</Badge>
                        : <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30">{p.totalDelivered}/{p.totalNeeded}</Badge>}
                    </td>
                    <td className="p-2 text-center">{p.openLines > 0 ? <Badge variant="destructive">{p.openLines}</Badge> : <span className="text-muted-foreground">0</span>}</td>
                    <td className="p-2 text-xs">
                      {[...p.poBreakdown.entries()].slice(0, 4).map(([po, q]) => (
                        <div key={po}><span className="font-mono">{po}</span> · {q}</div>
                      ))}
                      {p.poBreakdown.size === 0 && <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 text-xs">
                      {[...p.drBreakdown.entries()].slice(0, 4).map(([dr, q]) => (
                        <div key={dr}>DR #{dr} · {q}</div>
                      ))}
                      {p.drBreakdown.size === 0 && <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* === Validation tab === */}
        <TabsContent value="validate" className="space-y-3">
          {loading ? <div className="text-muted-foreground">{isAr ? "جاري الفحص..." : "Validating..."}</div>
            : mismatches.length === 0 ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-600 mx-auto mb-2" />
                <div className="font-semibold text-emerald-700">{isAr ? "كل البيانات سليمة 100%" : "All data is consistent ✓"}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  {isAr ? "لا يوجد أي تعارض بين كميات محاضر الاستلام والكميات المحجوزة/المخصومة." : "No mismatch detected between DRs and reservations/deductions."}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-destructive/10 text-xs uppercase">
                    <tr>
                      <th className="p-2 text-start">{isAr ? "الفاتورة" : "Invoice"}</th>
                      <th className="p-2 text-start">{isAr ? "المنتج" : "Product"}</th>
                      <th className="p-2 text-center">{isAr ? "كمية الفاتورة" : "Inv qty"}</th>
                      <th className="p-2 text-center">{isAr ? "تم تسليم" : "Delivered"}</th>
                      <th className="p-2 text-center">{isAr ? "محجوز PO" : "Reserved PO"}</th>
                      <th className="p-2 text-start">{isAr ? "DRs" : "DRs"}</th>
                      <th className="p-2 text-start">{isAr ? "المشكلة" : "Issue"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mismatches.map((m, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 font-mono text-xs">{m.invoice?.invoice_number}<div className="text-[10px] text-muted-foreground">{m.invoice?.id}</div></td>
                        <td className="p-2">{m.item.product_name}</td>
                        <td className="p-2 text-center">{m.item.quantity}</td>
                        <td className="p-2 text-center">{m.deliveredQty}</td>
                        <td className="p-2 text-center">{m.reservedPO}</td>
                        <td className="p-2 text-xs font-mono">{m.drIds.join(", ") || "—"}</td>
                        <td className="p-2 text-xs">
                          <Badge variant={m.status === "over" ? "destructive" : "outline"} className="mb-1">
                            {m.status === "over" ? (isAr ? "تجاوز" : "Overdelivery") : (isAr ? "حجز معلّق" : "Pending reservation")}
                          </Badge>
                          <div>{m.detail}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </TabsContent>

        {/* === Timeline tab === */}
        <TabsContent value="timeline" className="space-y-3">
          <div className="relative max-w-md">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              placeholder={isAr ? "فلتر باسم المنتج (مثلاً MIXER أو body)..." : "Filter by product name..."}
              className="ps-9"
            />
          </div>
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase">
                <tr>
                  <th className="p-2 text-start">{isAr ? "التاريخ" : "Date"}</th>
                  <th className="p-2 text-start">{isAr ? "المنتج" : "Product"}</th>
                  <th className="p-2 text-center">{isAr ? "التغيير" : "Change"}</th>
                  <th className="p-2 text-start">{isAr ? "النوع" : "Kind"}</th>
                  <th className="p-2 text-start">{isAr ? "المصدر" : "Source"}</th>
                  <th className="p-2 text-start">{isAr ? "المنفّذ" : "Actor"}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">{isAr ? "جاري التحميل..." : "Loading..."}</td></tr>
                ) : timelineRows.map((r) => (
                  <tr key={r.log.id} className="border-t hover:bg-muted/30">
                    <td className="p-2 text-xs whitespace-nowrap">{fmtDateTime(r.log.created_at, lang)}</td>
                    <td className="p-2">{r.product?.name ?? r.log.product_id}</td>
                    <td className={`p-2 text-center font-mono font-bold ${r.log.change < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {r.log.change > 0 ? `+${r.log.change}` : r.log.change}
                    </td>
                    <td className="p-2"><Badge variant="outline" className={r.kind.cls}>{r.kind.label}</Badge></td>
                    <td className="p-2 text-xs">
                      <div>{r.log.reason}</div>
                      {r.invoice && <div className="text-muted-foreground font-mono">{r.invoice.invoice_number}</div>}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">{r.log.actor_email ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Line details Dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-primary" />
              {isAr ? "تسلسل تتبع كامل" : "Full traceability"}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="rounded border p-3 bg-muted/30">
                <div className="font-mono text-xs text-muted-foreground">{selected.inv?.invoice_number}</div>
                <div className="font-semibold mt-1">{selected.item.product_name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {isAr ? "العميل" : "Customer"}: {selected.inv?.customer_name ?? "—"} ·{" "}
                  {isAr ? "التاريخ" : "Date"}: {selected.inv ? fmtDateTime(selected.inv.created_at, lang) : "—"}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded border p-3">
                  <div className="text-xs text-muted-foreground">{isAr ? "الكمية" : "Quantity"}</div>
                  <div className="text-xl font-bold">{selected.item.quantity}</div>
                </div>
                <div className="rounded border p-3 bg-emerald-500/5">
                  <div className="text-xs text-muted-foreground">{isAr ? "من المخزون" : "From stock"}</div>
                  <div className="text-xl font-bold text-emerald-700">{selected.fromStock}</div>
                </div>
                <div className="rounded border p-3 bg-blue-500/5">
                  <div className="text-xs text-muted-foreground">{isAr ? "من PO قادم" : "From PO"}</div>
                  <div className="text-xl font-bold text-blue-700">{selected.reservedFromPO}</div>
                </div>
              </div>

              <div>
                <div className="font-semibold mb-2 text-xs uppercase text-muted-foreground">{isAr ? "حجوزات أوامر الشراء" : "PO reservations"}</div>
                {selected.reservations.length === 0 ? (
                  <div className="text-muted-foreground text-xs">{isAr ? "لا يوجد" : "None"}</div>
                ) : (
                  <div className="space-y-2">
                    {selected.reservations.map((rv) => (
                      <div key={rv.id} className="flex items-center justify-between rounded border p-2 text-xs">
                        <div>
                          <span className="font-mono font-semibold">{rv.po?.po_number}</span>
                          <span className="mx-2">·</span>
                          <span>{isAr ? "كمية" : "Qty"}: {rv.quantity}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {rv.status === "fulfilled" ? (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
                              <CheckCircle2 className="h-3 w-3 me-1" />
                              {isAr ? "تم التنفيذ" : "Fulfilled"} {rv.fulfilled_at ? fmtDateTime(rv.fulfilled_at, lang) : ""}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30">
                              {isAr ? "في الانتظار" : "Pending"}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="font-semibold mb-2 text-xs uppercase text-muted-foreground">{isAr ? "محاضر الاستلام (DR)" : "Delivery receipts (DR)"}</div>
                {selected.receipts.length === 0 ? (
                  <div className="text-muted-foreground text-xs">{isAr ? "لم يتم التسليم بعد" : "Not delivered yet"}</div>
                ) : (
                  <div className="space-y-2">
                    {selected.receipts.map((rc) => (
                      <div key={rc.di.id} className="rounded border p-2 text-xs">
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold">DR #{rc.dr.receipt_number}</div>
                          <div>{isAr ? "كمية" : "Qty"}: {rc.qty}</div>
                        </div>
                        <div className="text-muted-foreground mt-1">
                          {fmtDateTime(rc.dr.created_at, lang)}
                          {rc.dr.archived_at && ` · ${isAr ? "أرشيف" : "archived"}`}
                          {rc.di.back_deducted_at && ` · ${isAr ? "خصم خلفي من" : "back-deducted from"} ${rc.di.back_deducted_from_po ?? ""}`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
