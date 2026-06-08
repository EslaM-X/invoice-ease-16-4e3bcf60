import { supabase } from "@/integrations/supabase/client";
import {
  computeSuggestions, DEFAULT_DELIVERY_MODE, INCOMING_PO_STATUSES,
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
  mode: DeliveryMode = DEFAULT_DELIVERY_MODE,
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

export type BulkLogResult = {
  count: number;
  failed: number;
  totalNeeded: number;
  totalFromStock: number;
  totalFromIncoming: number;
  totalShortfall: number;
  manualCount: number;
  perInvoice: Array<{
    invoice_id: string;
    invoice_number: string;
    tier: string;
    confidence: number;
    ok: boolean;
    error?: string;
  }>;
};

/** Bulk log many already-computed suggestions; returns a summary + per-invoice results. */
export async function bulkLogFulfillment(
  userId: string,
  suggestions: Suggestion[],
  mode: DeliveryMode,
  action: FulfillmentAuditAction = "snapshot",
  note?: string | null,
  onItem?: (r: BulkLogResult["perInvoice"][number]) => void,
): Promise<BulkLogResult> {
  const res: BulkLogResult = {
    count: 0, failed: 0,
    totalNeeded: 0, totalFromStock: 0, totalFromIncoming: 0, totalShortfall: 0, manualCount: 0,
    perInvoice: [],
  };
  // Limit concurrency to avoid hammering the DB on very large batches.
  const CONCURRENCY = 6;
  let cursor = 0;
  async function worker() {
    while (cursor < suggestions.length) {
      const s = suggestions[cursor++];
      const base = {
        invoice_id: s.invoice.id,
        invoice_number: s.invoice.invoice_number,
        tier: s.tier,
        confidence: s.confidence,
      };
      try {
        await logFulfillmentAction(userId, s, mode, action, note ?? null);
        const ok = { ...base, ok: true as const };
        res.perInvoice.push(ok);
        res.count++;
        res.totalNeeded += s.totalNeeded;
        res.totalFromStock += s.totalFromStock;
        res.totalFromIncoming += s.totalFromIncoming;
        res.totalShortfall += s.totalShortfall;
        res.manualCount += s.manualCount;
        onItem?.(ok);
      } catch (e: any) {
        const fail = { ...base, ok: false as const, error: e?.message ?? String(e) };
        res.perInvoice.push(fail);
        res.failed++;
        onItem?.(fail);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, suggestions.length) }, worker));
  return res;
}

