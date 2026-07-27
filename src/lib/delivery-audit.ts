/**
 * Delivery Audit — READ-ONLY aggregation over existing tables.
 *
 * NEVER writes. NEVER mutates. NEVER touches invoices, delivery_receipts,
 * delivery_receipt_items, or any trigger. Pure SELECT + in-memory aggregation.
 *
 * Purpose: an independent, professional audit surface for every delivery
 * receipt in the system, tracking per-invoice / per-line delivered vs
 * remaining across ALL receipts (draft, out_for_delivery, signed, paid,
 * returned, cancelled).
 */
import { supabase } from "@/integrations/supabase/client";

export type DRStatus =
  | "draft"
  | "out_for_delivery"
  | "signed"
  | "paid"
  | "returned"
  | "cancelled";

export type AuditReceipt = {
  id: string;
  receipt_number: string;
  status: DRStatus;
  created_at: string;
  delivered_at: string | null;
  delivered_to_name: string | null;
  delivered_to_phone: string | null;
  notes: string | null;
  created_by_email: string | null;
  updated_by_email: string | null;
  items: AuditReceiptItem[];
  total_qty: number;
};

export type AuditReceiptItem = {
  id: string;
  invoice_item_id: string | null;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  quantity: number;
  note: string | null;
};

export type AuditInvoiceLine = {
  invoice_item_id: string;
  product_id: string | null;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  invoice_qty: number;
  delivered_qty_effective: number; // signed + paid
  delivered_qty_in_transit: number; // draft + out_for_delivery
  delivered_qty_cancelled: number; // returned + cancelled
  remaining: number; // invoice_qty - effective (clamped >= 0)
  over_delivered: boolean; // effective > invoice_qty
};

export type AuditInvoice = {
  invoice_id: string;
  invoice_number: string;
  customer_name: string | null;
  invoice_status: string | null;
  invoice_delivery_status: string | null;
  created_at: string;
  total: number;
  receipts_count: number;
  invoice_total_qty: number;
  delivered_total_effective: number;
  delivered_total_in_transit: number;
  remaining_total: number;
  completion_pct: number; // 0..100 based on effective
  status_bucket: "none" | "partial" | "complete" | "over";
  lines: AuditInvoiceLine[];
  receipts: AuditReceipt[];
};

const EFFECTIVE_STATUSES: DRStatus[] = ["signed", "paid"];
const IN_TRANSIT_STATUSES: DRStatus[] = ["draft", "out_for_delivery"];

/** Fetches every invoice that has at least one delivery receipt + full breakdown. */
export async function fetchDeliveryAudit(): Promise<AuditInvoice[]> {
  // 1) All delivery receipts (all statuses, all time)
  const { data: receiptsRaw, error: recErr } = await supabase
    .from("delivery_receipts" as any)
    .select(
      "id, invoice_id, receipt_number, status, created_at, delivered_at, delivered_to_name, delivered_to_phone, notes, created_by_email, updated_by_email",
    )
    .order("created_at", { ascending: false });
  if (recErr) throw recErr;
  const receipts = (receiptsRaw ?? []) as any[];
  if (receipts.length === 0) return [];

  const receiptIds = receipts.map((r) => r.id);
  const invoiceIds = Array.from(new Set(receipts.map((r) => r.invoice_id)));

  // 2) All items across those receipts
  const { data: driRaw, error: driErr } = await supabase
    .from("delivery_receipt_items" as any)
    .select(
      "id, receipt_id, invoice_item_id, product_name, serial_number, color, quantity, note",
    )
    .in("receipt_id", receiptIds);
  if (driErr) throw driErr;
  const dri = (driRaw ?? []) as any[];

  // 3) Parent invoices
  const { data: invRaw } = await supabase
    .from("invoices")
    .select("id, invoice_number, customer_name, status, delivery_status, created_at, total")
    .in("id", invoiceIds);
  const invoices = (invRaw ?? []) as any[];
  const invMap = new Map<string, any>(invoices.map((i) => [i.id, i]));

  // 4) Invoice items for those invoices
  const { data: itemsRaw } = await supabase
    .from("invoice_items")
    .select("id, invoice_id, product_id, product_name, serial_number, color, quantity")
    .in("invoice_id", invoiceIds);
  const invoiceItems = (itemsRaw ?? []) as any[];

  // Group DR items by receipt
  const itemsByReceipt = new Map<string, AuditReceiptItem[]>();
  for (const it of dri) {
    const arr = itemsByReceipt.get(it.receipt_id) ?? [];
    arr.push({
      id: it.id,
      invoice_item_id: it.invoice_item_id,
      product_name: it.product_name,
      serial_number: it.serial_number,
      color: it.color,
      quantity: Number(it.quantity) || 0,
      note: it.note,
    });
    itemsByReceipt.set(it.receipt_id, arr);
  }

  // Build receipts by invoice
  const receiptsByInvoice = new Map<string, AuditReceipt[]>();
  const receiptStatus = new Map<string, DRStatus>();
  for (const r of receipts) {
    receiptStatus.set(r.id, r.status);
    const items = itemsByReceipt.get(r.id) ?? [];
    const total_qty = items.reduce((a, b) => a + b.quantity, 0);
    const rec: AuditReceipt = {
      id: r.id,
      receipt_number: r.receipt_number,
      status: r.status,
      created_at: r.created_at,
      delivered_at: r.delivered_at,
      delivered_to_name: r.delivered_to_name,
      delivered_to_phone: r.delivered_to_phone,
      notes: r.notes,
      created_by_email: r.created_by_email,
      updated_by_email: r.updated_by_email,
      items,
      total_qty,
    };
    const arr = receiptsByInvoice.get(r.invoice_id) ?? [];
    arr.push(rec);
    receiptsByInvoice.set(r.invoice_id, arr);
  }

  // Group invoice items by invoice
  const linesByInvoice = new Map<string, any[]>();
  for (const it of invoiceItems) {
    const arr = linesByInvoice.get(it.invoice_id) ?? [];
    arr.push(it);
    linesByInvoice.set(it.invoice_id, arr);
  }

  // Delivered qty aggregation per invoice_item, per status bucket
  // Key: invoice_item_id
  type Buckets = { eff: number; transit: number; cancelled: number };
  const perItem = new Map<string, Buckets>();
  for (const it of dri) {
    if (!it.invoice_item_id) continue;
    const st = receiptStatus.get(it.receipt_id);
    const b = perItem.get(it.invoice_item_id) ?? { eff: 0, transit: 0, cancelled: 0 };
    const q = Number(it.quantity) || 0;
    if (st && EFFECTIVE_STATUSES.includes(st)) b.eff += q;
    else if (st && IN_TRANSIT_STATUSES.includes(st)) b.transit += q;
    else b.cancelled += q;
    perItem.set(it.invoice_item_id, b);
  }

  const result: AuditInvoice[] = [];
  for (const invId of invoiceIds) {
    const inv = invMap.get(invId);
    const invLines = linesByInvoice.get(invId) ?? [];
    const recs = (receiptsByInvoice.get(invId) ?? []).sort(
      (a, b) => (a.created_at < b.created_at ? 1 : -1),
    );

    let totalQty = 0;
    let totalEff = 0;
    let totalTransit = 0;
    const lines: AuditInvoiceLine[] = invLines.map((it: any) => {
      const b = perItem.get(it.id) ?? { eff: 0, transit: 0, cancelled: 0 };
      const qty = Number(it.quantity) || 0;
      totalQty += qty;
      totalEff += b.eff;
      totalTransit += b.transit;
      return {
        invoice_item_id: it.id,
        product_id: it.product_id ?? null,
        product_name: it.product_name,
        serial_number: it.serial_number,
        color: it.color,
        invoice_qty: qty,
        delivered_qty_effective: b.eff,
        delivered_qty_in_transit: b.transit,
        delivered_qty_cancelled: b.cancelled,
        remaining: Math.max(0, qty - b.eff),
        over_delivered: b.eff > qty,
      };
    });

    const remaining = Math.max(0, totalQty - totalEff);
    const pct = totalQty > 0 ? Math.min(100, Math.round((totalEff / totalQty) * 100)) : 0;
    let bucket: AuditInvoice["status_bucket"] = "none";
    if (totalEff === 0) bucket = "none";
    else if (totalEff >= totalQty && lines.every((l) => !l.over_delivered)) bucket = "complete";
    else if (lines.some((l) => l.over_delivered)) bucket = "over";
    else bucket = "partial";

    result.push({
      invoice_id: invId,
      invoice_number: inv?.invoice_number ?? "(deleted)",
      customer_name: inv?.customer_name ?? null,
      invoice_status: inv?.status ?? null,
      invoice_delivery_status: inv?.delivery_status ?? null,
      created_at: inv?.created_at ?? recs[recs.length - 1]?.created_at ?? "",
      total: Number(inv?.total ?? 0),
      receipts_count: recs.length,
      invoice_total_qty: totalQty,
      delivered_total_effective: totalEff,
      delivered_total_in_transit: totalTransit,
      remaining_total: remaining,
      completion_pct: pct,
      status_bucket: bucket,
      lines,
      receipts: recs,
    });
  }

  // Sort: invoices with in-transit first, then partial, then most recent
  result.sort((a, b) => {
    const score = (x: AuditInvoice) =>
      (x.delivered_total_in_transit > 0 ? 0 : 1) * 100 +
      (x.status_bucket === "partial" ? 0 : x.status_bucket === "none" ? 1 : 2);
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa - sb;
    return a.created_at < b.created_at ? 1 : -1;
  });

  return result;
}

export function drStatusLabel(status: DRStatus, isAr: boolean): string {
  const map: Record<DRStatus, [string, string]> = {
    draft: ["مسودة", "Draft"],
    out_for_delivery: ["في الطريق", "Out for delivery"],
    signed: ["موقَّع", "Signed"],
    paid: ["مدفوع", "Paid"],
    returned: ["مرتجع", "Returned"],
    cancelled: ["ملغى", "Cancelled"],
  };
  const [ar, en] = map[status] ?? [status, status];
  return isAr ? ar : en;
}

export function drStatusColor(status: DRStatus): string {
  switch (status) {
    case "signed":
    case "paid":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30";
    case "out_for_delivery":
      return "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30";
    case "draft":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30";
    case "returned":
      return "bg-orange-500/15 text-orange-700 dark:text-orange-300 ring-orange-500/30";
    case "cancelled":
      return "bg-muted text-muted-foreground ring-border";
    default:
      return "bg-muted text-muted-foreground ring-border";
  }
}

export function bucketColor(b: AuditInvoice["status_bucket"]): string {
  switch (b) {
    case "complete":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30";
    case "partial":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30";
    case "over":
      return "bg-red-500/15 text-red-700 dark:text-red-300 ring-red-500/30";
    default:
      return "bg-muted text-muted-foreground ring-border";
  }
}

export function bucketLabel(b: AuditInvoice["status_bucket"], isAr: boolean): string {
  const map: Record<AuditInvoice["status_bucket"], [string, string]> = {
    none: ["لم يُسلَّم", "Not delivered"],
    partial: ["تسليم جزئي", "Partial"],
    complete: ["مكتمل", "Complete"],
    over: ["تسليم زائد", "Over-delivered"],
  };
  const [ar, en] = map[b];
  return isAr ? ar : en;
}

export function toCsv(rows: AuditInvoice[]): string {
  const header = [
    "invoice_number",
    "customer_name",
    "invoice_status",
    "receipts_count",
    "invoice_total_qty",
    "delivered_effective",
    "delivered_in_transit",
    "remaining",
    "completion_pct",
    "bucket",
  ];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.invoice_number,
        r.customer_name ?? "",
        r.invoice_status ?? "",
        r.receipts_count,
        r.invoice_total_qty,
        r.delivered_total_effective,
        r.delivered_total_in_transit,
        r.remaining_total,
        r.completion_pct,
        r.status_bucket,
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\n");
}
