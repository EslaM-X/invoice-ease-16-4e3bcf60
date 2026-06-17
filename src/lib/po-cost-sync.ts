// Pure helpers for the "PO ↔ product cost" retroactive sync rule.
//
// Contract (verified by po-cost-sync.test.ts):
//  - When a PO item's `unit_cost_usd` changes, the linked product's
//    `cost_price_usd` MUST be updated to the new unit cost so the
//    inventory/profit reports stay accurate retroactively.
//  - The update is skipped when:
//      * the item has no product_id (free-text line)
//      * the new unit equals the previous PO unit (no real change)
//      * the new unit already equals the product's current cost
//  - line_total_usd = qty * unit (always recomputed when either changes)

export type PoItemBefore = {
  product_id: string | null;
  quantity: number;
  unit_cost_usd: number;
};

export type PoItemEdit = {
  qty: number;
  unit: number;
};

export type CostSyncDecision = {
  updateLine: boolean;
  newLineTotal: number;
  updateProductCost: boolean;
  productId: string | null;
  oldProductCost: number;
  newProductCost: number;
};

export function decideCostSync(
  before: PoItemBefore,
  edit: PoItemEdit,
  currentProductCost: number,
): CostSyncDecision {
  const qtyChanged = Number(edit.qty) !== Number(before.quantity);
  const unitChanged = Number(edit.unit) !== Number(before.unit_cost_usd);
  const updateLine = qtyChanged || unitChanged;
  const newLineTotal = Number(edit.qty) * Number(edit.unit);

  const oldCost = Number(currentProductCost) || 0;
  const newCost = Number(edit.unit);
  const updateProductCost =
    !!before.product_id && unitChanged && newCost !== oldCost;

  return {
    updateLine,
    newLineTotal,
    updateProductCost,
    productId: before.product_id,
    oldProductCost: oldCost,
    newProductCost: newCost,
  };
}

// Back-deduction reconciliation: pure check that a list of report rows
// is consistent with what the DB returned. Used by the report page to
// flag receipts whose deduction left stock negative.
export type BackDeductRow = {
  dri_id: string;
  quantity: number;
  current_stock: number;
};

export function reconcileBackDeductions(rows: BackDeductRow[]) {
  const totalReceipts = rows.length;
  const totalQty = rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  const negativeStock = rows.filter((r) => Number(r.current_stock) < 0);
  return {
    totalReceipts,
    totalQty,
    negativeCount: negativeStock.length,
    negativeIds: negativeStock.map((r) => r.dri_id),
    hasDiscrepancies: negativeStock.length > 0,
  };
}
