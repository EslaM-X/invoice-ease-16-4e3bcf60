import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime } from "@/lib/utils-money";
import type { Lang } from "@/lib/i18n";

const L = (lang: Lang, ar: string, en: string) => (lang === "ar" ? ar : en);

async function fetchAll(userId: string) {
  const [customers, products, invoices, invoiceItems, inventoryLogs, invoiceEvents] = await Promise.all([
    supabase.from("customers").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("products").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("invoices").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("invoice_items").select("*, invoices!inner(user_id, invoice_number)").eq("invoices.user_id", userId),
    supabase.from("inventory_logs").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("invoice_events").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
  ]);
  return {
    customers: customers.data ?? [],
    products: products.data ?? [],
    invoices: invoices.data ?? [],
    invoiceItems: (invoiceItems.data ?? []) as any[],
    inventoryLogs: inventoryLogs.data ?? [],
    invoiceEvents: invoiceEvents.data ?? [],
  };
}

export async function exportFullBackupExcel(userId: string, lang: Lang) {
  const d = await fetchAll(userId);
  const wb = XLSX.utils.book_new();

  const customers = d.customers.map((c: any, i) => ({
    "#": i + 1,
    [L(lang, "الاسم", "Name")]: c.name,
    [L(lang, "الهاتف", "Phone")]: c.phone || "",
    [L(lang, "العنوان", "Address")]: c.address || "",
    [L(lang, "تاريخ الإضافة", "Added On")]: fmtDateTime(c.created_at, lang),
  }));
  const products = d.products.map((p: any, i) => ({
    "#": i + 1,
    [L(lang, "الاسم", "Name")]: p.name,
    [L(lang, "الرقم التسلسلي", "Serial #")]: p.serial_number || "",
    [L(lang, "اللون", "Color")]: p.color || "",
    [L(lang, "السعر", "Price")]: Number(p.price),
    [L(lang, "المخزون", "Stock")]: p.stock_quantity,
    [L(lang, "حد التنبيه", "Low Stock")]: p.low_stock_threshold,
  }));
  const invoices = d.invoices.map((inv: any) => ({
    [L(lang, "رقم الإيصال", "Receipt #")]: inv.receipt_number ?? "",
    [L(lang, "رقم الفاتورة", "Invoice #")]: inv.invoice_number,
    [L(lang, "العميل", "Customer")]: inv.customer_name || "",
    [L(lang, "الهاتف", "Phone")]: inv.customer_phone || "",
    [L(lang, "المجموع الفرعي", "Subtotal")]: Number(inv.subtotal),
    [L(lang, "الخصم", "Discount")]: Number(inv.discount),
    [L(lang, "الإجمالي", "Total")]: Number(inv.total),
    [L(lang, "الحالة", "Status")]: inv.status,
    [L(lang, "التاريخ والوقت", "Date & Time")]: fmtDateTime(inv.created_at, lang),
    [L(lang, "ملاحظات", "Notes")]: inv.notes || "",
  }));
  const items = d.invoiceItems.map((it: any) => ({
    [L(lang, "رقم الفاتورة", "Invoice #")]: it.invoices?.invoice_number ?? "",
    [L(lang, "المنتج", "Product")]: it.product_name,
    [L(lang, "الرقم التسلسلي", "Serial #")]: it.serial_number || "",
    [L(lang, "اللون", "Color")]: it.color || "",
    [L(lang, "الكمية", "Qty")]: it.quantity,
    [L(lang, "سعر الوحدة", "Unit Price")]: Number(it.unit_price),
    [L(lang, "الخصم", "Discount")]: Number(it.discount),
    [L(lang, "الإجمالي", "Line Total")]: Number(it.line_total),
  }));
  const logs = d.inventoryLogs.map((g: any) => ({
    [L(lang, "التاريخ والوقت", "Date & Time")]: fmtDateTime(g.created_at, lang),
    [L(lang, "المنتج (ID)", "Product ID")]: g.product_id,
    [L(lang, "التغيير", "Change")]: g.change,
    [L(lang, "السبب", "Reason")]: g.reason || "",
    [L(lang, "فاتورة (ID)", "Invoice ID")]: g.invoice_id || "",
  }));
  const events = d.invoiceEvents.map((e: any) => ({
    [L(lang, "التاريخ والوقت", "Date & Time")]: fmtDateTime(e.created_at, lang),
    [L(lang, "فاتورة (ID)", "Invoice ID")]: e.invoice_id,
    [L(lang, "النوع", "Event")]: e.event_type,
    [L(lang, "تفاصيل", "Details")]: JSON.stringify(e.details ?? {}),
  }));

  const append = (rows: any[], name: string) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "—": "" }]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };
  append(customers, L(lang, "العملاء", "Customers"));
  append(products, L(lang, "المنتجات", "Products"));
  append(invoices, L(lang, "الفواتير", "Invoices"));
  append(items, L(lang, "بنود الفواتير", "Invoice Items"));
  append(logs, L(lang, "سجل المخزون", "Inventory Logs"));
  append(events, L(lang, "أحداث الفواتير", "Invoice Events"));

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `backup-${date}.xlsx`);
}

function csvEscape(v: any) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCSV(filename: string, headers: string[], rows: any[][]) {
  const lines = [headers.join(",")].concat(rows.map((r) => r.map(csvEscape).join(",")));
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export async function exportFullBackupCSV(userId: string, lang: Lang) {
  const d = await fetchAll(userId);
  const date = new Date().toISOString().slice(0, 10);

  downloadCSV(`customers-${date}.csv`,
    [L(lang, "الاسم", "Name"), L(lang, "الهاتف", "Phone"), L(lang, "العنوان", "Address"), L(lang, "تاريخ الإضافة", "Added On")],
    d.customers.map((c: any) => [c.name, c.phone || "", c.address || "", fmtDateTime(c.created_at, lang)]));

  downloadCSV(`products-${date}.csv`,
    [L(lang, "الاسم", "Name"), L(lang, "الرقم التسلسلي", "Serial"), L(lang, "اللون", "Color"), L(lang, "السعر", "Price"), L(lang, "المخزون", "Stock")],
    d.products.map((p: any) => [p.name, p.serial_number || "", p.color || "", p.price, p.stock_quantity]));

  downloadCSV(`invoices-${date}.csv`,
    [L(lang, "رقم الإيصال", "Receipt #"), L(lang, "رقم الفاتورة", "Invoice #"), L(lang, "العميل", "Customer"),
     L(lang, "الهاتف", "Phone"), L(lang, "المجموع الفرعي", "Subtotal"), L(lang, "الخصم", "Discount"),
     L(lang, "الإجمالي", "Total"), L(lang, "الحالة", "Status"), L(lang, "التاريخ", "Date")],
    d.invoices.map((i: any) => [i.receipt_number ?? "", i.invoice_number, i.customer_name || "",
      i.customer_phone || "", i.subtotal, i.discount, i.total, i.status, fmtDateTime(i.created_at, lang)]));

  downloadCSV(`invoice-items-${date}.csv`,
    [L(lang, "رقم الفاتورة", "Invoice #"), L(lang, "المنتج", "Product"), L(lang, "الرقم التسلسلي", "Serial"),
     L(lang, "اللون", "Color"), L(lang, "الكمية", "Qty"), L(lang, "سعر الوحدة", "Unit Price"),
     L(lang, "الخصم", "Discount"), L(lang, "الإجمالي", "Line Total")],
    d.invoiceItems.map((it: any) => [it.invoices?.invoice_number ?? "", it.product_name, it.serial_number || "",
      it.color || "", it.quantity, it.unit_price, it.discount, it.line_total]));

  downloadCSV(`inventory-logs-${date}.csv`,
    [L(lang, "التاريخ", "Date"), L(lang, "المنتج (ID)", "Product ID"), L(lang, "التغيير", "Change"), L(lang, "السبب", "Reason"), L(lang, "فاتورة (ID)", "Invoice ID")],
    d.inventoryLogs.map((g: any) => [fmtDateTime(g.created_at, lang), g.product_id, g.change, g.reason || "", g.invoice_id || ""]));
}
