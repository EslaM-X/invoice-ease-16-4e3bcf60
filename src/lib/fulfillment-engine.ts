// Pure smart-fulfillment engine. Extracted so the UI and the test harness
// (src/routes/fulfillment-tests.tsx) share the exact same logic.

import { DEFAULT_CONFIG, isMultiPartProduct, parsePartFromNote } from "./product-parts";

export type FInvoice = {
  id: string;
  invoice_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  total: number;
  created_at: string;
  delivery_status: string | null;
};
export type FInvItem = {
  id: string;
  invoice_id: string;
  product_id: string | null;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  quantity: number;
  unit_price: number;
};
/** Per-receipt delivered row with the part tag (if any). */
export type FDeliveredRow = {
  invoice_item_id: string;
  quantity: number;
  note: string | null;
};
export type FProductRow = {
  id: string;
  name: string;
  stock_quantity: number;
  serial_number: string | null;
  color: string | null;
};
export type FPOItemRow = {
  po_id: string;
  product_id: string;
  quantity: number;
  received_qty: number | null;
};
export type FPORow = {
  id: string;
  po_number: string;
  status: string;
  expected_arrival_at: string | null;
};

export type Tier =
  | "now_full"
  | "now_partial"
  | "incoming_full"
  | "incoming_partial"
  | "blocked";

/**
 * Delivery interpretation: how do we count partial deliveries on multi-part products?
 *  - any (default): every delivered unit reduces remaining 1:1 (mixer alone counts as 1, trim alone counts as 1).
 *  - strict_full: only paired mixer+trim (or `full`) counts. Unpaired mixer/trim does NOT reduce remaining.
 *  - mixer_ok: every mixer delivery (alone) is enough to consider that unit closed.
 *  - trim_ok: every trim (visible) delivery is enough.
 * Single-part products are unaffected.
 */
export type DeliveryMode = "any" | "strict_full" | "mixer_ok" | "trim_ok";

export type Need = {
  product_id: string;
  product_name: string;
  serial: string | null;
  color: string | null;
  needed: number;
  fromStock: number;
  fromIncoming: number;
  shortfall: number;
  incomingPOs: { po_number: string; qty: number; eta: string | null }[];
  isManual?: boolean;
};

export type ReasonCode =
  | "covered_full_stock"
  | "covered_with_incoming"
  | "partial_stock"
  | "manual_items_satisfied"
  | "shortfall"
  | "all_delivered_under_mode";

export type Reason = { code: ReasonCode; detail: string };

export type Suggestion = {
  invoice: FInvoice;
  needs: Need[];
  totalNeeded: number;
  totalCovered: number;
  totalFromStock: number;
  totalFromIncoming: number;
  totalShortfall: number;
  manualCount: number;
  tier: Tier;
  earliestEta: string | null;
  invoiceValue: number;
  confidence: number; // 0..100
  reasons: Reason[];
};

export const INCOMING_PO_STATUSES = new Set(["ordered", "shipped", "in_warehouse"]);

/** Compute effective delivered qty per invoice_item, honoring DeliveryMode. */
export function buildEffectiveDelivered(
  items: FInvItem[],
  rows: FDeliveredRow[],
  mode: DeliveryMode,
): Map<string, number> {
  const byItem = new Map<string, FDeliveredRow[]>();
  for (const r of rows) {
    const a = byItem.get(r.invoice_item_id) ?? [];
    a.push(r);
    byItem.set(r.invoice_item_id, a);
  }
  const out = new Map<string, number>();
  const itemMap = new Map(items.map((i) => [i.id, i]));
  for (const [itemId, list] of byItem) {
    const it = itemMap.get(itemId);
    const multi = it ? isMultiPartProduct(it.product_name) : false;
    if (!multi) {
      out.set(itemId, list.reduce((s, r) => s + (r.quantity || 0), 0));
      continue;
    }
    let full = 0, mixer = 0, trim = 0, untagged = 0;
    for (const r of list) {
      const q = r.quantity || 0;
      const { part } = parsePartFromNote(r.note);
      if (!r.note) untagged += q;
      else if (part === "full") full += q;
      else if (part === "mixer") mixer += q;
      else if (part === "trim") trim += q;
    }
    // Treat untagged legacy rows like "any".
    let eff = full + untagged;
    if (mode === "any") {
      eff += mixer + trim;
    } else if (mode === "strict_full") {
      eff += Math.min(mixer, trim); // only pairs count as a complete unit
    } else if (mode === "mixer_ok") {
      eff += mixer; // visible alone doesn't count, mixer alone does
    } else if (mode === "trim_ok") {
      eff += trim;
    }
    // Also use DEFAULT_CONFIG just to ensure we never exceed quantity later.
    out.set(itemId, eff);
    void DEFAULT_CONFIG;
  }
  return out;
}

export type EngineInput = {
  invoices: FInvoice[];
  items: FInvItem[];
  deliveredRows: FDeliveredRow[];
  products: Map<string, FProductRow>;
  poItems: FPOItemRow[];
  pos: Map<string, FPORow>;
  mode: DeliveryMode;
};

export function computeSuggestions(input: EngineInput): Suggestion[] {
  const { invoices, items, deliveredRows, products, poItems, pos, mode } = input;
  const effectiveDelivered = buildEffectiveDelivered(items, deliveredRows, mode);

  const itemsByInv = new Map<string, FInvItem[]>();
  for (const it of items) {
    const a = itemsByInv.get(it.invoice_id) ?? [];
    a.push(it);
    itemsByInv.set(it.invoice_id, a);
  }

  const stockPool = new Map<string, number>();
  for (const [pid, p] of products) stockPool.set(pid, Math.max(0, p.stock_quantity || 0));

  const incomingPool = new Map<string, number>();
  const incomingByProduct = new Map<string, { po_id: string; qty: number }[]>();
  for (const pi of poItems) {
    if (!pi.product_id) continue;
    const remainingQty = Math.max(0, (pi.quantity || 0) - (pi.received_qty || 0));
    if (remainingQty <= 0) continue;
    incomingPool.set(pi.product_id, (incomingPool.get(pi.product_id) ?? 0) + remainingQty);
    const list = incomingByProduct.get(pi.product_id) ?? [];
    list.push({ po_id: pi.po_id, qty: remainingQty });
    incomingByProduct.set(pi.product_id, list);
  }
  for (const list of incomingByProduct.values()) {
    list.sort((a, b) => {
      const ea = pos.get(a.po_id)?.expected_arrival_at ?? "9999-12-31";
      const eb = pos.get(b.po_id)?.expected_arrival_at ?? "9999-12-31";
      return ea.localeCompare(eb);
    });
  }

  type RawNeed = {
    invoice: FInvoice;
    perProduct: Map<string, { product_name: string; serial: string | null; color: string | null; needed: number; isManual: boolean }>;
    totalNeeded: number;
    manualCount: number;
    fullyDelivered: boolean;
  };
  const raws: RawNeed[] = [];
  for (const inv of invoices) {
    const its = itemsByInv.get(inv.id) ?? [];
    const perProduct = new Map<string, { product_name: string; serial: string | null; color: string | null; needed: number; isManual: boolean }>();
    let total = 0;
    let manualCount = 0;
    let anyItem = its.length > 0;
    let anyRemaining = false;
    for (const it of its) {
      const delivered = effectiveDelivered.get(it.id) ?? 0;
      const remaining = Math.max(0, (it.quantity || 0) - delivered);
      if (remaining <= 0) continue;
      anyRemaining = true;
      const isManual = !it.product_id;
      if (isManual) manualCount += remaining;
      const key = it.product_id ?? `manual:${it.id}`;
      const cur = perProduct.get(key);
      if (cur) cur.needed += remaining;
      else perProduct.set(key, { product_name: it.product_name, serial: it.serial_number, color: it.color, needed: remaining, isManual });
      total += remaining;
    }
    if (total > 0) {
      raws.push({ invoice: inv, perProduct, totalNeeded: total, manualCount, fullyDelivered: false });
    } else if (anyItem && !anyRemaining) {
      // Everything delivered under current mode — surface as fully closed (synthetic now_full with 0 items).
      raws.push({ invoice: inv, perProduct, totalNeeded: 0, manualCount: 0, fullyDelivered: true });
    }
  }

  const committed = new Set<string>();
  const out: Suggestion[] = [];

  function canCoverFromStock(raw: RawNeed): boolean {
    const tmp = new Map<string, number>();
    for (const [pid, n] of raw.perProduct) {
      if (n.isManual) continue;
      const avail = (stockPool.get(pid) ?? 0) - (tmp.get(pid) ?? 0);
      if (avail < n.needed) return false;
      tmp.set(pid, (tmp.get(pid) ?? 0) + n.needed);
    }
    return true;
  }

  function commit(raw: RawNeed, tier: Tier, useIncoming: boolean): Suggestion {
    const needs: Need[] = [];
    let totalStock = 0, totalIncoming = 0, totalShortfall = 0;
    let earliest: string | null = null;
    for (const [pid, n] of raw.perProduct) {
      if (n.isManual) {
        totalStock += n.needed;
        needs.push({
          product_id: pid, product_name: n.product_name, serial: n.serial, color: n.color,
          needed: n.needed, fromStock: n.needed, fromIncoming: 0, shortfall: 0, incomingPOs: [], isManual: true,
        });
        continue;
      }
      const stockAvail = stockPool.get(pid) ?? 0;
      const fromStock = Math.min(stockAvail, n.needed);
      stockPool.set(pid, stockAvail - fromStock);
      let remaining = n.needed - fromStock;
      let fromIncoming = 0;
      const incomingPOs: Need["incomingPOs"] = [];
      if (useIncoming && remaining > 0) {
        const list = incomingByProduct.get(pid) ?? [];
        for (const slot of list) {
          if (remaining <= 0) break;
          if (slot.qty <= 0) continue;
          const take = Math.min(slot.qty, remaining);
          slot.qty -= take; remaining -= take; fromIncoming += take;
          const po = pos.get(slot.po_id);
          if (po) {
            incomingPOs.push({ po_number: po.po_number, qty: take, eta: po.expected_arrival_at });
            if (po.expected_arrival_at && (!earliest || po.expected_arrival_at < earliest)) earliest = po.expected_arrival_at;
          }
        }
        incomingPool.set(pid, (incomingPool.get(pid) ?? 0) - fromIncoming);
      }
      const shortfall = n.needed - fromStock - fromIncoming;
      totalStock += fromStock; totalIncoming += fromIncoming; totalShortfall += shortfall;
      needs.push({ product_id: pid, product_name: n.product_name, serial: n.serial, color: n.color, needed: n.needed, fromStock, fromIncoming, shortfall, incomingPOs });
    }
    const totalNeeded = raw.totalNeeded || 0;
    const totalCovered = totalStock + totalIncoming;
    const confidence = totalNeeded === 0 ? 100 : Math.round((totalCovered / totalNeeded) * 100);
    const reasons: Reason[] = [];
    if (raw.fullyDelivered) reasons.push({ code: "all_delivered_under_mode", detail: `mode=${mode}` });
    if (raw.manualCount > 0) reasons.push({ code: "manual_items_satisfied", detail: `${raw.manualCount}` });
    if (tier === "now_full" && !raw.fullyDelivered) reasons.push({ code: "covered_full_stock", detail: `${totalStock}/${totalNeeded}` });
    if (tier === "incoming_full") reasons.push({ code: "covered_with_incoming", detail: `${totalStock}+${totalIncoming}` });
    if (tier === "now_partial" || tier === "incoming_partial") reasons.push({ code: "partial_stock", detail: `stock=${totalStock} incoming=${totalIncoming}` });
    if (totalShortfall > 0) reasons.push({ code: "shortfall", detail: `${totalShortfall}` });
    return {
      invoice: raw.invoice, needs, totalNeeded, totalCovered,
      totalFromStock: totalStock, totalFromIncoming: totalIncoming, totalShortfall,
      manualCount: raw.manualCount, tier, earliestEta: earliest,
      invoiceValue: Number(raw.invoice.total) || 0, confidence, reasons,
    };
  }

  for (const raw of raws) {
    if (raw.fullyDelivered) { out.push(commit(raw, "now_full", false)); committed.add(raw.invoice.id); }
  }
  for (const raw of raws) {
    if (committed.has(raw.invoice.id)) continue;
    if (canCoverFromStock(raw)) { out.push(commit(raw, "now_full", false)); committed.add(raw.invoice.id); }
  }
  for (const raw of raws) {
    if (committed.has(raw.invoice.id)) continue;
    const tmpStock = new Map<string, number>();
    const tmpInc = new Map<string, number>();
    let ok = true;
    for (const [pid, n] of raw.perProduct) {
      if (n.isManual) continue;
      const s = (stockPool.get(pid) ?? 0) - (tmpStock.get(pid) ?? 0);
      const fromS = Math.min(s, n.needed);
      const need2 = n.needed - fromS;
      const i = (incomingPool.get(pid) ?? 0) - (tmpInc.get(pid) ?? 0);
      if (i < need2) { ok = false; break; }
      tmpStock.set(pid, (tmpStock.get(pid) ?? 0) + fromS);
      tmpInc.set(pid, (tmpInc.get(pid) ?? 0) + need2);
    }
    if (ok) { out.push(commit(raw, "incoming_full", true)); committed.add(raw.invoice.id); }
  }
  for (const raw of raws) {
    if (committed.has(raw.invoice.id)) continue;
    const s = commit(raw, "blocked", true);
    if (s.totalFromStock > 0 && s.totalShortfall === 0) s.tier = "incoming_full";
    else if (s.totalFromStock > 0 && s.totalFromIncoming === 0) s.tier = "now_partial";
    else if (s.totalFromStock > 0 || s.totalFromIncoming > 0) s.tier = "incoming_partial";
    else s.tier = "blocked";
    out.push(s);
  }

  const tierOrder: Record<Tier, number> = { now_full: 0, now_partial: 1, incoming_full: 2, incoming_partial: 3, blocked: 4 };
  out.sort((a, b) => {
    const t = tierOrder[a.tier] - tierOrder[b.tier];
    if (t !== 0) return t;
    const v = b.invoiceValue - a.invoiceValue;
    if (v !== 0) return v;
    return a.invoice.created_at.localeCompare(b.invoice.created_at);
  });
  return out;
}

export function reasonLabel(code: ReasonCode, isAr: boolean): string {
  const map: Record<ReasonCode, { ar: string; en: string }> = {
    covered_full_stock: { ar: "مغطاة بالكامل من المخزون", en: "Fully covered from stock" },
    covered_with_incoming: { ar: "مغطاة بالمخزون + الشحنات القادمة", en: "Covered via stock + incoming POs" },
    partial_stock: { ar: "تغطية جزئية", en: "Partial coverage" },
    manual_items_satisfied: { ar: "بنود يدوية معاملة كمُسلَّمة", en: "Manual items treated as satisfied" },
    shortfall: { ar: "نقص", en: "Shortfall" },
    all_delivered_under_mode: { ar: "كل البنود مُسلَّمة وفق الفلتر الحالي", en: "All items delivered under current mode" },
  };
  return isAr ? map[code].ar : map[code].en;
}
