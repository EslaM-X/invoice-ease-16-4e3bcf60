import { describe, it, expect } from "vitest";
import {
  decideCostSync,
  reconcileBackDeductions,
  type PoItemBefore,
} from "./po-cost-sync";

const base: PoItemBefore = {
  product_id: "prod-1",
  quantity: 10,
  unit_cost_usd: 100,
};

describe("decideCostSync (saveItemEdits + addProductToPO contract)", () => {
  it("updates the line total when qty changes", () => {
    const out = decideCostSync(base, { qty: 5, unit: 100 }, 100);
    expect(out.updateLine).toBe(true);
    expect(out.newLineTotal).toBe(500);
    expect(out.updateProductCost).toBe(false);
  });

  it("updates product cost retroactively when unit_cost_usd changes", () => {
    const out = decideCostSync(base, { qty: 10, unit: 120 }, 100);
    expect(out.updateLine).toBe(true);
    expect(out.newLineTotal).toBe(1200);
    expect(out.updateProductCost).toBe(true);
    expect(out.oldProductCost).toBe(100);
    expect(out.newProductCost).toBe(120);
  });

  it("does NOT touch product cost for free-text lines (no product_id)", () => {
    const out = decideCostSync(
      { ...base, product_id: null },
      { qty: 10, unit: 150 },
      0,
    );
    expect(out.updateProductCost).toBe(false);
  });

  it("does NOT update product cost when the unit is unchanged", () => {
    const out = decideCostSync(base, { qty: 12, unit: 100 }, 100);
    expect(out.updateLine).toBe(true);
    expect(out.updateProductCost).toBe(false);
  });

  it("does NOT re-update product cost when product already has that cost", () => {
    // PO line unit was 100, edited to 120, but product cost was already 120
    const out = decideCostSync(base, { qty: 10, unit: 120 }, 120);
    expect(out.updateProductCost).toBe(false);
  });

  it("treats addProductToPO (no prior line) as a fresh edit", () => {
    const fresh: PoItemBefore = { product_id: "p2", quantity: 0, unit_cost_usd: 0 };
    const out = decideCostSync(fresh, { qty: 3, unit: 200 }, 150);
    expect(out.updateLine).toBe(true);
    expect(out.newLineTotal).toBe(600);
    expect(out.updateProductCost).toBe(true);
    expect(out.oldProductCost).toBe(150);
    expect(out.newProductCost).toBe(200);
  });

  it("handles non-numeric current cost defensively", () => {
    const out = decideCostSync(base, { qty: 10, unit: 90 }, NaN as unknown as number);
    expect(out.updateProductCost).toBe(true);
    expect(out.oldProductCost).toBe(0);
    expect(out.newProductCost).toBe(90);
  });
});

describe("reconcileBackDeductions (report page integrity)", () => {
  it("reports totals across receipts", () => {
    const out = reconcileBackDeductions([
      { dri_id: "a", quantity: 3, current_stock: 5 },
      { dri_id: "b", quantity: 2, current_stock: 1 },
    ]);
    expect(out.totalReceipts).toBe(2);
    expect(out.totalQty).toBe(5);
    expect(out.hasDiscrepancies).toBe(false);
    expect(out.negativeCount).toBe(0);
  });

  it("flags rows that left stock negative", () => {
    const out = reconcileBackDeductions([
      { dri_id: "a", quantity: 3, current_stock: 5 },
      { dri_id: "b", quantity: 8, current_stock: -2 },
      { dri_id: "c", quantity: 1, current_stock: -1 },
    ]);
    expect(out.negativeCount).toBe(2);
    expect(out.negativeIds).toEqual(["b", "c"]);
    expect(out.hasDiscrepancies).toBe(true);
    expect(out.totalQty).toBe(12);
  });

  it("handles an empty report", () => {
    const out = reconcileBackDeductions([]);
    expect(out.totalReceipts).toBe(0);
    expect(out.totalQty).toBe(0);
    expect(out.hasDiscrepancies).toBe(false);
  });
});
