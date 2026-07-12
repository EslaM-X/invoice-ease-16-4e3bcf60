## Goal
Show the true **landed unit cost** per PO line in "Cost History across POs" — include USD FX rate, customs, taxes, shipping, and extra/other cost — then compute a proper weighted average across selected products/POs. Reactive to any PO change or repricing.

## Landed cost formula (per PO line)
For each PO, overheads are already stored as EGP amounts (mode = "percent" of `total_usd * usd_rate`, or "fixed" EGP):

```text
overheadsEgp = customs + taxes + shipping + other   (all in EGP, per PO)
baseEgp      = total_usd * usd_rate                 (per PO)
share_i      = (qty_i * unit_usd_i) / total_usd     (line share by USD value)
landed_line_egp_i = (qty_i * unit_usd_i * usd_rate) + share_i * overheadsEgp
landed_unit_egp_i = landed_line_egp_i / qty_i
landed_unit_usd_i = landed_unit_egp_i / usd_rate    (for display parity)
```

Fallback if `total_usd = 0`: allocate by qty share.

Weighted average across lots (existing rule, but on landed values):
`WAC_egp = Σ(qty_i * landed_unit_egp_i) / Σ qty_i`

## Changes

### 1. Backend RPC `get_product_cost_book`
Extend it to return per-lot landed cost fields so the frontend doesn't refetch every PO. Add to each lot:
- `usd_rate`, `customs_egp`, `taxes_egp`, `shipping_egp`, `other_egp` (PO totals),
- `line_share` (0-1),
- `landed_unit_usd`, `landed_unit_egp`, `landed_line_egp`.

The RPC computes overheadsEgp using stored mode/value against `total_usd*usd_rate` and the per-line share by USD value (fallback qty). No schema change — pure SQL migration replacing the function.

### 2. `src/lib/po-cost-history.ts`
- Extend `PoCostLot` with the new landed fields (optional to keep back-compat).
- Update `summarizeProduct` / `summarizeMany` to weight on **landed** unit cost when available (falls back to raw `unit_egp` if RPC not yet upgraded). Add fields `wacLandedUsd`, `wacLandedEgp`, `totalLandedEgp`, and per-lot breakdown getters.
- Extend unit tests for landed weighting + share allocation.

### 3. `src/routes/profits.tsx` — Cost History panel
- Extend `CostBookLot` type with new fields.
- Per-product header badges: show base WAC, landed WAC, and Δ overhead %.
- PO rows table: add columns **FX**, **Customs**, **Taxes**, **Shipping**, **Extra**, **Landed unit EGP**, **Landed line EGP** (compact, scroll-x on mobile). Clicking a row still opens `POTrackerDialog`.
- Grand totals row: landed WAC across selected products.
- Small legend/tooltip explaining allocation method.
- Already reactive to `purchase_orders`/`purchase_order_items` realtime → no extra wiring needed; any PO edit/repricing triggers `loadCostBook()` and re-renders.

### 4. i18n
Arabic + English strings for: سعر الصرف / FX, الجمارك / Customs, الضرائب / Taxes, الشحن / Shipping, تكلفة إضافية / Extra, التكلفة المُحمَّلة للوحدة / Landed unit cost, متوسط مرجّح مُحمَّل / Landed weighted average.

## Out of scope
- No change to how POs are entered or how overheads are stored.
- No change to `profits.tsx` main table WAC (kept as-is unless you also want it landed — say the word).

## Technical notes
- The RPC change is backwards compatible: old callers still get the fields they read.
- All arithmetic guards against division by zero.
- Deterministic sort of lots by shipment date (already done via `sortLotsByDateDesc`).
