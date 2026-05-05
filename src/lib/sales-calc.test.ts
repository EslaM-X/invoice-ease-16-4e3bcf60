import { describe, it, expect } from "vitest";
import {
  computeSold,
  reconcileDay,
  classifyReason,
  dayWindow,
  type CalcInvoice,
  type CalcInvoiceItem,
  type CalcInventoryLog,
} from "./sales-calc";

const DAY = "2026-04-30";
const inDay = (h = 12) => `2026-04-30T${String(h).padStart(2, "0")}:00:00.000Z`;
const outDay = "2026-05-01T05:00:00.000Z";

const inv = (over: Partial<CalcInvoice>): CalcInvoice => ({
  id: "i1",
  invoice_number: "INV-1",
  status: "completed",
  created_at: inDay(),
  ...over,
});

const item = (over: Partial<CalcInvoiceItem>): CalcInvoiceItem => ({
  invoice_id: "i1",
  product_id: "p1",
  product_name: "Free Stand",
  serial_number: "SN-1",
  color: "black",
  quantity: 1,
  unit_price: 100,
  ...over,
});

describe("classifyReason", () => {
  it("categorizes every reason prefix", () => {
    expect(classifyReason("sale INV-1")).toBe("sale");
    expect(classifyReason("void INV-1")).toBe("void");
    expect(classifyReason("delete INV-1")).toBe("delete");
    expect(classifyReason("edit-resale INV-1")).toBe("edit-resale");
    expect(classifyReason("edit-revert INV-1")).toBe("edit-revert");
    expect(classifyReason("manual: stock fix")).toBe("manual");
    expect(classifyReason("Sale INV-1")).toBe("sale");
    expect(classifyReason(null)).toBe("other");
    expect(classifyReason("random")).toBe("other");
  });
});

describe("dayWindow", () => {
  it("produces exactly 24h window", () => {
    const { startISO, endISO } = dayWindow("2026-04-30");
    expect(new Date(endISO).getTime() - new Date(startISO).getTime()).toBe(86400000);
  });
});

describe("computeSold — accuracy invariants", () => {
  it("counts a single completed sale", () => {
    const r = computeSold({
      date: DAY,
      invoices: [inv({})],
      items: [item({ quantity: 3 })],
    });
    expect(r.totals.units).toBe(3);
    expect(r.rows[0].sold_qty).toBe(3);
  });

  it("EXCLUDES voided invoices entirely", () => {
    const r = computeSold({
      date: DAY,
      invoices: [inv({ id: "i1", status: "voided" }), inv({ id: "i2" })],
      items: [
        item({ invoice_id: "i1", quantity: 5 }),
        item({ invoice_id: "i2", quantity: 2 }),
      ],
    });
    expect(r.totals.units).toBe(2);
    expect(r.excluded.voided_invoices).toBe(1);
  });

  it("EXCLUDES invoices outside the day window", () => {
    const r = computeSold({
      date: DAY,
      invoices: [inv({ id: "i1" }), inv({ id: "i2", created_at: outDay })],
      items: [
        item({ invoice_id: "i1", quantity: 1 }),
        item({ invoice_id: "i2", quantity: 99 }),
      ],
    });
    expect(r.totals.units).toBe(1);
    expect(r.excluded.outside_day).toBe(1);
  });

  it("IGNORES inventory_logs entirely (deleted invoices already gone from DB)", () => {
    // Simulate: invoice was deleted → not in `invoices` array. Items also gone.
    // Even if old logs still reference the product, computeSold knows nothing of them.
    const r = computeSold({
      date: DAY,
      invoices: [inv({ id: "i2" })],
      items: [item({ invoice_id: "i2", quantity: 1 })],
    });
    expect(r.totals.units).toBe(1);
  });

  it("handles edit-resale: only the FINAL invoice_items are counted (DB state after edit)", () => {
    // After edit, invoice_items reflect the new state. Old line is gone.
    const r = computeSold({
      date: DAY,
      invoices: [inv({ id: "i1" })],
      items: [item({ invoice_id: "i1", product_id: "p1", quantity: 4 })], // post-edit qty
    });
    expect(r.totals.units).toBe(4);
  });

  it("aggregates same product across multiple invoices", () => {
    const r = computeSold({
      date: DAY,
      invoices: [inv({ id: "i1" }), inv({ id: "i2", invoice_number: "INV-2" })],
      items: [
        item({ invoice_id: "i1", quantity: 2 }),
        item({ invoice_id: "i2", quantity: 3 }),
      ],
    });
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].sold_qty).toBe(5);
    expect(r.rows[0].invoice_numbers).toEqual(["INV-1", "INV-2"]);
  });

  it("computes total_value = sum(qty*price) per line", () => {
    const r = computeSold({
      date: DAY,
      invoices: [inv({})],
      items: [
        item({ invoice_id: "i1", quantity: 2, unit_price: 50 }),
        item({ invoice_id: "i1", product_id: "p2", product_name: "Other", quantity: 1, unit_price: 200 }),
      ],
    });
    expect(r.totals.value).toBe(2 * 50 + 1 * 200);
  });

  it("ignores non-product (custom) lines", () => {
    const r = computeSold({
      date: DAY,
      invoices: [inv({})],
      items: [
        item({ product_id: null, quantity: 9 }),
        item({ quantity: 1 }),
      ],
    });
    expect(r.totals.units).toBe(1);
    expect(r.excluded.non_product_lines).toBe(1);
  });

  it("ignores zero/negative quantities defensively", () => {
    const r = computeSold({
      date: DAY,
      invoices: [inv({})],
      items: [item({ quantity: 0 }), item({ quantity: -3 }), item({ quantity: 2 })],
    });
    expect(r.totals.units).toBe(2);
  });

  it("REGRESSION: free-stand bug — invoice exists & not voided → product MUST appear", () => {
    // Repro of the April-30 bug: a 'delete' log of an OLD invoice was inflating
    // log-based math and removing the product from today's PO.
    // computeSold uses ONLY invoices+items, so old delete logs cannot hurt.
    const r = computeSold({
      date: DAY,
      invoices: [inv({ id: "today-inv" })],
      items: [item({ invoice_id: "today-inv", product_name: "Free Stand", quantity: 1 })],
    });
    expect(r.rows.find((x) => x.product_name === "Free Stand")?.sold_qty).toBe(1);
  });
});

describe("reconcileDay — invariant: invoices ↔ inventory_logs net", () => {
  const log = (over: Partial<CalcInventoryLog>): CalcInventoryLog => ({
    product_id: "p1",
    change: -1,
    reason: "sale INV-1",
    invoice_id: "i1",
    created_at: inDay(),
    ...over,
  });

  it("reports OK when sale logs match invoice_items", () => {
    const r = reconcileDay({
      date: DAY,
      invoices: [inv({})],
      items: [item({ quantity: 2 })],
      logs: [log({ change: -2 })],
    });
    expect(r.ok).toBe(true);
    expect(r.mismatches).toBe(0);
  });

  it("reports OK when an edit happened: -1 sale + -1 edit-resale + +1 edit-revert + items=1", () => {
    // Edit flow on same day: original sale qty 1, edited to qty 1 (same).
    // Logs: sale -1, edit-revert +1, edit-resale -1 → net out 1.
    // Items final: 1.
    const r = reconcileDay({
      date: DAY,
      invoices: [inv({})],
      items: [item({ quantity: 1 })],
      logs: [
        log({ change: -1, reason: "sale INV-1" }),
        log({ change: 1, reason: "edit-revert INV-1" }),
        log({ change: -1, reason: "edit-resale INV-1" }),
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("reports OK when invoice was voided same day: items excluded, logs cancel", () => {
    const r = reconcileDay({
      date: DAY,
      invoices: [inv({ status: "voided" })],
      items: [], // voided invoice's items are still in DB but won't be picked up
      logs: [
        log({ change: -1, reason: "sale INV-1" }),
        log({ change: 1, reason: "void INV-1" }),
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("reports OK for deleted invoice: invoice gone, logs cancel via delete", () => {
    const r = reconcileDay({
      date: DAY,
      invoices: [], // deleted
      items: [],
      logs: [
        log({ change: -1, reason: "sale INV-1" }),
        log({ change: 1, reason: "delete INV-1" }),
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("FLAGS mismatch when logs show extra sale not in invoices (data corruption)", () => {
    const r = reconcileDay({
      date: DAY,
      invoices: [inv({})],
      items: [item({ quantity: 1 })],
      logs: [log({ change: -3 })], // claims 3 went out
    });
    expect(r.ok).toBe(false);
    expect(r.mismatches).toBe(1);
    expect(r.rows[0].diff).toBe(1 - 3);
  });

  it("ignores manual adjustments (out of scope for sales reconciliation)", () => {
    const r = reconcileDay({
      date: DAY,
      invoices: [inv({})],
      items: [item({ quantity: 1 })],
      logs: [
        log({ change: -1, reason: "sale INV-1" }),
        log({ change: -5, reason: "manual: damaged units", invoice_id: null }),
      ],
    });
    expect(r.ok).toBe(true);
  });
});
