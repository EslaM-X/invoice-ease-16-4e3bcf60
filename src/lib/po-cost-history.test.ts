import { describe, it, expect } from "vitest";
import {
  filterLots,
  summarizeProduct,
  summarizeMany,
  sortLotsByDateDesc,
  type PoCostLot,
} from "./po-cost-history";

const lot = (o: Partial<PoCostLot>): PoCostLot => ({
  po_id: "po1",
  po_number: "PO-1",
  shipment_code: null,
  shipment_date: "2026-01-01",
  status: "received",
  qty: 10,
  unit_usd: 100,
  usd_rate: 50,
  unit_egp: 5000,
  line_total_egp: 50000,
  ...o,
});

describe("filterLots", () => {
  it("excludes cancelled by default", () => {
    const rows = [lot({ status: "received" }), lot({ po_id: "po2", status: "cancelled" })];
    expect(filterLots(rows, false)).toHaveLength(1);
    expect(filterLots(rows, true)).toHaveLength(2);
  });
  it("is case-insensitive on status", () => {
    expect(filterLots([lot({ status: "Canceled" })], false)).toHaveLength(0);
  });
});

describe("summarizeProduct", () => {
  it("returns zeros for empty lots", () => {
    const s = summarizeProduct("p1", []);
    expect(s.totalQty).toBe(0);
    expect(s.wacUsd).toBe(0);
    expect(s.poCount).toBe(0);
    expect(s.minLot).toBeNull();
  });
  it("computes weighted average correctly", () => {
    const s = summarizeProduct("p1", [
      lot({ po_id: "a", qty: 10, unit_usd: 100, unit_egp: 5000, line_total_egp: 50000 }),
      lot({ po_id: "b", qty: 30, unit_usd: 120, unit_egp: 6000, line_total_egp: 180000 }),
    ]);
    expect(s.totalQty).toBe(40);
    // WAC = (10*100 + 30*120)/40 = 4600/40 = 115
    expect(s.wacUsd).toBe(115);
    // WAC EGP = (10*5000 + 30*6000)/40 = 230000/40 = 5750
    expect(s.wacEgp).toBe(5750);
    expect(s.simpleAvgUsd).toBe(110);
    expect(s.minUsd).toBe(100);
    expect(s.maxUsd).toBe(120);
    expect(s.poCount).toBe(2);
    expect(s.totalSpendEgp).toBe(230000);
  });
  it("tracks first/last shipment dates", () => {
    const s = summarizeProduct("p1", [
      lot({ shipment_date: "2026-03-01" }),
      lot({ shipment_date: "2025-11-01" }),
      lot({ shipment_date: "2026-01-15" }),
    ]);
    expect(s.firstDate).toBe("2025-11-01");
    expect(s.lastDate).toBe("2026-03-01");
  });
  it("counts unique POs, not lots", () => {
    const s = summarizeProduct("p1", [
      lot({ po_id: "a" }),
      lot({ po_id: "a" }),
      lot({ po_id: "b" }),
    ]);
    expect(s.poCount).toBe(2);
  });
});

describe("summarizeMany", () => {
  it("aggregates weighted averages across products", () => {
    const p1 = summarizeProduct("p1", [lot({ qty: 10, unit_usd: 100, unit_egp: 5000, line_total_egp: 50000 })]);
    const p2 = summarizeProduct("p2", [lot({ qty: 20, unit_usd: 200, unit_egp: 10000, line_total_egp: 200000 })]);
    const g = summarizeMany([p1, p2]);
    expect(g.productCount).toBe(2);
    expect(g.totalQty).toBe(30);
    // (10*100 + 20*200)/30 = 5000/30 ≈ 166.67
    expect(g.overallWacUsd).toBeCloseTo(5000 / 30);
    expect(g.totalSpendEgp).toBe(250000);
  });
  it("handles empty input", () => {
    const g = summarizeMany([]);
    expect(g.productCount).toBe(0);
    expect(g.overallWacUsd).toBe(0);
  });
});

describe("landed cost", () => {
  it("uses landed_line_egp when provided", () => {
    const s = summarizeProduct("p1", [
      lot({ qty: 10, unit_egp: 5000, line_total_egp: 50000, landed_line_egp: 60000, line_share: 0.5, value_share: 0.5, weight_share: 0.5, customs_egp: 20000 }),
    ]);
    expect(s.totalLandedEgp).toBe(60000);
    expect(s.wacLandedEgp).toBe(6000);
    // customs allocated to this line = 20000 * value_share(0.5) = 10000
    expect(s.totalCustomsEgp).toBe(10000);
  });
  it("falls back to raw line total when landed missing", () => {
    const s = summarizeProduct("p1", [lot({ qty: 10, line_total_egp: 50000 })]);
    expect(s.wacLandedEgp).toBe(s.wacEgp);
  });
  it("allocates shipping by weight_share and customs by value_share independently", () => {
    // A heavy-but-cheap line: value_share=0.2 (small dollar share), weight_share=0.8 (heavy)
    // PO-wide totals: shipping_egp=1000 EGP, customs_egp=500 EGP
    const s = summarizeProduct("p1", [
      lot({
        qty: 5, unit_usd: 10, unit_egp: 500, line_total_egp: 2500,
        value_share: 0.2, weight_share: 0.8, line_share: 0.2,
        shipping_egp: 1000, customs_egp: 500, taxes_egp: 0, other_egp: 0,
        landed_line_egp: 2500 + 0.8 * 1000 + 0.2 * 500, // 2500 + 800 + 100 = 3400
      }),
    ]);
    // Shipping share = 1000 * 0.8 = 800  (weight-based, not value)
    expect(s.totalShippingEgp).toBe(800);
    // Customs share = 500 * 0.2 = 100    (value-based)
    expect(s.totalCustomsEgp).toBe(100);
    expect(s.totalLandedEgp).toBe(3400);
  });
  it("falls back to value_share for shipping when weight_share missing (legacy PO)", () => {
    const s = summarizeProduct("p1", [
      lot({ qty: 10, line_total_egp: 50000, line_share: 0.5, shipping_egp: 2000 }),
    ]);
    // No value_share/weight_share provided → falls back to line_share for both
    expect(s.totalShippingEgp).toBe(1000);
  });
});

describe("sortLotsByDateDesc", () => {
  it("puts newest first, nulls last", () => {
    const out = sortLotsByDateDesc([
      lot({ shipment_date: "2025-05-01" }),
      lot({ shipment_date: null }),
      lot({ shipment_date: "2026-01-01" }),
    ]);
    expect(out[0].shipment_date).toBe("2026-01-01");
    expect(out[2].shipment_date).toBeNull();
  });
});
