import { supabase } from "@/integrations/supabase/client";

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
  status?: "draft" | "signed";
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
  } as any);
  if (error) throw error;
  return data as string;
}

export type InvoiceItemWithDelivered = {
  id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  quantity: number;
  delivered_qty: number; // total across all receipts
  remaining: number;
};

/** Fetch invoice items + already-delivered totals. Pass excludeReceiptId when editing. */
export async function fetchInvoiceItemsWithDelivered(
  invoiceId: string,
  excludeReceiptId?: string,
): Promise<InvoiceItemWithDelivered[]> {
  const { data: items } = await supabase
    .from("invoice_items")
    .select("id, product_name, serial_number, color, quantity")
    .eq("invoice_id", invoiceId);

  const itemIds = (items ?? []).map((i: any) => i.id);
  if (itemIds.length === 0) return [];

  let q = supabase
    .from("delivery_receipt_items" as any)
    .select("invoice_item_id, quantity, receipt_id")
    .in("invoice_item_id", itemIds);
  const { data: dris } = await q;

  const totals = new Map<string, number>();
  for (const r of (dris ?? []) as any[]) {
    if (excludeReceiptId && r.receipt_id === excludeReceiptId) continue;
    totals.set(r.invoice_item_id, (totals.get(r.invoice_item_id) || 0) + (r.quantity || 0));
  }

  return (items ?? []).map((i: any) => {
    const delivered = totals.get(i.id) || 0;
    return {
      id: i.id,
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
    case "delivered":
      return isAr ? "تم التسليم" : "Delivered";
    case "partial":
      return isAr ? "تسليم جزئي" : "Partial";
    default:
      return isAr ? "لم يُسلَّم" : "Pending";
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
