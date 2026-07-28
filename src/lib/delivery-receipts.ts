import { supabase } from "@/integrations/supabase/client";
import { isMultiPartProduct, parsePartFromNote } from "@/lib/product-parts";

export type DRItemInput = {
  invoice_item_id: string;
  quantity: number;
  note?: string | null;
};

export type DRPayload = {
  delivered_to_name?: string | null;
  delivered_to_phone?: string | null;
  delivered_to_id_number?: string | null;
  notes?: string | null;
  manager_name?: string | null;
  accountant_name?: string | null;
  signature_customer?: string | null;
  signature_manager?: string | null;
  signature_accountant?: string | null;
  status?: "draft" | "signed" | "out_for_delivery";
  shipping_fees?: number | null;
  tax_enabled?: boolean | null;
  items: DRItemInput[];
};

export async function createDeliveryReceipt(invoiceId: string, p: DRPayload) {
  const { data, error } = await supabase.rpc("create_delivery_receipt" as any, {
    _invoice_id: invoiceId,
    _delivered_to_name: p.delivered_to_name ?? null,
    _delivered_to_phone: p.delivered_to_phone ?? null,
    _delivered_to_id_number: p.delivered_to_id_number ?? null,
    _notes: p.notes ?? null,
    _manager_name: p.manager_name ?? null,
    _accountant_name: p.accountant_name ?? null,
    _signature_customer: p.signature_customer ?? null,
    _signature_manager: p.signature_manager ?? null,
    _signature_accountant: p.signature_accountant ?? null,
    _status: p.status ?? "draft",
    _items: p.items as any,
    _shipping_fees: p.shipping_fees ?? null,
    _tax_enabled: p.tax_enabled ?? false,
  } as any);
  if (error) throw error;
  return data as string;
}

export async function updateDeliveryReceipt(receiptId: string, p: DRPayload) {
  const { data, error } = await supabase.rpc("update_delivery_receipt" as any, {
    _receipt_id: receiptId,
    _delivered_to_name: p.delivered_to_name ?? null,
    _delivered_to_phone: p.delivered_to_phone ?? null,
    _delivered_to_id_number: p.delivered_to_id_number ?? null,
    _notes: p.notes ?? null,
    _manager_name: p.manager_name ?? null,
    _accountant_name: p.accountant_name ?? null,
    _signature_customer: p.signature_customer ?? null,
    _signature_manager: p.signature_manager ?? null,
    _signature_accountant: p.signature_accountant ?? null,
    _status: p.status ?? "draft",
    _items: p.items as any,
    _shipping_fees: p.shipping_fees ?? null,
    _tax_enabled: p.tax_enabled ?? null,
  } as any);
  if (error) throw error;
  return data as string;
}

export type InvoiceItemWithDelivered = {
  id: string;
  product_id: string | null;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  quantity: number;
  delivered_qty: number;
  remaining: number;
};

type InvoiceLineForMatching = Pick<
  InvoiceItemWithDelivered,
  "id" | "product_name" | "serial_number" | "color"
>;

type ReceiptItemForMatching = {
  invoice_item_id?: string | null;
  product_name?: string | null;
  serial_number?: string | null;
  color?: string | null;
};

const normalizeReceiptText = (value?: string | null) =>
  String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

const normalizeReceiptSerial = (value?: string | null) =>
  String(value ?? "").trim().replace(/[\s_\-./]+/g, "").toLowerCase();

export function legacyReceiptItemMatchesInvoiceLine(
  receiptItem: ReceiptItemForMatching,
  item: InvoiceLineForMatching,
) {
  if (normalizeReceiptText(receiptItem.product_name) !== normalizeReceiptText(item.product_name)) return false;

  const receiptSerial = normalizeReceiptSerial(receiptItem.serial_number);
  if (receiptSerial && receiptSerial !== normalizeReceiptSerial(item.serial_number)) return false;

  const receiptColor = normalizeReceiptText(receiptItem.color);
  if (receiptColor && receiptColor !== normalizeReceiptText(item.color)) return false;

  return true;
}

export function resolveReceiptInvoiceItemId(
  receiptItem: ReceiptItemForMatching,
  invoiceItems: InvoiceLineForMatching[],
) {
  if (receiptItem.invoice_item_id) return receiptItem.invoice_item_id;

  const matches = invoiceItems.filter((item) => legacyReceiptItemMatchesInvoiceLine(receiptItem, item));
  if (matches.length === 1) return matches[0].id;

  if (matches.length > 1) {
    const receiptSerial = normalizeReceiptSerial(receiptItem.serial_number);
    const receiptColor = normalizeReceiptText(receiptItem.color);
    const exact = matches.find((item) =>
      (!receiptSerial || receiptSerial === normalizeReceiptSerial(item.serial_number)) &&
      (!receiptColor || receiptColor === normalizeReceiptText(item.color)),
    );
    if (exact) return exact.id;
  }

  return null;
}

export async function fetchInvoiceItemsWithDelivered(
  invoiceId: string,
  excludeReceiptId?: string,
): Promise<InvoiceItemWithDelivered[]> {
  const { data: items } = await supabase
    .from("invoice_items")
    .select("id, product_id, product_name, serial_number, color, quantity")
    .eq("invoice_id", invoiceId);

  const invoiceItems = (items ?? []) as InvoiceItemWithDelivered[];
  if (invoiceItems.length === 0) return [];

  const { data: siblingReceipts } = await supabase
    .from("delivery_receipts" as any)
    .select("id, status")
    .eq("invoice_id", invoiceId);

  const receiptIds = ((siblingReceipts ?? []) as any[]).map((r) => r.id).filter(Boolean);
  const { data: dris } = receiptIds.length > 0
    ? await supabase
      .from("delivery_receipt_items" as any)
      .select("invoice_item_id, product_name, serial_number, color, quantity, receipt_id")
      .in("receipt_id", receiptIds)
    : { data: [] } as { data: any[] };

  const receiptStatus = new Map<string, string>();
  for (const rec of (siblingReceipts ?? []) as any[]) receiptStatus.set(rec.id, rec.status);
  const activeStatuses = new Set(["draft", "out_for_delivery", "signed", "paid"]);

  const totals = new Map<string, number>();
  for (const r of (dris ?? []) as any[]) {
    if (excludeReceiptId && r.receipt_id === excludeReceiptId) continue;
    if (!activeStatuses.has(receiptStatus.get(r.receipt_id) ?? "")) continue;
    const invoiceItemId = resolveReceiptInvoiceItemId(r, invoiceItems);
    if (!invoiceItemId) continue;
    totals.set(invoiceItemId, (totals.get(invoiceItemId) || 0) + (r.quantity || 0));
  }

  return invoiceItems.map((i: any) => {
    const delivered = totals.get(i.id) || 0;
    return {
      id: i.id,
      product_id: i.product_id ?? null,
      product_name: i.product_name,
      serial_number: i.serial_number,
      color: i.color,
      quantity: i.quantity,
      delivered_qty: delivered,
      remaining: Math.max(0, i.quantity - delivered),
    };
  });
}

export function deliveryStatusLabel(status: string | null | undefined, isAr: boolean) {
  switch (status) {
    case "delivered": return isAr ? "تم التسليم" : "Delivered";
    case "partial": return isAr ? "تسليم جزئي" : "Partial";
    default: return isAr ? "لم يُسلَّم" : "Pending";
  }
}

export function deliveryStatusColor(status: string | null | undefined) {
  switch (status) {
    case "delivered":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    case "partial":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export type PartAggregate = {
  full: number;
  mixer: number;
  trim: number;
};

export type PrintRow = {
  invoice_item_id: string;
  product_id: string | null;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  invoice_qty: number;
  unit_price: number;           // from invoice_items, used for tax subtotal
  this_qty: number;             // qty delivered in THIS receipt
  this_note: string | null;     // note stored in THIS receipt
  prior_qty: number;            // qty delivered in EARLIER receipts (before this one)
  later_qty: number;            // qty delivered in LATER receipts (after this one)
  is_multi_part: boolean;
  // Per-part breakdown across the three buckets (each row represents one unit)
  parts_this: PartAggregate;    // parts delivered in this receipt
  parts_prior: PartAggregate;   // parts delivered in earlier receipts
  parts_later: PartAggregate;   // parts delivered in later receipts
};

/**
 * Build a merged list of ALL invoice items with per-receipt delivery breakdown,
 * used by the new (layout_version >= 2) receipt view / PDF.
 */
export async function fetchInvoiceItemsForPrint(
  invoiceId: string,
  receiptId: string,
  receiptCreatedAt: string,
): Promise<PrintRow[]> {
  const { data: items } = await supabase
    .from("invoice_items")
    .select("id, product_id, product_name, serial_number, color, quantity, unit_price, created_at")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: true });

  const itemIds = (items ?? []).map((i: any) => i.id);
  if (itemIds.length === 0) return [];

  const invoiceItems = (items ?? []) as InvoiceLineForMatching[];

  const { data: siblingReceipts } = await supabase
    .from("delivery_receipts" as any)
    .select("id, created_at, status")
    .eq("invoice_id", invoiceId);

  const siblingReceiptIds = ((siblingReceipts ?? []) as any[]).map((receipt) => receipt.id).filter(Boolean);

  // Pull all sibling delivery_receipt_items across ALL receipts of this invoice.
  // Older receipts may have invoice_item_id = null, so we match them back to
  // invoice lines by product/serial/color instead of letting the print view show 0.
  const { data: dris } = siblingReceiptIds.length > 0
    ? await supabase
      .from("delivery_receipt_items" as any)
      .select("invoice_item_id, product_name, serial_number, color, quantity, note, receipt_id")
      .in("receipt_id", siblingReceiptIds)
    : { data: [] } as { data: any[] };

  // Fetch created_at for all sibling receipts to classify prior/later
  const receiptCreatedAtMap = new Map<string, string>();
  const receiptStatusMap = new Map<string, string>();
  for (const rec of (siblingReceipts ?? []) as any[]) {
    receiptCreatedAtMap.set(rec.id, rec.created_at);
    receiptStatusMap.set(rec.id, rec.status);
  }
  const activeStatuses = new Set(["draft", "out_for_delivery", "signed", "paid"]);

  const zeroParts = (): PartAggregate => ({ full: 0, mixer: 0, trim: 0 });
  const thisMap = new Map<string, { qty: number; note: string | null }>();
  const priorMap = new Map<string, number>();
  const laterMap = new Map<string, number>();
  const partsThisMap = new Map<string, PartAggregate>();
  const partsPriorMap = new Map<string, PartAggregate>();
  const partsLaterMap = new Map<string, PartAggregate>();

  for (const r of (dris ?? []) as any[]) {
    const qty = r.quantity || 0;
    const invoiceItemId = resolveReceiptInvoiceItemId(r, invoiceItems);
    if (!invoiceItemId) continue;
    // Determine bucket: this / prior / later
    let bucketParts: Map<string, PartAggregate>;
    if (r.receipt_id === receiptId) {
      const cur = thisMap.get(invoiceItemId) ?? { qty: 0, note: null };
      cur.qty += qty;
      if (!cur.note && r.note) cur.note = r.note;
      thisMap.set(invoiceItemId, cur);
      bucketParts = partsThisMap;
    } else {
      if (!activeStatuses.has(receiptStatusMap.get(r.receipt_id) ?? "")) continue;
      const otherCreatedAt = receiptCreatedAtMap.get(r.receipt_id);
      const isPrior = otherCreatedAt ? otherCreatedAt < receiptCreatedAt : false;
      const m = isPrior ? priorMap : laterMap;
      m.set(invoiceItemId, (m.get(invoiceItemId) || 0) + qty);
      bucketParts = isPrior ? partsPriorMap : partsLaterMap;
    }
    const { part } = parsePartFromNote(r.note);
    const agg = bucketParts.get(invoiceItemId) ?? zeroParts();
    agg[part] += qty;
    bucketParts.set(invoiceItemId, agg);
  }

  return (items ?? []).map((it: any) => {
    const t = thisMap.get(it.id);
    const multi = isMultiPartProduct(it.product_name);
    return {
      invoice_item_id: it.id,
      product_id: it.product_id ?? null,
      product_name: it.product_name,
      serial_number: it.serial_number,
      color: it.color,
      invoice_qty: it.quantity,
      unit_price: Number(it.unit_price ?? 0),
      this_qty: t?.qty ?? 0,
      this_note: t?.note ?? null,
      prior_qty: priorMap.get(it.id) ?? 0,
      later_qty: laterMap.get(it.id) ?? 0,
      is_multi_part: multi,
      parts_this: partsThisMap.get(it.id) ?? zeroParts(),
      parts_prior: partsPriorMap.get(it.id) ?? zeroParts(),
      parts_later: partsLaterMap.get(it.id) ?? zeroParts(),
    };
  });
}

/** Render an HTML element to a single multi-page A4 PDF. Returns a jsPDF instance. */
export async function elementToPdf(el: HTMLElement) {
  const { default: html2canvas } = await import("html2canvas");
  const { default: jsPDF } = await import("jspdf");
  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
  });
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;
  let heightLeft = imgH;
  let position = 0;
  const imgData = canvas.toDataURL("image/jpeg", 0.95);
  pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH);
  heightLeft -= pageH;
  while (heightLeft > 0) {
    position = heightLeft - imgH;
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH);
    heightLeft -= pageH;
  }
  return pdf;
}
