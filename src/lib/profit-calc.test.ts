import { describe, it, expect } from "vitest";
import {
  pickCost,
  computeInvoiceFactor,
  computeProfit,
  isShippingLine,
  type ProfitLine,
  type ProfitInvoice,
} from "./profit-calc";

const line = (over: Partial<ProfitLine>): ProfitLine => ({
  invoice_id: "i1",
  product_id: "p1",
  product_name: "Free Stand",
  quantity: 1,
  line_total: 100,
  ...over,
});
const invoice = (over: Partial<ProfitInvoice>): ProfitInvoice => ({
  id: "i1",
  subtotal: 100,
  total: 100,
  ...over,
});

describe("isShippingLine", () => {
  it("identifies canonical shipping/service names with null product_id", () => {
    expect(isShippingLine({ product_id: null, product_name: "رسوم شحن" })).toBe(true);
    expect(isShippingLine({ product_id: null, product_name: "Service Fee" })).toBe(true);
    expect(isShippingLine({ product_id: null, product_name: "رسوم خدمة" })).toBe(true);
  });
  it("rejects lines with a product_id (real product, even if same name)", () => {
    expect(isShippingLine({ product_id: "p1", product_name: "رسوم شحن" })).toBe(false);
  });
  it("rejects custom lines with other names", () => {
    expect(isShippingLine({ product_id: null, product_name: "Custom fee" })).toBe(false);
  });
});

describe("pickCost — source resolution and override precedence", () => {
  const c = { override: 50, wacEgp: 30, latestEgp: 40, currentEgp: 20 };

  it("wac uses override when set, else wac_egp, else current", () => {
    expect(pickCost("wac", c)).toBe(50);
    expect(pickCost("wac", { ...c, override: null })).toBe(30);
    expect(pickCost("wac", { override: null, wacEgp: 0, latestEgp: 0, currentEgp: 20 })).toBe(20);
  });
  it("latest_po uses override, else latest, else current", () => {
    expect(pickCost("latest_po", c)).toBe(50);
    expect(pickCost("latest_po", { ...c, override: null })).toBe(40);
    expect(pickCost("latest_po", { override: null, wacEgp: 30, latestEgp: 0, currentEgp: 20 })).toBe(20);
  });
  it("current IGNORES overrides — that's the point of that source", () => {
    expect(pickCost("current", c)).toBe(20);
    expect(pickCost("current", { ...c, override: 9999 })).toBe(20);
  });
  it("override falls back to current when no override set", () => {
    expect(pickCost("override", { ...c, override: null })).toBe(20);
    expect(pickCost("override", c)).toBe(50);
  });
  it("never returns NaN when inputs are missing", () => {
    expect(pickCost("wac", {})).toBe(0);
    expect(pickCost("latest_po", {})).toBe(0);
    expect(pickCost("current", {})).toBe(0);
    expect(pickCost("override", {})).toBe(0);
  });
});

describe("computeInvoiceFactor — invoice-level discount proration", () => {
  it("returns 1 when subtotal == total (no discount)", () => {
    const f = computeInvoiceFactor([line({})], [invoice({ subtotal: 100, total: 100 })]);
    expect(f.get("i1")).toBe(1);
  });
  it("prorates discount across non-shipping subtotal only", () => {
    const items = [
      line({ line_total: 100 }),
      line({ product_id: null, product_name: "رسوم شحن", line_total: 50, quantity: 1 }),
    ];
    // subtotal 150, total 130 → shipping 50 → factor = (130-50)/(150-50) = 80/100 = 0.8
    const f = computeInvoiceFactor(items, [invoice({ subtotal: 150, total: 130 })]);
    expect(f.get("i1")).toBe(0.8);
  });
  it("returns 1 when non-shipping subtotal is zero (avoid div-by-zero)", () => {
    const items = [line({ product_id: null, product_name: "رسوم شحن", line_total: 50 })];
    const f = computeInvoiceFactor(items, [invoice({ subtotal: 50, total: 50 })]);
    expect(f.get("i1")).toBe(1);
  });
});

describe("computeProfit — accuracy under every cost source", () => {
  const items: ProfitLine[] = [
    line({ product_id: "p1", quantity: 2, line_total: 200 }),
    line({ product_id: "p2", quantity: 1, line_total: 100 }),
    line({ product_id: null, product_name: "رسوم شحن", quantity: 1, line_total: 50 }),
  ];
  const invoices = [invoice({ subtotal: 350, total: 350 })];

  it("EXCLUDES shipping from revenue and cost; reports it separately", () => {
    const costs: Record<string, number> = { p1: 20, p2: 30 };
    const r = computeProfit(items, invoices, (id) => costs[id] ?? 0);
    expect(r.revenue).toBe(300); // 200 + 100, no shipping
    expect(r.cost).toBe(70); // 2*20 + 1*30
    expect(r.profit).toBe(230);
    expect(r.margin).toBeCloseTo(230 / 300);
    expect(r.shipping.amount).toBe(50);
    expect(r.shipping.lines).toBe(1);
    expect(r.shipping.invoices).toBe(1);
  });

  it("cost varies by source — same items yield different profit under wac vs latest vs current", () => {
    const costBook: Record<string, { wac: number; latest: number; current: number }> = {
      p1: { wac: 20, latest: 30, current: 10 },
      p2: { wac: 25, latest: 40, current: 15 },
    };
    const mk = (src: "wac" | "latest_po" | "current") => (id: string) => {
      const e = costBook[id];
      if (src === "wac") return e.wac;
      if (src === "latest_po") return e.latest;
      return e.current;
    };
    const w = computeProfit(items, invoices, mk("wac"));
    const l = computeProfit(items, invoices, mk("latest_po"));
    const c = computeProfit(items, invoices, mk("current"));
    expect(w.cost).toBe(2 * 20 + 25); // 65
    expect(l.cost).toBe(2 * 30 + 40); // 100
    expect(c.cost).toBe(2 * 10 + 15); // 35
    // Revenue is identical across sources
    expect(w.revenue).toBe(l.revenue);
    expect(l.revenue).toBe(c.revenue);
    // Profit inversely tracks cost
    expect(w.profit).toBeGreaterThan(l.profit);
    expect(c.profit).toBeGreaterThan(w.profit);
  });

  it("applies invoice-level discount by prorating across non-shipping lines only", () => {
    // subtotal 350, total 315 (10% off), shipping 50 → factor = 265/300 ≈ 0.8833
    const discounted = [invoice({ subtotal: 350, total: 315 })];
    const r = computeProfit(items, discounted, () => 0);
    expect(r.revenue).toBeCloseTo(300 * (265 / 300)); // 265
    expect(r.shipping.amount).toBe(50); // shipping unaffected
  });

  it("counts custom non-product non-shipping lines as revenue with zero cost", () => {
    const custom: ProfitLine[] = [
      line({ product_id: null, product_name: "Consulting", line_total: 500, quantity: 1 }),
    ];
    const r = computeProfit(custom, [invoice({ subtotal: 500, total: 500 })], () => 999);
    expect(r.revenue).toBe(500);
    expect(r.cost).toBe(0);
    expect(r.profit).toBe(500);
  });

  it("empty inputs → zeros, no NaN, margin=0", () => {
    const r = computeProfit([], [], () => 0);
    expect(r).toEqual({
      revenue: 0,
      cost: 0,
      profit: 0,
      margin: 0,
      shipping: { amount: 0, lines: 0, invoices: 0 },
    });
  });
});
