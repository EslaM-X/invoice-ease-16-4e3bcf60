/**
 * Customer intelligence — aggregates invoices per customer.
 * Read-only: never mutates invoices, payments or delivery receipts.
 */

export type CustomerInvoice = {
  id: string;
  invoice_number: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  subtotal: number | null;
  discount: number | null;
  total: number | null;
  tax_enabled: boolean | null;
  tax_rate: number | null;
  paid_amount: number | null;
  status: string | null;
  delivery_computed_state: string | null;
  created_at: string;
};

export type CustomerTier = "vip" | "premium" | "regular" | "new";

export type CustomerStats = {
  invoices: CustomerInvoice[];
  count: number;
  drafts: number;
  totalValue: number;
  paid: number;
  remaining: number;
  delivered: number;
  partial: number;
  pending: number;
  deliveredRatio: number;
  avgValue: number;
  firstAt: string | null;
  lastAt: string | null;
  tier: CustomerTier;
};

export const EMPTY_STATS: CustomerStats = {
  invoices: [], count: 0, drafts: 0, totalValue: 0, paid: 0, remaining: 0,
  delivered: 0, partial: 0, pending: 0, deliveredRatio: 0, avgValue: 0,
  firstAt: null, lastAt: null, tier: "new",
};

/** Net total after discount, plus VAT when enabled — matches the invoice page. */
export function invoicePayable(inv: CustomerInvoice) {
  const sub = Number(inv.subtotal ?? 0);
  const disc = Number(inv.discount ?? 0);
  const net = disc > 0 ? sub - disc : Number(inv.total ?? sub);
  const base = Number.isFinite(net) ? net : 0;
  if (inv.tax_enabled === true) {
    const rate = Number(inv.tax_rate ?? 0.14) || 0.14;
    return +(base * (1 + rate)).toFixed(2);
  }
  return +base.toFixed(2);
}

function normPhone(p?: string | null) {
  return (p ?? "").replace(/\D+/g, "").slice(-9);
}
function normName(n?: string | null) {
  return (n ?? "").trim().toLowerCase();
}

export type CustomerKeyed = { id: string; name: string; phone?: string | null };

/**
 * Build a stats map keyed by customer id. Invoices without `customer_id`
 * fall back to phone match, then exact name match, so nothing is lost.
 */
export function buildCustomerStats(
  customers: CustomerKeyed[],
  invoices: CustomerInvoice[],
): Map<string, CustomerStats> {
  const byPhone = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const c of customers) {
    const p = normPhone(c.phone);
    if (p && !byPhone.has(p)) byPhone.set(p, c.id);
    const n = normName(c.name);
    if (n && !byName.has(n)) byName.set(n, c.id);
  }

  const grouped = new Map<string, CustomerInvoice[]>();
  for (const inv of invoices) {
    let cid = inv.customer_id ?? null;
    if (!cid) {
      const p = normPhone(inv.customer_phone);
      cid = (p ? byPhone.get(p) : undefined) ?? byName.get(normName(inv.customer_name)) ?? null;
    }
    if (!cid) continue;
    const arr = grouped.get(cid);
    if (arr) arr.push(inv);
    else grouped.set(cid, [inv]);
  }

  const raw = new Map<string, CustomerStats>();
  for (const c of customers) {
    const list = (grouped.get(c.id) ?? []).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const real = list.filter((i) => i.status !== "draft");
    let totalValue = 0, paid = 0, delivered = 0, partial = 0, pending = 0;
    for (const inv of real) {
      const payable = invoicePayable(inv);
      totalValue += payable;
      paid += Math.min(Number(inv.paid_amount ?? 0), payable);
      const st = inv.delivery_computed_state;
      if (st === "complete") delivered++;
      else if (st === "partial") partial++;
      else pending++;
    }
    const count = real.length;
    raw.set(c.id, {
      invoices: list,
      count,
      drafts: list.length - count,
      totalValue: +totalValue.toFixed(2),
      paid: +paid.toFixed(2),
      remaining: +Math.max(0, totalValue - paid).toFixed(2),
      delivered, partial, pending,
      deliveredRatio: count ? delivered / count : 0,
      avgValue: count ? +(totalValue / count).toFixed(2) : 0,
      firstAt: real.length ? real[real.length - 1].created_at : null,
      lastAt: real.length ? real[0].created_at : null,
      tier: "new",
    });
  }

  // Dynamic tiering from actual distribution of paying customers.
  const values = [...raw.values()].filter((s) => s.count > 0).map((s) => s.totalValue).sort((a, b) => a - b);
  const pct = (p: number) => (values.length ? values[Math.min(values.length - 1, Math.floor(values.length * p))] : 0);
  const p90 = pct(0.9);
  const p70 = pct(0.7);
  for (const s of raw.values()) {
    if (s.count === 0) s.tier = "new";
    else if (s.totalValue >= p90 || s.count >= 5) s.tier = "vip";
    else if (s.totalValue >= p70) s.tier = "premium";
    else s.tier = "regular";
  }
  return raw;
}

export function tierLabel(tier: CustomerTier, isAr: boolean) {
  if (tier === "vip") return "VIP";
  if (tier === "premium") return isAr ? "مميز" : "Premium";
  if (tier === "regular") return isAr ? "عادي" : "Regular";
  return isAr ? "جديد" : "New";
}

export function tierClass(tier: CustomerTier) {
  if (tier === "vip") return "border-amber-400/50 bg-amber-400/15 text-amber-600 dark:text-amber-300";
  if (tier === "premium") return "border-violet-400/50 bg-violet-400/10 text-violet-600 dark:text-violet-300";
  if (tier === "regular") return "border-border bg-muted/60 text-muted-foreground";
  return "border-sky-400/40 bg-sky-400/10 text-sky-600 dark:text-sky-300";
}

export function deliveryLabel(state: string | null | undefined, isAr: boolean) {
  if (state === "complete") return isAr ? "تم التسليم" : "Delivered";
  if (state === "partial") return isAr ? "تسليم جزئي" : "Partial";
  if (state === "na") return isAr ? "مسودة" : "Draft";
  return isAr ? "لم يُسلَّم" : "Pending";
}

export function deliveryClass(state: string | null | undefined) {
  if (state === "complete") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
  if (state === "partial") return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300";
  return "border-slate-400/40 bg-slate-400/10 text-slate-600 dark:text-slate-300";
}
