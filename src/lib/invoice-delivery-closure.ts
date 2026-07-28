const MULTI_PART_PRODUCT_PATTERNS = [
  /WALL\s*MOUNTED\s*TWO\s*HOLE\s*BASIN\s*MIXER/i,
  /CONCEALED\s*SHOWER/i,
  /SHOWER\s*MIXERS\s*CONCEALED/i,
  /FREE\s*STANDING\s*BATH\s*MIXER/i,
  /BATH\s*MIXERS\s*FREE\s*STANDING/i,
];

const ACTIVE_DELIVERY_STATUSES = new Set(["out_for_delivery", "signed", "paid"]);
const COMPLETED_DELIVERY_STATUSES = new Set(["signed", "paid"]);

type DeliveryMode = "active" | "completed";

export type InvoiceDeliveryLine = {
  id: string;
  invoice_id: string | null;
  product_name?: string | null;
  quantity?: number | string | null;
  serial_number?: string | null;
};

export type DeliveryReceiptLite = {
  id: string;
  invoice_id: string | null;
  status?: string | null;
};

export type DeliveryReceiptItemLite = {
  receipt_id: string | null;
  invoice_item_id?: string | null;
  quantity?: number | string | null;
  note?: string | null;
};

export type InvoiceDeliverySummary = {
  total: number;
  completed: number;
  active: number;
  completedByItem: Record<string, number>;
  complete: boolean;
};

export function computeDeliverySummaries(
  invoiceItems: InvoiceDeliveryLine[],
  receipts: DeliveryReceiptLite[],
  receiptItems: DeliveryReceiptItemLite[],
): Record<string, InvoiceDeliverySummary> {
  const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  const itemsByInvoice = new Map<string, InvoiceDeliveryLine[]>();

  invoiceItems.forEach((item) => {
    if (!item.invoice_id || !item.id) return;
    const lines = itemsByInvoice.get(item.invoice_id) ?? [];
    lines.push(item);
    itemsByInvoice.set(item.invoice_id, lines);
  });

  const summaries: Record<string, InvoiceDeliverySummary> = {};
  itemsByInvoice.forEach((items, invoiceId) => {
    const total = items.reduce((sum, item) => sum + toNumber(item.quantity), 0);
    const completedByItem: Record<string, number> = {};
    let completed = 0;
    let active = 0;
    let complete = items.length > 0;

    items.forEach((item) => {
      const itemCompleted = effectiveDeliveredQuantity(item, receiptItems, receiptById, "completed");
      const itemActive = effectiveDeliveredQuantity(item, receiptItems, receiptById, "active");
      const itemRequired = toNumber(item.quantity);

      completedByItem[item.id] = itemCompleted;
      completed += itemCompleted;
      active += itemActive;
      if (itemRequired > 0 && itemCompleted < itemRequired) complete = false;
    });

    summaries[invoiceId] = {
      total,
      completed,
      active,
      completedByItem,
      complete: total > 0 && complete,
    };
  });

  return summaries;
}

function effectiveDeliveredQuantity(
  item: InvoiceDeliveryLine,
  receiptItems: DeliveryReceiptItemLite[],
  receiptById: Map<string, DeliveryReceiptLite>,
  mode: DeliveryMode,
) {
  const allowedStatuses = mode === "completed" ? COMPLETED_DELIVERY_STATUSES : ACTIVE_DELIVERY_STATUSES;
  const relevantItems = receiptItems.filter((receiptItem) => {
    if (receiptItem.invoice_item_id !== item.id || !receiptItem.receipt_id) return false;
    const receipt = receiptById.get(receiptItem.receipt_id);
    return Boolean(receipt?.status && allowedStatuses.has(receipt.status));
  });

  if (!isMultiPartProduct(item.product_name)) {
    return relevantItems.reduce((sum, receiptItem) => sum + toNumber(receiptItem.quantity), 0);
  }

  let full = 0;
  let mixer = 0;
  let trim = 0;
  let untagged = 0;

  relevantItems.forEach((receiptItem) => {
    const quantity = toNumber(receiptItem.quantity);
    const note = receiptItem.note ?? "";

    if (/\[PART:full\]/i.test(note)) full += quantity;
    else if (/\[PART:mixer\]/i.test(note)) mixer += quantity;
    else if (/\[PART:trim\]/i.test(note)) trim += quantity;
    else untagged += quantity;
  });

  return full + untagged + Math.min(mixer, trim);
}

function isMultiPartProduct(productName?: string | null) {
  const name = productName ?? "";
  return MULTI_PART_PRODUCT_PATTERNS.some((pattern) => pattern.test(name));
}

function toNumber(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}