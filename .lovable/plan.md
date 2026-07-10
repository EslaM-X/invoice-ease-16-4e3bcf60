## Goal

Introduce a **weighted-average cost (WAC)** engine per product, computed from every PO's historical cost, and wire it into صفحة صافي الأرباح so profit stays accurate across FX changes and future cost edits — without touching invoices, DRs, POs, or `products.cost_price*` writes.

## Approach: read-only "Cost Book"

Add a **pure derived view** `product_cost_book` (SQL view + RPC) that aggregates every `purchase_order_items` row for POs whose status ∈ (`priced`, `partially_received`, `received`, `closed`) — cancelled/draft excluded. For each `product_id` it returns:

- `po_lots[]`: `{ po_id, shipment_code, po_date, qty, unit_cost_usd, usd_rate, unit_cost_egp, line_total_egp }`
- `wac_usd` = Σ(qty × unit_usd) / Σ(qty)
- `wac_egp` = Σ(qty × unit_egp) / Σ(qty) — where `unit_egp = unit_cost_usd × COALESCE(po.usd_rate, current_rate)`
- `latest_unit_usd`, `latest_unit_egp`, `min_unit`, `max_unit`, `total_qty_purchased`

**No writes anywhere.** Products/POs/invoices remain untouched.

## Profits page rewrite (cost source switch)

Add a segmented control at the top of `/profits`:

```text
مصدر التكلفة:  [ متوسط مرجّح (WAC) ]  [ آخر PO ]  [ تكلفة المنتج الحالية ]  [ يدوي ]
سنة مالية:     [ 2024 ] [ 2025 ] [ 2026 ]  [ الكل ]
```

- **WAC (default & recommended)** — uses `wac_egp` per product from the Cost Book.
- **Last PO** — uses `latest_unit_egp`.
- **Current product cost** — today's behavior (`products.cost_price`).
- **Manual** — per-product override stored in a new tiny table `profit_cost_overrides (product_id, cost_egp, note)` — admin-only, does NOT affect any other page.

All KPI cards (إجمالي البيع / التكلفة / صافي الربح / هامش الربح / شحن مستبعد) recompute live from the selected source. The mismatch banner stays.

## New section on Profits page: "دفتر التكاليف" (Cost Book)

Collapsible panel with:

- Filters: بحث منتج، لون (ColorSwatch chips), كولكشن، سيريال، PO/شحنة.
- Table per product row: صورة · اسم · لون · سيريال · كولكشن · **متوسط USD** · **متوسط EGP** · آخر تكلفة · أقل/أعلى · إجمالي الكمية المشتراة.
- Expand row → per-PO lots table: `PO code · تاريخ · qty · unit USD · usd_rate · unit EGP · إجمالي EGP` with a mini sparkline of unit_usd over time.
- Export Excel/PDF.

## Fiscal year handling

- `fiscal_year_start_month` setting (default: 1 = January). Presets: 2024 / 2025 / 2026 / كل.
- All Profits queries + Cost Book lots are filtered by the chosen FY.

## Responsiveness

Cards → `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`. Filter bar → stacked on mobile, inline on ≥sm. Cost Book table → horizontal scroll on mobile with sticky product column. Verified via Playwright at 375 / 768 / 1280.

## Safety guarantees

- No changes to `invoices`, `invoice_items`, `purchase_orders`, `purchase_order_items`, `delivery_receipts`, `products.cost_price*`.
- No triggers touched.
- The Cost Book is a SELECT-only view + RPC; overrides live in a separate table used only by `/profits`.

## Technical details

- **Migration 1:** `CREATE OR REPLACE VIEW product_cost_book_lots` + `CREATE FUNCTION get_product_cost_book(p_fy_start date, p_fy_end date)` returning JSON per product (uses `SECURITY DEFINER` + `is_admin()`/`is_company_member()` gate; cost columns are admin/executive-only per existing memory).
- **Migration 2:** `CREATE TABLE profit_cost_overrides` (admin-only RLS) + `updated_at` trigger + GRANTs.
- **Frontend:** rewrite `src/routes/profits.tsx` — add `useCostSource` state, fetch cost book via RPC with React Query, replace `costOf(product)` helper to switch source. Add `<CostBookPanel>` component. Add FY selector. Keep existing Excel export, extend it with WAC columns.
- **Realtime:** subscribe to `purchase_order_items` and `purchase_orders` to invalidate the cost book query.
- FX fallback: if `po.usd_rate` is null on a historical PO, use the nearest later PO's `usd_rate`, else `settings.default_usd_rate`, else 50.

## Out of scope (call out explicitly)

- No change to how invoice profit is stored per line.
- No auto-update of `products.cost_price` from WAC.
- No change to distributor/PO/DR flows.
