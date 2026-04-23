import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { fmtMoney, fmtDateTime } from "@/lib/utils-money";
import type { Lang } from "@/lib/i18n";

export type InvoiceRow = {
  id: string;
  invoice_number: string;
  receipt_number: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  total: number;
  subtotal: number;
  discount: number;
  status: string;
  created_at: string;
};

export function exportInvoicesToExcel(rows: InvoiceRow[], lang: Lang) {
  const data = rows.map((r) => ({
    [lang === "ar" ? "رقم الإيصال" : "Receipt #"]: r.receipt_number ?? "",
    [lang === "ar" ? "رقم الفاتورة" : "Invoice #"]: r.invoice_number,
    [lang === "ar" ? "العميل" : "Customer"]: r.customer_name || "",
    [lang === "ar" ? "الهاتف" : "Phone"]: r.customer_phone || "",
    [lang === "ar" ? "التاريخ والوقت" : "Date & Time"]: fmtDateTime(r.created_at, lang),
    [lang === "ar" ? "المجموع الفرعي" : "Subtotal"]: Number(r.subtotal),
    [lang === "ar" ? "الخصم" : "Discount"]: Number(r.discount),
    [lang === "ar" ? "الإجمالي" : "Total"]: Number(r.total),
    [lang === "ar" ? "الحالة" : "Status"]: r.status,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Invoices");
  XLSX.writeFile(wb, `invoices-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportInvoicesToCSV(rows: InvoiceRow[], lang: Lang) {
  const headers = lang === "ar"
    ? ["رقم الإيصال", "رقم الفاتورة", "العميل", "الهاتف", "التاريخ والوقت", "المجموع الفرعي", "الخصم", "الإجمالي", "الحالة"]
    : ["Receipt #", "Invoice #", "Customer", "Phone", "Date & Time", "Subtotal", "Discount", "Total", "Status"];
  const escape = (v: any) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      r.receipt_number ?? "",
      r.invoice_number,
      r.customer_name ?? "",
      r.customer_phone ?? "",
      fmtDateTime(r.created_at, lang),
      Number(r.subtotal).toFixed(2),
      Number(r.discount).toFixed(2),
      Number(r.total).toFixed(2),
      r.status,
    ].map(escape).join(","));
  }
  // Prepend BOM for Excel UTF-8 compatibility (Arabic)
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Generate a single PDF containing one page per invoice (summary). */
export async function exportInvoicesBatchPDF(rows: InvoiceRow[], lang: Lang, currency = "EGP") {
  const isAr = lang === "ar";
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = 40;

  for (let idx = 0; idx < rows.length; idx++) {
    const inv = rows[idx];
    const { data: items } = await supabase.from("invoice_items").select("*").eq("invoice_id", inv.id);

    if (idx > 0) pdf.addPage();

    pdf.setFontSize(20);
    pdf.setFont("helvetica", "bold");
    pdf.text("Steinheim", margin, 60);

    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.text(isAr ? "فاتورة / Invoice" : "Invoice", pageW - margin, 50, { align: "right" });
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.text(inv.invoice_number, pageW - margin, 68, { align: "right" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(`Receipt #${inv.receipt_number ?? "-"}`, pageW - margin, 84, { align: "right" });
    pdf.text(fmtDateTime(inv.created_at, "en"), pageW - margin, 98, { align: "right" });

    pdf.setDrawColor(220);
    pdf.line(margin, 115, pageW - margin, 115);

    pdf.setFontSize(9);
    pdf.setTextColor(120);
    pdf.text("BILL TO", margin, 135);
    pdf.setTextColor(0);
    pdf.setFontSize(11);
    pdf.text(inv.customer_name || "-", margin, 152);
    pdf.setFontSize(9);
    pdf.setTextColor(120);
    pdf.text(inv.customer_phone || "", margin, 166);
    pdf.setTextColor(0);

    // Items table
    let y = 200;
    pdf.setFontSize(9);
    pdf.setTextColor(120);
    pdf.text("ITEM", margin, y);
    pdf.text("QTY", pageW - margin - 200, y, { align: "right" });
    pdf.text("PRICE", pageW - margin - 100, y, { align: "right" });
    pdf.text("TOTAL", pageW - margin, y, { align: "right" });
    pdf.setTextColor(0);
    y += 6;
    pdf.line(margin, y, pageW - margin, y);
    y += 14;
    pdf.setFontSize(10);

    for (const it of items ?? []) {
      if (y > 750) { pdf.addPage(); y = 60; }
      const name = String(it.product_name ?? "").slice(0, 50);
      pdf.text(name, margin, y);
      pdf.text(String(it.quantity), pageW - margin - 200, y, { align: "right" });
      pdf.text(fmtMoney(Number(it.unit_price), currency, "en").replace(/[^\d.,-]/g, ""), pageW - margin - 100, y, { align: "right" });
      pdf.text(fmtMoney(Number(it.line_total), currency, "en").replace(/[^\d.,-]/g, ""), pageW - margin, y, { align: "right" });
      y += 18;
    }

    y += 10;
    pdf.line(margin + 300, y, pageW - margin, y);
    y += 18;
    pdf.setFontSize(10);
    pdf.text("Subtotal", margin + 300, y);
    pdf.text(fmtMoney(Number(inv.subtotal), currency, "en"), pageW - margin, y, { align: "right" });
    y += 16;
    pdf.text("Discount", margin + 300, y);
    pdf.text(`-${fmtMoney(Number(inv.discount), currency, "en")}`, pageW - margin, y, { align: "right" });
    y += 8;
    pdf.line(margin + 300, y, pageW - margin, y);
    y += 18;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.text("TOTAL", margin + 300, y);
    pdf.text(fmtMoney(Number(inv.total), currency, "en"), pageW - margin, y, { align: "right" });
    pdf.setFont("helvetica", "normal");

    if (inv.status === "voided") {
      pdf.setTextColor(200, 30, 30);
      pdf.setFontSize(60);
      pdf.text("VOIDED", pageW / 2, 400, { align: "center", angle: -20 });
      pdf.setTextColor(0);
    }
  }

  pdf.save(`invoices-${new Date().toISOString().slice(0, 10)}.pdf`);
}
