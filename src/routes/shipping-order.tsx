import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useRealtimeTable } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, RefreshCw, Truck, FileText, Calendar as CalendarIcon, Languages } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/shipping-order")({
  head: () => ({
    meta: [
      { title: "طلبية الشحن | Shipping Order" },
      { name: "description", content: "طلبية شحن يومية مرتبة من الفواتير الفعلية فقط (بدون الملغاة أو المحذوفة) بصيغ Excel و PDF." },
    ],
  }),
  component: () => (
    <AppShell>
      <ShippingOrder />
    </AppShell>
  ),
});

type Inv = { id: string; invoice_number: string; status: string; created_at: string };
type Item = {
  invoice_id: string;
  product_id: string | null;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  quantity: number;
};
type Prod = { id: string; serial_number: string | null; name: string; color: string | null; collection: string | null };

type CollectionLine = {
  code: string;
  product_name: string;
  color: string | null;
  collection: string;
  qty: number;
};
type CollectionGroup = { collection: string; lines: CollectionLine[]; total: number };

type Line = {
  code: string;
  product_name: string;
  color: string | null;
  sold: number;
};

type DayGroup = {
  date: string; // YYYY-MM-DD
  lines: Line[];
  totalSold: number;
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ShippingOrder() {
  const { user } = useAuth();
  const { lang, setLang, dir } = useI18n();
  const ar = lang === "ar";
  const tt = (a: string, e: string) => (ar ? a : e);
  const [from, setFrom] = useState<string>(todayISO());
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
        .select("id, invoice_number, status, created_at")
        .neq("status", "voided")
        .neq("status", "draft")
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
        .select("invoice_id, product_id, product_name, serial_number, color, quantity")
        .in("invoice_id", ids);
      if (e2) throw e2;
      const itemList = (its ?? []) as Item[];
      setItems(itemList);

      const pIds = Array.from(new Set(itemList.map((i) => i.product_id).filter(Boolean) as string[]));
      if (pIds.length) {
        const { data: prods } = await supabase
          .from("products")
          .select("id, serial_number, name, color, collection")
          .in("id", pIds);
        const m = new Map<string, Prod>();
        for (const p of (prods ?? []) as Prod[]) m.set(p.id, p);
        setProducts(m);
      } else setProducts(new Map());
    } catch (err: any) {
      toast.error(err?.message ?? tt("خطأ في التحميل", "Failed to load"));
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user, from, to]);
  useRealtimeTable("invoices", () => load(), [from, to, user?.id]);
  useRealtimeTable("invoice_items", () => load(), [from, to, user?.id]);

  const { groups, grandTotal, collectionGroups, collectionsGrandTotal } = useMemo(() => {
    const invMap = new Map(invoices.map((i) => [i.id, i]));
    const dayMap = new Map<string, Map<string, Line>>();
    // collection -> key -> CollectionLine
    const colMap = new Map<string, Map<string, CollectionLine>>();
    const FEE_NAMES = new Set(["رسوم شحن", "رسوم خدمة / Service Fee", "رسوم خدمة", "Service Fee"]);
    for (const it of items) {
      const inv = invMap.get(it.invoice_id);
      if (!inv) continue;
      const qty = Number(it.quantity) || 0;
      if (qty <= 0) continue;
      // Exclude shipping/service fees from shipping order entirely
      if (FEE_NAMES.has((it.product_name || "").trim())) continue;
      if (!it.product_id && /شحن|shipping|service\s*fee/i.test(it.product_name || "")) continue;
      const p = it.product_id ? products.get(it.product_id) : undefined;
      const code = (p?.serial_number ?? it.serial_number ?? "—").toString();
      const color = p?.color ?? it.color ?? null;
      const name = p?.name || it.product_name;
      const dk = dayKey(inv.created_at);
      let inner = dayMap.get(dk);
      if (!inner) { inner = new Map(); dayMap.set(dk, inner); }
      const key = `${code}|${color ?? ""}`;
      const cur = inner.get(key) ?? { code, product_name: name, color, sold: 0 };
      cur.sold += qty;
      inner.set(key, cur);

      // collection aggregation across the whole range
      const collection = (p?.collection ?? "—") || "—";
      let cInner = colMap.get(collection);
      if (!cInner) { cInner = new Map(); colMap.set(collection, cInner); }
      const cKey = `${code}|${color ?? ""}|${name}`;
      const cCur = cInner.get(cKey) ?? { code, product_name: name, color, collection, qty: 0 };
      cCur.qty += qty;
      cInner.set(cKey, cCur);
    }
    const groups: DayGroup[] = Array.from(dayMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, m]) => {
        const lines = Array.from(m.values()).sort((a, b) => a.code.localeCompare(b.code));
        const totalSold = lines.reduce((s, l) => s + l.sold, 0);
        return { date, lines, totalSold };
      });
    const grandTotal = groups.reduce((s, g) => s + g.totalSold, 0);

    const COLLECTION_ORDER = ["JOY", "UP", "ART", "QUATRO"];
    const collectionGroups: CollectionGroup[] = Array.from(colMap.entries())
      .map(([collection, m]) => {
        const lines = Array.from(m.values()).sort((a, b) => a.code.localeCompare(b.code));
        const total = lines.reduce((s, l) => s + l.qty, 0);
        return { collection, lines, total };
      })
      .sort((a, b) => {
        const ai = COLLECTION_ORDER.indexOf(a.collection);
        const bi = COLLECTION_ORDER.indexOf(b.collection);
        if (ai === -1 && bi === -1) return a.collection.localeCompare(b.collection);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    const collectionsGrandTotal = collectionGroups.reduce((s, g) => s + g.total, 0);
    return { groups, grandTotal, collectionGroups, collectionsGrandTotal };
  }, [invoices, items, products]);

  const exportXlsx = () => {
    const aoa: any[][] = [];
    aoa.push(["طلبية الشحن — Shipping Order", "", "", ""]);
    aoa.push([`من ${from} إلى ${to}`, "", "", ""]);
    aoa.push([]);
    for (const g of groups) {
      aoa.push([`اليوم / Day: ${g.date}`, "", "", ""]);
      aoa.push(["Code", "Product", "Sold", "Packing List ✓"]);
      for (const l of g.lines) {
        aoa.push([l.code, l.product_name + (l.color ? ` (${l.color})` : ""), l.sold, ""]);
      }
      aoa.push(["", "إجمالي اليوم / Day Total", g.totalSold, ""]);
      aoa.push([]);
    }
    aoa.push(["", "الإجمالي الكلي / Grand Total", grandTotal, ""]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 22 }, { wch: 38 }, { wch: 10 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Shipping Order");

    // Per-collection summary sheet
    const aoa2: any[][] = [];
    aoa2.push(["ملخص حسب الكولكشن — Per Collection", "", "", ""]);
    aoa2.push([`من ${from} إلى ${to}`, "", "", ""]);
    aoa2.push([]);
    for (const cg of collectionGroups) {
      aoa2.push([`Collection: ${cg.collection}`, "", "", ""]);
      aoa2.push(["Code", "Product", "Color", "Qty"]);
      for (const l of cg.lines) {
        aoa2.push([l.code, l.product_name, l.color ?? "", l.qty]);
      }
      aoa2.push(["", "إجمالي الكولكشن / Collection Total", "", cg.total]);
      aoa2.push([]);
    }
    aoa2.push(["", "الإجمالي الكلي / Grand Total", "", collectionsGrandTotal]);
    const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
    ws2["!cols"] = [{ wch: 22 }, { wch: 38 }, { wch: 16 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws2, "Per Collection");

    XLSX.writeFile(wb, `shipping-order_${from}_to_${to}.xlsx`);
    toast.success("تم تصدير Excel");
  };

  const exportPdf = () => {
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 36;
    let y = margin;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(18);
    pdf.text("Shipping Order", margin, y);
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    y += 18;
    pdf.text(`From ${from}  to  ${to}`, margin, y);
    y += 16;

    const colX = { code: margin, name: margin + 130, sold: pageW - margin - 180, pack: pageW - margin - 110 };

    const drawHeader = () => {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.text("Code", colX.code, y);
      pdf.text("Product", colX.name, y);
      pdf.text("Sold", colX.sold, y, { align: "right" });
      pdf.text("Packing List", colX.pack, y);
      y += 4;
      pdf.setDrawColor(180);
      pdf.line(margin, y, pageW - margin, y);
      y += 12;
      pdf.setFont("helvetica", "normal");
    };

    const ensureSpace = (need = 24) => {
      if (y + need > pageH - margin) {
        pdf.addPage();
        y = margin;
      }
    };

    for (const g of groups) {
      ensureSpace(60);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.setFillColor(240, 240, 240);
      pdf.rect(margin, y - 12, pageW - margin * 2, 18, "F");
      pdf.text(`Day: ${g.date}`, margin + 6, y);
      y += 14;
      drawHeader();

      for (const l of g.lines) {
        ensureSpace(20);
        const name = (l.product_name + (l.color ? ` (${l.color})` : "")).slice(0, 60);
        pdf.text(String(l.code).slice(0, 24), colX.code, y);
        pdf.text(name, colX.name, y);
        pdf.text(String(l.sold), colX.sold, y, { align: "right" });
        // packing list checkbox
        pdf.rect(colX.pack, y - 9, 12, 12);
        y += 16;
      }

      ensureSpace(20);
      pdf.setDrawColor(120);
      pdf.line(margin, y - 4, pageW - margin, y - 4);
      pdf.setFont("helvetica", "bold");
      pdf.text(`Day Total: ${g.totalSold}`, pageW - margin, y + 6, { align: "right" });
      y += 22;
    }

    ensureSpace(30);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.text(`Grand Total: ${grandTotal}`, pageW - margin, y + 10, { align: "right" });
    y += 28;

    // Per-collection summary page
    pdf.addPage();
    y = margin;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("Per Collection Summary", margin, y);
    y += 16;
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.text(`From ${from}  to  ${to}`, margin, y);
    y += 16;

    const cCol = { code: margin, name: margin + 130, color: pageW - margin - 200, qty: pageW - margin };
    const drawColHeader = () => {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.text("Code", cCol.code, y);
      pdf.text("Product", cCol.name, y);
      pdf.text("Color", cCol.color, y);
      pdf.text("Qty", cCol.qty, y, { align: "right" });
      y += 4;
      pdf.setDrawColor(180);
      pdf.line(margin, y, pageW - margin, y);
      y += 12;
      pdf.setFont("helvetica", "normal");
    };

    for (const cg of collectionGroups) {
      ensureSpace(60);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.setFillColor(230, 240, 255);
      pdf.rect(margin, y - 12, pageW - margin * 2, 18, "F");
      pdf.text(`Collection: ${cg.collection}`, margin + 6, y);
      y += 14;
      drawColHeader();
      for (const l of cg.lines) {
        ensureSpace(20);
        pdf.text(String(l.code).slice(0, 24), cCol.code, y);
        pdf.text(String(l.product_name).slice(0, 50), cCol.name, y);
        pdf.text(String(l.color ?? ""), cCol.color, y);
        pdf.text(String(l.qty), cCol.qty, y, { align: "right" });
        y += 16;
      }
      ensureSpace(20);
      pdf.setDrawColor(120);
      pdf.line(margin, y - 4, pageW - margin, y - 4);
      pdf.setFont("helvetica", "bold");
      pdf.text(`Collection Total: ${cg.total}`, pageW - margin, y + 6, { align: "right" });
      y += 22;
    }
    ensureSpace(30);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.text(`Grand Total: ${collectionsGrandTotal}`, pageW - margin, y + 10, { align: "right" });

    pdf.save(`shipping-order_${from}_to_${to}.pdf`);
    toast.success("تم تصدير PDF");
  };

  const exportCollectionsXlsx = () => {
    const aoa: any[][] = [];
    aoa.push(["ملخص حسب الكولكشن — Per Collection", "", "", ""]);
    aoa.push([`من ${from} إلى ${to}`, "", "", ""]);
    aoa.push([]);
    for (const cg of collectionGroups) {
      aoa.push([`Collection: ${cg.collection}`, "", "", ""]);
      aoa.push(["Code", "Product", "Color", "Qty"]);
      for (const l of cg.lines) {
        aoa.push([l.code, l.product_name, l.color ?? "", l.qty]);
      }
      aoa.push(["", "إجمالي الكولكشن / Collection Total", "", cg.total]);
      aoa.push([]);
    }
    aoa.push(["", "الإجمالي الكلي / Grand Total", "", collectionsGrandTotal]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 22 }, { wch: 38 }, { wch: 16 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Per Collection");
    XLSX.writeFile(wb, `collections-summary_${from}_to_${to}.xlsx`);
    toast.success("تم تصدير Excel");
  };

  const exportCollectionsPdf = () => {
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 36;
    let y = margin;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("Per Collection Summary", margin, y);
    y += 16;
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.text(`From ${from}  to  ${to}`, margin, y);
    y += 16;

    const cCol = { code: margin, name: margin + 130, color: pageW - margin - 200, qty: pageW - margin };
    const ensureSpace = (need = 24) => {
      if (y + need > pageH - margin) { pdf.addPage(); y = margin; }
    };
    const drawColHeader = () => {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.text("Code", cCol.code, y);
      pdf.text("Product", cCol.name, y);
      pdf.text("Color", cCol.color, y);
      pdf.text("Qty", cCol.qty, y, { align: "right" });
      y += 4;
      pdf.setDrawColor(180);
      pdf.line(margin, y, pageW - margin, y);
      y += 12;
      pdf.setFont("helvetica", "normal");
    };

    for (const cg of collectionGroups) {
      ensureSpace(60);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.setFillColor(230, 240, 255);
      pdf.rect(margin, y - 12, pageW - margin * 2, 18, "F");
      pdf.text(`Collection: ${cg.collection}`, margin + 6, y);
      y += 14;
      drawColHeader();
      for (const l of cg.lines) {
        ensureSpace(20);
        pdf.text(String(l.code).slice(0, 24), cCol.code, y);
        pdf.text(String(l.product_name).slice(0, 50), cCol.name, y);
        pdf.text(String(l.color ?? ""), cCol.color, y);
        pdf.text(String(l.qty), cCol.qty, y, { align: "right" });
        y += 16;
      }
      ensureSpace(20);
      pdf.setDrawColor(120);
      pdf.line(margin, y - 4, pageW - margin, y - 4);
      pdf.setFont("helvetica", "bold");
      pdf.text(`Collection Total: ${cg.total}`, pageW - margin, y + 6, { align: "right" });
      y += 22;
    }
    ensureSpace(30);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.text(`Grand Total: ${collectionsGrandTotal}`, pageW - margin, y + 10, { align: "right" });
    pdf.save(`collections-summary_${from}_to_${to}.pdf`);
    toast.success("تم تصدير PDF");
  };

  const setRange = (days: number) => {
    const end = new Date();
    const start = new Date(); start.setDate(start.getDate() - days + 1);
    const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setFrom(f(start)); setTo(f(end));
  };

  const setForwardRange = (days: number) => {
    const start = new Date();
    const end = new Date(); end.setDate(end.getDate() + days - 1);
    const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setFrom(f(start)); setTo(f(end));
  };

  return (
    <div className="container mx-auto p-4 space-y-4" dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Truck className="h-6 w-6 text-primary" /> {tt("طلبية الشحن", "Shipping Order")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {tt(
              "مرتبة بالأيام بناءً على الفواتير الفعلية فقط — بدون الملغاة أو المحذوفة. (Code / Sold / Packing List)",
              "Grouped by day based on actual invoices only — excluding voided/deleted. (Code / Sold / Packing List)",
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setLang(ar ? "en" : "ar")} variant="outline" size="sm" className="gap-1">
            <Languages className="h-4 w-4" /> {ar ? "EN" : "ع"}
          </Button>
          <Button onClick={load} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`h-4 w-4 mx-1 ${loading ? "animate-spin" : ""}`} /> {tt("تحديث", "Refresh")}
          </Button>
          <Button onClick={exportXlsx} size="sm" disabled={!groups.length}>
            <Download className="h-4 w-4 mx-1" /> Excel
          </Button>
          <Button onClick={exportPdf} size="sm" variant="secondary" disabled={!groups.length}>
            <FileText className="h-4 w-4 mx-1" /> PDF
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground">{tt("من", "From")}</label>
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{tt("إلى", "To")}</label>
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            <Button variant="outline" size="sm" onClick={() => { const d = todayISO(); setFrom(d); setTo(d); }}>{tt("اليوم", "Today")}</Button>
            <Button variant="outline" size="sm" onClick={() => setRange(7)}>{tt("آخر 7 أيام", "Last 7 days")}</Button>
            <Button variant="outline" size="sm" onClick={() => setRange(30)}>{tt("آخر 30 يوم", "Last 30 days")}</Button>
            <Button variant="outline" size="sm" onClick={() => setForwardRange(7)}>{tt("الأسبوع القادم", "Next week")}</Button>
            <Button variant="outline" size="sm" onClick={() => setForwardRange(30)}>{tt("الـ 30 يوم القادمة", "Next 30 days")}</Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{tt("عدد الأيام", "Days")}</div>
          <div className="text-3xl font-bold mt-1">{groups.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{tt("عدد الفواتير", "Invoices")}</div>
          <div className="text-3xl font-bold mt-1">{invoices.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{tt("إجمالي القطع للشحن", "Total units to ship")}</div>
          <div className="text-3xl font-bold mt-1 text-primary">{grandTotal}</div>
        </Card>
      </div>

      {groups.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">{tt("لا توجد فواتير في هذه الفترة", "No invoices in this range")}</Card>
      ) : (
        groups.map((g) => (
          <Card key={g.date} className="overflow-hidden">
            <div className="flex items-center justify-between border-b bg-muted/50 p-3">
              <h2 className="font-semibold flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-primary" /> {g.date}
              </h2>
              <Badge variant="secondary">{tt("إجمالي اليوم", "Day total")}: {g.totalSold}</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className={ar ? "text-right" : "text-left"}>
                    <th className="p-2 w-40">{tt("الكود", "Code")}</th>
                    <th className="p-2">{tt("المنتج", "Product")}</th>
                    <th className="p-2 w-20 text-center">{tt("المباع", "Sold")}</th>
                    <th className="p-2 w-32 text-center">{tt("قائمة التغليف", "Packing List")}</th>
                  </tr>
                </thead>
                <tbody>
                  {g.lines.map((l, idx) => (
                    <tr key={idx} className="border-t hover:bg-muted/20">
                      <td className="p-2 font-mono text-xs">{l.code}</td>
                      <td className="p-2">
                        {l.product_name}
                        {l.color && <span className="text-muted-foreground"> · {l.color}</span>}
                      </td>
                      <td className="p-2 text-center font-bold text-primary">{l.sold}</td>
                      <td className="p-2 text-center">
                        <span className="inline-block h-5 w-5 rounded border-2 border-muted-foreground/40" />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40 font-bold">
                  <tr className="border-t-2">
                    <td className="p-2" colSpan={2}>إجمالي اليوم</td>
                    <td className="p-2 text-center text-primary">{g.totalSold}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        ))
      )}

      {collectionGroups.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-primary/10 p-3">
            <h2 className="font-semibold">ملخص حسب الكولكشن خلال الفترة</h2>
            <div className="flex items-center gap-2">
              <Badge>الإجمالي: {collectionsGrandTotal}</Badge>
              <Button size="sm" variant="outline" onClick={exportCollectionsXlsx}>
                <Download className="h-4 w-4 ml-1" /> Excel
              </Button>
              <Button size="sm" variant="secondary" onClick={exportCollectionsPdf}>
                <FileText className="h-4 w-4 ml-1" /> PDF
              </Button>
            </div>
          </div>
          <div className="divide-y">
            {collectionGroups.map((cg) => (
              <div key={cg.collection}>
                <div className="flex items-center justify-between bg-muted/40 px-3 py-2">
                  <span className="font-bold">{cg.collection}</span>
                  <Badge variant="secondary">{cg.total}</Badge>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/20">
                      <tr className="text-right">
                        <th className="p-2 w-40">Code</th>
                        <th className="p-2">Product</th>
                        <th className="p-2 w-32">اللون</th>
                        <th className="p-2 w-20 text-center">العدد</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cg.lines.map((l, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2 font-mono text-xs">{l.code}</td>
                          <td className="p-2">{l.product_name}</td>
                          <td className="p-2 text-muted-foreground">{l.color ?? "—"}</td>
                          <td className="p-2 text-center font-bold text-primary">{l.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
