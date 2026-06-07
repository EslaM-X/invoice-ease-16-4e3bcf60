import { supabase } from "@/integrations/supabase/client";
import {
  computeSuggestions, INCOMING_PO_STATUSES,
  type Suggestion, type DeliveryMode,
  type FInvoice, type FInvItem, type FDeliveredRow, type FProductRow, type FPOItemRow, type FPORow,
} from "./fulfillment-engine";

export type FulfillmentAuditAction = "closed" | "partial_close" | "snapshot" | "auto_closed";

export async function logFulfillmentAction(
  userId: string,
  s: Suggestion,
  mode: DeliveryMode,
  action: FulfillmentAuditAction,
  note?: string | null,
) {
  const row = {
    user_id: userId,
    invoice_id: s.invoice.id,
    invoice_number: s.invoice.invoice_number,
    action,
    tier: s.tier,
    mode,
    confidence: s.confidence,
    total_needed: s.totalNeeded,
    total_from_stock: s.totalFromStock,
    total_from_incoming: s.totalFromIncoming,
    total_shortfall: s.totalShortfall,
    manual_count: s.manualCount,
    reasons: s.reasons as any,
    needs: s.needs as any,
    note: note ?? null,
  };
  const { error } = await supabase.from("fulfillment_audit_log" as any).insert(row as any);
  if (error) throw error;
}

/**
 * Loads minimal data for ONE invoice, runs the fulfillment engine, and writes
 * an audit-log entry capturing the closure snapshot. Safe to call after a
 * successful delivery receipt save (it re-fetches latest delivered rows).
 */
export async function autoLogClosureForInvoice(
  userId: string,
  invoiceId: string,
  mode: DeliveryMode = "any",
  action: FulfillmentAuditAction = "auto_closed",
  note?: string | null,
): Promise<Suggestion | null> {
  const { data: inv } = await supabase
    .from("invoices")
    .select("id, invoice_number, customer_name, customer_phone, total, created_at, delivery_status, status")
    .eq("id", invoiceId).maybeSingle();
  if (!inv) return null;

  const { data: its } = await supabase
    .from("invoice_items")
    .select("id, invoice_id, product_id, product_name, serial_number, color, quantity, unit_price")
    .eq("invoice_id", invoiceId);
  const items = ((its ?? []) as unknown) as FInvItem[];

  const itemIds = items.map((i) => i.id);
  let delivered: FDeliveredRow[] = [];
  if (itemIds.length) {
    const { data: drs } = await supabase
      .from("delivery_receipt_items" as any)
      .select("invoice_item_id, quantity, note")
      .in("invoice_item_id", itemIds);
    delivered = ((drs ?? []) as unknown) as FDeliveredRow[];
  }

  const productIds = Array.from(new Set(items.map((i) => i.product_id).filter(Boolean) as string[]));
  const products = new Map<string, FProductRow>();
  if (productIds.length) {
    const { data: prods } = await supabase
      .from("products")
      .select("id, name, stock_quantity, serial_number, color")
      .in("id", productIds);
    for (const p of ((prods ?? []) as unknown) as FProductRow[]) products.set(p.id, p);
  }

  const pos = new Map<string, FPORow>();
  let poItems: FPOItemRow[] = [];
  if (productIds.length) {
    const { data: poList } = await supabase
      .from("purchase_orders")
      .select("id, po_number, status, expected_arrival_at")
      .eq("user_id", userId)
      .in("status", Array.from(INCOMING_PO_STATUSES));
    for (const p of ((poList ?? []) as unknown) as FPORow[]) pos.set(p.id, p);
    if (pos.size) {
      const { data: poIs } = await supabase
        .from("purchase_order_items")
        .select("po_id, product_id, quantity, received_qty")
        .in("po_id", Array.from(pos.keys()))
        .in("product_id", productIds);
      poItems = ((poIs ?? []) as unknown) as FPOItemRow[];
    }
  }

  const sugs = computeSuggestions({
    invoices: [inv as FInvoice], items, deliveredRows: delivered, products, poItems, pos, mode,
  });
  const s = sugs[0];
  if (!s) return null;
  await logFulfillmentAction(userId, s, mode, action, note ?? null);
  return s;
}

/** Bulk log many already-computed suggestions; returns a summary. */
export async function bulkLogFulfillment(
  userId: string,
  suggestions: Suggestion[],
  mode: DeliveryMode,
  action: FulfillmentAuditAction = "snapshot",
  note?: string | null,
): Promise<{
  count: number;
  failed: number;
  totalNeeded: number;
  totalFromStock: number;
  totalFromIncoming: number;
  totalShortfall: number;
  manualCount: number;
}> {
  let count = 0, failed = 0;
  let totalNeeded = 0, totalFromStock = 0, totalFromIncoming = 0, totalShortfall = 0, manualCount = 0;
  await Promise.all(suggestions.map(async (s) => {
    try {
      await logFulfillmentAction(userId, s, mode, action, note ?? null);
      count++;
      totalNeeded += s.totalNeeded;
      totalFromStock += s.totalFromStock;
      totalFromIncoming += s.totalFromIncoming;
      totalShortfall += s.totalShortfall;
      manualCount += s.manualCount;
    } catch { failed++; }
  }));
  return { count, failed, totalNeeded, totalFromStock, totalFromIncoming, totalShortfall, manualCount };
}
