/**
 * Pure, deterministic profit-calculation library.
 *
 * SINGLE SOURCE OF TRUTH for "how the Profits page computes revenue and cost".
 *
 * Rules (immutable — must match src/routes/profits.tsx):
 *   1. Shipping/service lines are EXCLUDED from revenue AND from cost.
 *      Detection: product_id === null AND product_name matches SHIPPING_NAMES.
 *   2. Voided/deleted invoices are excluded upstream (SQL WHERE). Callers
 *      must not pass them in.
 *   3. Invoice-level discount is prorated across non-shipping lines via
 *      factor = (invoice.total - shippingTotal) / (invoice.subtotal - shippingTotal).
 *      Applied by multiplying each non-shipping line_total by that factor.
 *   4. Cost source is one of "wac" | "latest_po" | "current" | "override".
 *      Manual override always wins if present, UNLESS source === "current"
 *      (which explicitly asks for the raw product cost_price).
 *
 * Pure — no React, Supabase, or side effects. Fully unit-testable.
 */

export type CostSource = "wac" | "latest_po" | "current" | "override";

export const SHIPPING_NAMES = new Set<string>([
  "رسوم شحن",
  "رسوم خدمة / Service Fee",
  "رسوم خدمة",
  "Service Fee",
]);

export interface ProfitLine {
  invoice_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  line_total: number; // gross line total (unit_price * qty − line discount), pre invoice-level discount
}

export interface ProfitInvoice {
  id: string;
  subtotal: number;
  total: number;
}

export interface CostInputs {
  override?: number | null;
  wacEgp?: number | null;
  latestEgp?: number | null;
  currentEgp?: number | null;
}

export function isShippingLine(it: { product_id: string | null; product_name: string }): boolean {
  return it.product_id === null && SHIPPING_NAMES.has(it.product_name);
}

/**
 * Pick unit cost per the selected source. Falls back so KPIs never show NaN.
 *
 *   - "override": manual override if set, else current product cost.
 *   - "wac": manual override wins; else WAC-EGP; else current.
 *   - "latest_po": manual override wins; else latest PO EGP; else current.
 *   - "current": ALWAYS current (ignores overrides), matches "raw product cost".
 */
export function pickCost(source: CostSource, c: CostInputs): number {
  const ov = c.override ?? null;
  const cur = Number(c.currentEgp ?? 0);
  if (source === "override") return ov != null ? Number(ov) : cur;
  if (source === "current") return cur;
  if (ov != null) return Number(ov);
  if (source === "wac") return Number(c.wacEgp ?? 0) || cur;
  if (source === "latest_po") return Number(c.latestEgp ?? 0) || cur;
  return cur;
}

/**
 * Compute per-invoice discount-proration factor.
 * Returns Map<invoice_id, factor> — 1 when no discount / no non-shipping subtotal.
 */
export function computeInvoiceFactor(
  items: ProfitLine[],
  invoices: ProfitInvoice[],
): Map<string, number> {
  const shipByInv = new Map<string, number>();
  for (const it of items) {
    if (isShippingLine(it)) {
      shipByInv.set(it.invoice_id, (shipByInv.get(it.invoice_id) ?? 0) + Number(it.line_total ?? 0));
    }
  }
  const f = new Map<string, number>();
  for (const inv of invoices) {
    const ship = shipByInv.get(inv.id) ?? 0;
    const denom = Number(inv.subtotal ?? 0) - ship;
    const num = Number(inv.total ?? 0) - ship;
    f.set(inv.id, denom > 0 ? num / denom : 1);
  }
  return f;
}

export interface ProfitTotals {
  revenue: number;
  cost: number;
  profit: number;
  margin: number; // 0..1
  shipping: {
    amount: number;
    lines: number;
    invoices: number;
  };
}

export function computeProfit(
  items: ProfitLine[],
  invoices: ProfitInvoice[],
  costFor: (productId: string) => number,
  source: CostSource = "wac",
): ProfitTotals {
  void source;
  const factor = computeInvoiceFactor(items, invoices);
  let revenue = 0;
  let cost = 0;
  let shipAmount = 0;
  let shipLines = 0;
  const shipInvs = new Set<string>();

  for (const it of items) {
    if (isShippingLine(it)) {
      shipAmount += Number(it.line_total ?? 0);
      shipLines += 1;
      shipInvs.add(it.invoice_id);
      continue;
    }
    if (!it.product_id) {
      // Custom non-shipping non-product line: counted as revenue, no cost.
      revenue += Number(it.line_total ?? 0) * (factor.get(it.invoice_id) ?? 1);
      continue;
    }
    const qty = Number(it.quantity) || 0;
    revenue += Number(it.line_total ?? 0) * (factor.get(it.invoice_id) ?? 1);
    cost += costFor(it.product_id) * qty;
  }

  const profit = revenue - cost;
  const margin = revenue > 0 ? profit / revenue : 0;
  return {
    revenue,
    cost,
    profit,
    margin,
    shipping: { amount: shipAmount, lines: shipLines, invoices: shipInvs.size },
  };
}
