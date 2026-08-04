/**
 * Pure landed-cost helpers for purchase orders.
 *
 * Business rule (must match the CFO pricing dialog in purchase-orders.tsx):
 *   totalEgp = baseEgp + customsEgp + shippingEgp + otherEgp
 *   Taxes are NEVER part of the landed cost — they are informational only.
 *
 * percent modes are always applied against baseEgp (USD × rate).
 */

export type POCostRow = {
  total_usd?: number | null;
  total_qty?: number | null;
  usd_rate?: number | null;
  total_egp?: number | null;
  customs_mode?: string | null;
  customs_value?: number | null;
  taxes_mode?: string | null;
  taxes_value?: number | null;
  shipping_mode?: string | null;
  shipping_value?: number | null;
  other_mode?: string | null;
  other_value?: number | null;
};

export type POCost = {
  priced: boolean;
  rate: number;
  usd: number;
  qty: number;
  baseEgp: number;
  customsEgp: number;
  shippingEgp: number;
  otherEgp: number;
  taxesEgp: number;
  /** Landed cost EGP, excluding taxes. */
  totalEgp: number;
  /** Approx cost per unit (EGP). 0 when qty is 0. */
  unitEgp: number;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function part(mode: string | null | undefined, value: unknown, baseEgp: number) {
  const v = num(value);
  return mode === "percent" ? (baseEgp * v) / 100 : v;
}

export function computePOCost(po: POCostRow): POCost {
  const rate = num(po.usd_rate);
  const usd = num(po.total_usd);
  const qty = num(po.total_qty);
  const baseEgp = usd * rate;
  const customsEgp = part(po.customs_mode, po.customs_value, baseEgp);
  const shippingEgp = part(po.shipping_mode, po.shipping_value, baseEgp);
  const otherEgp = part(po.other_mode, po.other_value, baseEgp);
  const taxesEgp = part(po.taxes_mode, po.taxes_value, baseEgp);
  const computed = baseEgp + customsEgp + shippingEgp + otherEgp;
  // Prefer the stored (CFO-saved) total when present — it is the source of truth.
  const stored = po.total_egp == null ? null : num(po.total_egp);
  const totalEgp = stored != null && stored > 0 ? stored : computed;
  const priced = rate > 0 || (stored != null && stored > 0);
  return {
    priced,
    rate,
    usd,
    qty,
    baseEgp,
    customsEgp,
    shippingEgp,
    otherEgp,
    taxesEgp,
    totalEgp: priced ? totalEgp : 0,
    unitEgp: priced && qty > 0 ? totalEgp / qty : 0,
  };
}

export type POCostTotals = POCost & {
  poCount: number;
  pricedCount: number;
  /** Weighted average USD→EGP rate (Σ usd*rate / Σ usd). */
  avgRate: number;
};

export function sumPOCosts(rows: POCostRow[]): POCostTotals {
  let usd = 0, qty = 0, baseEgp = 0, customsEgp = 0, shippingEgp = 0,
    otherEgp = 0, taxesEgp = 0, totalEgp = 0, sumUsdRate = 0, pricedCount = 0;
  for (const r of rows) {
    const c = computePOCost(r);
    usd += c.usd;
    qty += c.qty;
    baseEgp += c.baseEgp;
    customsEgp += c.customsEgp;
    shippingEgp += c.shippingEgp;
    otherEgp += c.otherEgp;
    taxesEgp += c.taxesEgp;
    totalEgp += c.totalEgp;
    sumUsdRate += c.usd * c.rate;
    if (c.priced) pricedCount += 1;
  }
  const avgRate = usd > 0 ? sumUsdRate / usd : 0;
  return {
    priced: pricedCount > 0,
    rate: avgRate,
    avgRate,
    usd,
    qty,
    baseEgp,
    customsEgp,
    shippingEgp,
    otherEgp,
    taxesEgp,
    totalEgp,
    unitEgp: qty > 0 ? totalEgp / qty : 0,
    poCount: rows.length,
    pricedCount,
  };
}
