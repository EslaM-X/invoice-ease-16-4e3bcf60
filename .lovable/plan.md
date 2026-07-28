# Reservation Engine — Status

## Wave 1 — Schema + Backfill ✅
- `invoice_items.reserved_qty`, `invoice_items.delivered_qty`
- `products.reserved_quantity`, generated `products.available_quantity`
- Trigger `sync_product_reserved_qty` keeps product totals in sync
- Backfill: delivered/reserved computed from historical receipts + active invoices

## Wave 2 — RPCs + Delivery Hooks (behind flag) ✅
- `system_flags.reservation_engine` toggle
- `reserve_invoice_items(invoice_id)` — sets `reserved_qty`, auto-opens `shortage_requests` on deficit
- `release_invoice_reservation(invoice_id)` — clears reservations
- `apply_delivery_signature(receipt_id)` — signed receipt → deducts stock, moves reserved→delivered, sets `stock_applied_at`
- `reverse_delivery_signature(receipt_id)` — undoes the above
- `tg_dr_reservation_hook` on `delivery_receipts` (gated by flag)

## Wave 3 — Switch-Over + UI ✅
- `invoices.stock_flow` marker (`immediate` vs `reservation`) — separates legacy from new invoices
- `cover_invoice_item` skips immediate stock deduction when flag is on (PO reservations still linked)
- `create_invoice` (both overloads) tag new invoices `reservation`, call `reserve_invoice_items` after loop
- `delete_invoice` / `convert_invoice_to_draft` — restore only `delivered_qty` for reservation-flow invoices, keep full-restore for legacy
- `tg_release_on_status_change` trigger — auto-releases reservations on cancelled/voided/draft
- Flag flipped **ON**; existing live invoices re-normalized via `reserve_invoice_items`
- UI: `invoice-builder` uses `effectiveStockFor(p) = stock - reserved_by_others`, shows Stock / Reserved / Available badges
- UI: `products` page shows the same 3 badges per row

## State snapshot after Wave 3
- Engine flag: **ON**
- Legacy invoices: 103 (still `immediate`) — behave exactly as before
- New invoices going forward: `reservation` flow
- Products currently reserved: 72 (266 units total across live invoices)

## What happens now on a new invoice
1. `create_invoice` inserts rows without touching `stock_quantity`.
2. `reserve_invoice_items` sets `reserved_qty` per line; any deficit → auto-`shortage_requests`.
3. `products.reserved_quantity` updates via trigger → `available_quantity` drops.
4. When a delivery receipt is signed → `apply_delivery_signature` deducts real stock and shifts `reserved → delivered`.
5. Cancel/void/draft → reservations auto-released.
6. Delete invoice → only delivered portion restocked (legacy invoices still fully restocked).
