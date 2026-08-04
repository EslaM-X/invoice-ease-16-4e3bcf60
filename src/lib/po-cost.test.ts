import { describe, it, expect } from "vitest";
import { computePOCost, sumPOCosts } from "./po-cost";

describe("computePOCost", () => {
  it("matches the stored total for a fixed-mode PO (taxes excluded)", () => {
    // PO-2026-0009: 853.55 USD × 51.17 + 15217.55 customs = 58893.7035
    const c = computePOCost({
      total_usd: 853.55, usd_rate: 51.17, total_qty: 18, total_egp: 58893.7035,
      customs_mode: "fixed", customs_value: 15217.55,
      taxes_mode: "fixed", taxes_value: 4251.82,
      shipping_mode: "fixed", shipping_value: 0,
      other_mode: "fixed", other_value: 0,
    });
    expect(c.baseEgp).toBeCloseTo(43676.15, 2);
    expect(c.customsEgp).toBeCloseTo(15217.55, 2);
    expect(c.taxesEgp).toBeCloseTo(4251.82, 2);
    expect(c.totalEgp).toBeCloseTo(58893.7, 1);
    expect(c.unitEgp).toBeCloseTo(58893.7035 / 18, 4);
  });

  it("applies percent modes against the EGP base", () => {
    const c = computePOCost({
      total_usd: 1000, usd_rate: 50, total_qty: 10, total_egp: null,
      customs_mode: "percent", customs_value: 10,
      taxes_mode: "percent", taxes_value: 14,
      shipping_mode: "fixed", shipping_value: 5000,
      other_mode: "percent", other_value: 0,
    });
    expect(c.baseEgp).toBe(50000);
    expect(c.customsEgp).toBe(5000);
    expect(c.taxesEgp).toBe(7000);
    expect(c.totalEgp).toBe(60000); // taxes excluded
  });

  it("marks unpriced POs", () => {
    const c = computePOCost({ total_usd: 500, usd_rate: null, total_egp: null, total_qty: 5 });
    expect(c.priced).toBe(false);
    expect(c.totalEgp).toBe(0);
  });
});

describe("sumPOCosts", () => {
  it("aggregates totals and weighted average rate", () => {
    const t = sumPOCosts([
      { total_usd: 1000, usd_rate: 50, total_qty: 10, total_egp: 50000 },
      { total_usd: 1000, usd_rate: 60, total_qty: 10, total_egp: 60000 },
      { total_usd: 100, usd_rate: null, total_egp: null, total_qty: 1 },
    ]);
    expect(t.totalEgp).toBe(110000);
    expect(t.poCount).toBe(3);
    expect(t.pricedCount).toBe(2);
    expect(t.avgRate).toBeCloseTo(110000 / 2100, 4);
  });
});
