## Add "Cost History per Product across POs" section to Profits page

### What the user will see
A new section inside `src/routes/profits.tsx` titled **"تاريخ التكلفة عبر أوامر الشراء / Cost History across POs"**, added as a first-class tab-style card at the top of the page (using a segmented switch consistent with the existing Noir & Gold theme).

Inside the section:
1. **Product picker** (multi-select with search):
   - Options: "كل المنتجات / All products", single product, or multi-select any subset.
   - Uses the products already loaded on the page (no extra fetch).
2. **Per-product breakdown table** (one block per selected product):
   - Product name + image thumbnail + collection chip.
   - Rows = every PO that contains this product, sorted newest → oldest:
     - PO number + status pill + order date
     - Quantity received in that PO
     - `unit_cost_usd` at that PO (original USD price)
     - `unit_cost_egp` (USD × the PO's exchange rate) 
     - Line total
   - Footer per product:
     - **Weighted average cost** (Σ qty×unit_cost ÷ Σ qty) in both USD and EGP
     - Simple average of unit prices
     - Min / Max unit price seen + which PO
     - Total quantity purchased across all POs
     - Trend sparkline of unit cost over time
3. **Grand summary** (when multiple/all products selected):
   - Total spend across selected products
   - Overall weighted-average cost per unit weighted by quantity across all selected items
   - Count of POs involved

### Technical notes
- Data source: `purchase_order_items` joined to `purchase_orders` (for po_number, status, order_date, usd_to_egp_rate), filtered by `product_id IN (selected)` and excluding `cancelled` POs (unless user toggles "Include cancelled").
- Fetch on demand when the section is expanded and when the product selection changes (React Query with key `["po-cost-history", productIds, includeCancelled]`, `staleTime: 60_000`). Cached in memory to avoid refetch when toggling.
- Realtime already subscribes to `purchase_order_items` in this page — invalidate this query on those events too.
- Pure calculation helpers extracted to a new file `src/lib/po-cost-history.ts` with unit tests `src/lib/po-cost-history.test.ts` covering weighted average, min/max, empty state, cancelled-PO exclusion.
- Formatting reuses `fmtMoneyAdaptive` and existing money utilities.
- Fully bilingual (AR/EN) using the page's existing `t(ar, en)` helper.
- Respects existing Noir & Gold styling: `noir-surface`, `gold-hairline`, gold accent for weighted average, muted for raw rows.

### Files
- Modify: `src/routes/profits.tsx` — add the section + product multi-select + data hook.
- Create: `src/lib/po-cost-history.ts` (pure logic).
- Create: `src/lib/po-cost-history.test.ts`.

### Out of scope
- No schema changes.
- No changes to how profits are computed elsewhere on the page.
- No editing of PO costs from this view (read-only history).
