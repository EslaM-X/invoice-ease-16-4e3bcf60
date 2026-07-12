// Pure helpers for the "Cost history per product across POs" section
// on the Profits page. Fully unit-testable — no React, no Supabase.

export type PoCostLot = {
  po_id: string;
  po_number?: string | null;
  shipment_code?: string | null;
  shipment_date?: string | null;
  status?: string | null;
  qty: number;
  unit_usd: number;
  usd_rate: number;
  unit_egp: number;
  line_total_egp: number;
  // Landed cost components (optional — populated by upgraded RPC)
  customs_egp?: number | null;
  taxes_egp?: number | null;
  shipping_egp?: number | null;
  other_egp?: number | null;
  overheads_egp?: number | null;
  line_share?: number | null;
  landed_unit_usd?: number | null;
  landed_unit_egp?: number | null;
  landed_line_egp?: number | null;
};

export type ProductCostSummary = {
  productId: string;
  totalQty: number;
  totalSpendEgp: number;
  totalSpendUsd: number;
  wacUsd: number; // Σ qty*usd / Σ qty
  wacEgp: number; // Σ qty*egp / Σ qty
  // Landed weighted averages (include customs/taxes/shipping/extra)
  wacLandedUsd: number;
  wacLandedEgp: number;
  totalLandedEgp: number;
  totalCustomsEgp: number;
  totalTaxesEgp: number;
  totalShippingEgp: number;
  totalOtherEgp: number;
  simpleAvgUsd: number; // mean of unit prices (ignores qty)
  minUsd: number;
  maxUsd: number;
  minLot: PoCostLot | null;
  maxLot: PoCostLot | null;
  poCount: number;
  firstDate: string | null;
  lastDate: string | null;
};

const EXCLUDED_STATUSES = new Set(["cancelled", "canceled"]);

export function filterLots(lots: PoCostLot[], includeCancelled: boolean): PoCostLot[] {
  if (includeCancelled) return lots;
  return lots.filter((l) => !EXCLUDED_STATUSES.has((l.status ?? "").toLowerCase()));
}

export function summarizeProduct(productId: string, lots: PoCostLot[]): ProductCostSummary {
  if (!lots.length) {
    return {
      productId,
      totalQty: 0,
      totalSpendEgp: 0,
      totalSpendUsd: 0,
      wacUsd: 0,
      wacEgp: 0,
      wacLandedUsd: 0,
      wacLandedEgp: 0,
      totalLandedEgp: 0,
      totalCustomsEgp: 0,
      totalTaxesEgp: 0,
      totalShippingEgp: 0,
      totalOtherEgp: 0,
      simpleAvgUsd: 0,
      minUsd: 0,
      maxUsd: 0,
      minLot: null,
      maxLot: null,
      poCount: 0,
      firstDate: null,
      lastDate: null,
    };
  }
  let totalQty = 0;
  let sumQtyUsd = 0;
  let sumQtyEgp = 0;
  let sumUsd = 0;
  let spendEgp = 0;
  let spendUsd = 0;
  let landedEgp = 0;
  let sumQtyRate = 0; // Σ qty*usd_rate — used to convert landedEgp back to landed USD
  let customsEgpTotal = 0;
  let taxesEgpTotal = 0;
  let shippingEgpTotal = 0;
  let otherEgpTotal = 0;
  let minLot: PoCostLot = lots[0];
  let maxLot: PoCostLot = lots[0];
  const dates: string[] = [];
  const pos = new Set<string>();
  for (const l of lots) {
    const q = Number(l.qty) || 0;
    const u = Number(l.unit_usd) || 0;
    const e = Number(l.unit_egp) || 0;
    const r = Number(l.usd_rate) || 0;
    totalQty += q;
    sumQtyUsd += q * u;
    sumQtyEgp += q * e;
    sumUsd += u;
    spendEgp += Number(l.line_total_egp) || q * e;
    spendUsd += q * u;
    sumQtyRate += q * r;
    // Landed line: prefer RPC-supplied value; fall back to raw line EGP
    const landedLine =
      l.landed_line_egp != null && Number.isFinite(Number(l.landed_line_egp))
        ? Number(l.landed_line_egp)
        : Number(l.line_total_egp) || q * e;
    landedEgp += landedLine;
    const share = Number(l.line_share) || 0;
    customsEgpTotal += (Number(l.customs_egp) || 0) * share;
    taxesEgpTotal += (Number(l.taxes_egp) || 0) * share;
    shippingEgpTotal += (Number(l.shipping_egp) || 0) * share;
    otherEgpTotal += (Number(l.other_egp) || 0) * share;
    if (u < (Number(minLot.unit_usd) || 0)) minLot = l;
    if (u > (Number(maxLot.unit_usd) || 0)) maxLot = l;
    if (l.shipment_date) dates.push(l.shipment_date);
    pos.add(l.po_id);
  }
  dates.sort();
  const wacLandedEgp = totalQty > 0 ? landedEgp / totalQty : 0;
  const wacLandedUsd = sumQtyRate > 0 ? landedEgp / sumQtyRate : 0;
  return {
    productId,
    totalQty,
    totalSpendEgp: spendEgp,
    totalSpendUsd: spendUsd,
    wacUsd: totalQty > 0 ? sumQtyUsd / totalQty : 0,
    wacEgp: totalQty > 0 ? sumQtyEgp / totalQty : 0,
    wacLandedUsd,
    wacLandedEgp,
    totalLandedEgp: landedEgp,
    totalCustomsEgp: customsEgpTotal,
    totalTaxesEgp: taxesEgpTotal,
    totalShippingEgp: shippingEgpTotal,
    totalOtherEgp: otherEgpTotal,
    simpleAvgUsd: sumUsd / lots.length,
    minUsd: Number(minLot.unit_usd) || 0,
    maxUsd: Number(maxLot.unit_usd) || 0,
    minLot,
    maxLot,
    poCount: pos.size,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}

export type GrandSummary = {
  productCount: number;
  totalQty: number;
  totalSpendUsd: number;
  totalSpendEgp: number;
  overallWacUsd: number;
  overallWacEgp: number;
  overallWacLandedUsd: number;
  overallWacLandedEgp: number;
  totalLandedEgp: number;
  totalCustomsEgp: number;
  totalTaxesEgp: number;
  totalShippingEgp: number;
  totalOtherEgp: number;
  poCount: number;
};

export function summarizeMany(entries: ProductCostSummary[]): GrandSummary {
  let totalQty = 0;
  let spendUsd = 0;
  let spendEgp = 0;
  let sumQtyUsd = 0;
  let sumQtyEgp = 0;
  let landedEgp = 0;
  let customsEgp = 0;
  let taxesEgp = 0;
  let shippingEgp = 0;
  let otherEgp = 0;
  const posByProduct = entries.reduce((n, e) => n + e.poCount, 0);
  for (const e of entries) {
    totalQty += e.totalQty;
    spendUsd += e.totalSpendUsd;
    spendEgp += e.totalSpendEgp;
    sumQtyUsd += e.wacUsd * e.totalQty;
    sumQtyEgp += e.wacEgp * e.totalQty;
    landedEgp += e.totalLandedEgp;
    customsEgp += e.totalCustomsEgp;
    taxesEgp += e.totalTaxesEgp;
    shippingEgp += e.totalShippingEgp;
    otherEgp += e.totalOtherEgp;
  }
  const overallWacLandedEgp = totalQty > 0 ? landedEgp / totalQty : 0;
  // Approximate landed USD: landedEgp ÷ (spendUsd worth of qty*rate) → fall back to base ratio
  const overallWacLandedUsd =
    spendUsd > 0 && spendEgp > 0
      ? overallWacLandedEgp * (spendUsd / spendEgp)
      : 0;
  return {
    productCount: entries.length,
    totalQty,
    totalSpendUsd: spendUsd,
    totalSpendEgp: spendEgp,
    overallWacUsd: totalQty > 0 ? sumQtyUsd / totalQty : 0,
    overallWacEgp: totalQty > 0 ? sumQtyEgp / totalQty : 0,
    overallWacLandedUsd,
    overallWacLandedEgp,
    totalLandedEgp: landedEgp,
    totalCustomsEgp: customsEgp,
    totalTaxesEgp: taxesEgp,
    totalShippingEgp: shippingEgp,
    totalOtherEgp: otherEgp,
    poCount: posByProduct,
  };
}

export function sortLotsByDateDesc(lots: PoCostLot[]): PoCostLot[] {
  return [...lots].sort((a, b) => {
    const da = a.shipment_date ?? "";
    const db = b.shipment_date ?? "";
    if (da === db) return 0;
    return da < db ? 1 : -1;
  });
}
