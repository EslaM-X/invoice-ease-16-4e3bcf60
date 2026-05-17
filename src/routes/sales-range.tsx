import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtMoney, fmtDate } from "@/lib/utils-money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, RefreshCw, Package, ShoppingCart, Boxes, Calendar as CalendarIcon, Languages } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/sales-range")({
  head: () => ({
    meta: [
      { title: "تقرير المبيعات حسب الفترة | Sales by Range" },
      { name: "description", content: "كل المنتجات المباعة فعليًا خلال فترة محددة بالتفصيل والصور والإجماليات وتصدير Excel." },
    ],
  }),
  component: () => (
    <AppShell>
      <SalesRange />
    </AppShell>
  ),
});

type Inv = { id: string; invoice_number: string; status: string; created_at: string; customer_name: string | null; total: number };
type Item = {
  id: string;
  invoice_id: string;
  product_id: string | null;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
};
type Prod = { id: string; name: string; serial_number: string | null; color: string | null; image_url: string | null; collection: string | null; price: number };

type Row = {
  product_id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  collection: string;
  image_url: string | null;
  unit_price: number;
  qty: number;
  total_value: number;
  invoices: { invoice_number: string; created_at: string; quantity: number; customer_name: string | null }[];
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgoISO(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function SalesRange() {
  const { user } = useAuth();
  const { lang, setLang, dir } = useI18n();
  const ar = lang === "ar";
  const tt = (a: string, e: string) => (ar ? a : e);
  const [from, setFrom] = useState<string>(daysAgoISO(6));
  const [to, setTo] = useState<string>(todayISO());
  const [invoices, setInvoices] = useState<Inv[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [products, setProducts] = useState<Map<string, Prod>>(new Map());
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!user) return;
    if (from > to) { toast.error(tt("تاريخ البداية بعد النهاية", "Start date is after end date")); return; }
    setLoading(true);
    try {
      const start = new Date(from + "T00:00:00").toISOString();
      const endD = new Date(to + "T00:00:00"); endD.setDate(endD.getDate() + 1);
      const end = endD.toISOString();

      const { data: invs, error: e1 } = await supabase
        .from("invoices")
        .select("id, invoice_number, status, created_at, customer_name, total")
        .not("status", "in", "(voided,draft)")
        .gte("created_at", start)
        .lt("created_at", end)
        .order("created_at", { ascending: true });
      if (e1) throw e1;
      const invList = (invs ?? []) as Inv[];
      setInvoices(invList);

      if (invList.length === 0) { setItems([]); setProducts(new Map()); return; }

      const ids = invList.map((i) => i.id);
      const { data: its, error: e2 } = await supabase
        .from("invoice_items")
        .select("id, invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, line_total")
        .in("invoice_id", ids);
      if (e2) throw e2;
      const itemList = (its ?? []) as Item[];
      setItems(itemList);

      const pIds = Array.from(new Set(itemList.map((i) => i.product_id).filter(Boolean) as string[]));
      if (pIds.length) {
        const { data: prods, error: e3 } = await supabase
          .from("products")
          .select("id, name, serial_number, color, image_url, collection, price")
          .in("id", pIds);
        if (e3) throw e3;
        const m = new Map<string, Prod>();
        for (const p of (prods ?? []) as Prod[]) m.set(p.id, p);
        setProducts(m);
      } else setProducts(new Map());
    } catch (err: any) {
      toast.error(err?.message ?? "خطأ في التحميل");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user, from, to]);

  useRealtimeTable("invoices", () => load(), [from, to, user?.id]);
  useRealtimeTable("invoice_items", () => load(), [from, to, user?.id]);
  useRealtimeTable("products", () => load(), [from, to, user?.id]);

  const { rows, totalUnits, totalValue, byCollection } = useMemo(() => {
    const invMap = new Map(invoices.map((i) => [i.id, i]));
    const map = new Map<string, Row>();
    for (const it of items) {
      if (!it.product_id) continue;
      const inv = invMap.get(it.invoice_id);
      if (!inv) continue;
      const qty = Number(it.quantity) || 0;
      if (qty <= 0) continue;
      const p = products.get(it.product_id);
      const collection = (p?.collection || "—").toUpperCase();
      const cur = map.get(it.product_id) ?? {
        product_id: it.product_id,
        product_name: p?.name || it.product_name,
        serial_number: p?.serial_number ?? it.serial_number,
        color: p?.color ?? it.color,
        collection,
        image_url: p?.image_url ?? null,
        unit_price: Number(it.unit_price) || p?.price || 0,
        qty: 0,
        total_value: 0,
        invoices: [],
      };
      cur.qty += qty;
      cur.total_value += qty * (Number(it.unit_price) || 0);
      cur.invoices.push({
        invoice_number: inv.invoice_number,
        created_at: inv.created_at,
        quantity: qty,
        customer_name: inv.customer_name,
      });
      map.set(it.product_id, cur);
    }
    const rows = Array.from(map.values()).sort((a, b) => b.qty - a.qty);
    const totalUnits = rows.reduce((s, r) => s + r.qty, 0);
    const totalValue = rows.reduce((s, r) => s + r.total_value, 0);
    const byCollection = new Map<string, { units: number; value: number; distinct: number }>();
    for (const r of rows) {
      const c = byCollection.get(r.collection) ?? { units: 0, value: 0, distinct: 0 };
      c.units += r.qty; c.value += r.total_value; c.distinct += 1;
      byCollection.set(r.collection, c);
    }
    return { rows, totalUnits, totalValue, byCollection };
  }, [invoices, items, products]);

  const exportXlsx = () => {
    const aoa: any[][] = [
      ["Product", "Serial", "Color", "Collection", "Unit Price", "Quantity Sold", "Total Value", "Invoices"],
    ];
    for (const r of rows) {
      aoa.push([
        r.product_name,
        r.serial_number || "",
        r.color || "",
        r.collection,
        r.unit_price,
        r.qty,
        r.total_value,
        r.invoices.map((i) => `${i.invoice_number}(x${i.quantity})`).join(", "),
      ]);
    }
    aoa.push([]);
    aoa.push(["TOTAL", "", "", "", "", totalUnits, totalValue, ""]);
    aoa.push([]);
    aoa.push(["Collection", "Units", "Value", "Distinct Products"]);
    for (const [c, v] of byCollection) aoa.push([c, v.units, v.value, v.distinct]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 32 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 60 }];

    // Detail sheet
    const detail: any[][] = [["Invoice", "Date", "Customer", "Product", "Serial", "Color", "Collection", "Qty", "Unit Price", "Line Total"]];
    const invMap = new Map(invoices.map((i) => [i.id, i]));
    for (const it of items) {
      if (!it.product_id) continue;
      const inv = invMap.get(it.invoice_id);
      if (!inv) continue;
      const p = products.get(it.product_id);
      detail.push([
        inv.invoice_number,
        new Date(inv.created_at).toISOString(),
        inv.customer_name || "",
        p?.name || it.product_name,
        p?.serial_number || it.serial_number || "",
        p?.color || it.color || "",
        (p?.collection || "—").toUpperCase(),
        it.quantity,
        Number(it.unit_price) || 0,
        Number(it.line_total) || 0,
      ]);
    }
    const ws2 = XLSX.utils.aoa_to_sheet(detail);
    ws2["!cols"] = [{ wch: 16 }, { wch: 22 }, { wch: 22 }, { wch: 32 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 12 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Summary");
    XLSX.utils.book_append_sheet(wb, ws2, "Line Items");
    XLSX.writeFile(wb, `sales_${from}_to_${to}.xlsx`);
    toast.success("تم تصدير الملف");
  };

  const setRange = (days: number) => {
    const end = new Date();
    const start = new Date(); start.setDate(start.getDate() - days + 1);
    const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setFrom(f(start)); setTo(f(end));
  };

  return (
    <div className="container mx-auto p-4 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-primary" /> تقرير المبيعات حسب الفترة
          </h1>
          <p className="text-sm text-muted-foreground">المنتجات المباعة فعليًا (الفواتير المكتملة فقط — بدون الملغاة أو المحذوفة).</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/sales-today">مبيعات اليوم</Link></Button>
          <Button onClick={load} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ml-1 ${loading ? "animate-spin" : ""}`} /> تحديث
          </Button>
          <Button onClick={exportXlsx} size="sm" disabled={!rows.length}>
            <Download className="h-4 w-4 ml-1" /> تصدير Excel
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground">من</label>
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">إلى</label>
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
            </div>
          </div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => { const d = todayISO(); setFrom(d); setTo(d); }}>اليوم</Button>
            <Button variant="outline" size="sm" onClick={() => setRange(7)}>آخر 7 أيام</Button>
            <Button variant="outline" size="sm" onClick={() => setRange(30)}>آخر 30 يوم</Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">إجمالي القطع المباعة</div>
          <div className="text-3xl font-bold flex items-center gap-2 mt-1"><Boxes className="h-6 w-6 text-primary" /> {totalUnits}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">إجمالي القيمة</div>
          <div className="text-3xl font-bold mt-1">{fmtMoney(totalValue)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">عدد المنتجات المختلفة / الفواتير</div>
          <div className="text-3xl font-bold mt-1">{rows.length} <span className="text-base text-muted-foreground">/ {invoices.length}</span></div>
        </Card>
      </div>

      {byCollection.size > 0 && (
        <Card className="p-4">
          <h2 className="font-semibold mb-3">حسب الكولكشن</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from(byCollection).sort((a, b) => b[1].units - a[1].units).map(([c, v]) => (
              <div key={c} className="rounded-lg border p-3 bg-muted/30">
                <div className="text-xs text-muted-foreground">{c}</div>
                <div className="text-2xl font-bold mt-1">{v.units}</div>
                <div className="text-xs text-muted-foreground">{v.distinct} منتج · {fmtMoney(v.value)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2"><Package className="h-4 w-4" /> تفاصيل المنتجات المباعة</h2>
          <Badge variant="secondary">{rows.length} منتج</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-right">
                <th className="p-2">صورة</th>
                <th className="p-2">المنتج</th>
                <th className="p-2">السيريال</th>
                <th className="p-2">اللون</th>
                <th className="p-2">كولكشن</th>
                <th className="p-2">سعر الوحدة</th>
                <th className="p-2">الكمية المباعة</th>
                <th className="p-2">الإجمالي</th>
                <th className="p-2">الفواتير</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">لا توجد مبيعات في هذه الفترة</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.product_id} className="border-t hover:bg-muted/30">
                  <td className="p-2">
                    {r.image_url ? (
                      <img src={r.image_url} alt={r.product_name} className="h-12 w-12 rounded object-cover" loading="lazy" />
                    ) : (
                      <div className="h-12 w-12 rounded bg-muted flex items-center justify-center"><Package className="h-5 w-5 text-muted-foreground" /></div>
                    )}
                  </td>
                  <td className="p-2 font-medium">{r.product_name}</td>
                  <td className="p-2 font-mono text-xs">{r.serial_number || "—"}</td>
                  <td className="p-2">{r.color || "—"}</td>
                  <td className="p-2"><Badge variant="outline">{r.collection}</Badge></td>
                  <td className="p-2">{fmtMoney(r.unit_price)}</td>
                  <td className="p-2 font-bold text-primary">{r.qty}</td>
                  <td className="p-2 font-semibold">{fmtMoney(r.total_value)}</td>
                  <td className="p-2 text-xs text-muted-foreground max-w-xs">
                    {r.invoices.map((i, idx) => (
                      <span key={idx} className="inline-block ml-1 mb-1 px-1.5 py-0.5 rounded bg-muted">
                        {i.invoice_number} ×{i.quantity} · {fmtDate(i.created_at)}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-muted/40 font-bold">
                <tr className="border-t-2">
                  <td className="p-3" colSpan={6}>الإجمالي</td>
                  <td className="p-3 text-primary text-lg">{totalUnits}</td>
                  <td className="p-3">{fmtMoney(totalValue)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
