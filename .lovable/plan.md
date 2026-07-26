
## Part 1 — Manual control over invoice delivery status

**Problem:** New invoices appear as "delivered" without an actual delivery receipt. The user wants to be the one who decides — choose *In Transit*, assign a person/company account responsible, or explicitly mark delivered — and the choice must save instantly.

### Changes

1. **Never auto-mark new invoices as delivered.**
   - In `src/components/invoice-builder.tsx`, remove the "Marked as delivered" checkbox from the *new-invoice* flow entirely. New invoices always start as `pending` (already the DB default; also strip the post-create `update({ delivery_status: 'delivered' })` blocks at lines 839–844 and 901–906).
   - In *edit* mode keep the ability to change it, but move it out of the save path — no more implicit overwrite on every save (line 876 currently forces `delivered ? 'delivered' : 'pending'` on every save, which can flip a `partial` status back). The status will be managed exclusively from the invoice detail page / delivery receipts.

2. **New "Delivery" control on the invoice detail page** (`src/routes/invoices.$id.tsx`).
   Replace the current single "Mark delivered" toggle with a small card that lets the user pick one of:
   - **Pending** (default)
   - **In Transit** — with an assignee: either a team member (from `profiles` / company members) or "Company account" (generic). The assignee name is persisted.
   - **Delivered** — only reachable manually here, or automatically once delivery receipts fully cover the invoice (existing `recalc_invoice_delivery_status` trigger already does this on receipt creation — unchanged).
   Each change writes immediately (`onChange` → `supabase.update`) and shows a toast; realtime subscription (already in place) keeps the UI in sync across devices.

3. **Persistence.** Add two nullable columns on `invoices` via migration:
   - `delivery_assignee_id uuid null references profiles(id)`
   - `delivery_assignee_label text null` (fallback label, e.g. "Company account" or a free-text name)
   Only admins/company members can update these (piggy-back on existing invoice update policy). No default value — pending stays pending.

4. **Guardrails.** Keep the existing uncovered-shortage guard when the user chooses *Delivered* manually.

### Technical notes
- `create_invoice` / `update_invoice` RPCs are not changed — they never set `delivery_status`, and the trigger `tg_recalc_delivery_status` only reacts to receipt rows, so removing the client-side override is enough.
- The new columns are UI metadata; they do not affect the delivery-status recalc.

---

## Part 2 — Mobile PDF / print looks broken

**Problem:** On mobile, "Save PDF" / "Print" from the invoice page produces overlapping text and a squeezed layout. Desktop looks correct.

**Root cause:** The `.print-area` container inherits the mobile viewport width and mobile-only utility classes (stacked columns, tighter paddings). `@media print` in `src/styles.css` doesn't force a fixed A4 layout, so the browser prints whatever the mobile viewport currently renders.

### Changes to `src/styles.css` (`@media print` block only)

- Add `@page { size: A4; margin: 0; }`.
- Force the `.print-area` to render at a fixed A4 width regardless of the device:
  - `width: 210mm; min-width: 210mm; max-width: 210mm;`
  - `transform-origin: top left;` and remove any mobile flex/grid collapse by setting `.print-area .invoice-page` to a desktop-like flow (unset `flex-direction: column` overrides on small screens, force `display: block`/`table` where needed).
- Neutralize Tailwind mobile-first utilities inside `.print-area` during print by re-declaring the desktop layout classes we depend on (invoice header row, items table columns, totals grid) with `!important` inside `@media print`. This keeps a single source of truth (the existing markup) while guaranteeing desktop appearance.
- Ensure images (`.invoice-logo`, product thumbs) use `print-color-adjust: exact` and don't overflow their cells.
- Add `overflow-wrap: anywhere` on long text fields (customer name, notes, item name) so nothing pushes into the next column.

### Print trigger on mobile (`src/routes/invoices.$id.tsx`)

- Before `window.print()`, temporarily set `document.documentElement.style.setProperty('--print-force-desktop','1')` and swap the viewport meta to `width=794` (A4 @ 96dpi) for the duration of the print, restoring it in the existing `afterprint` handler. This makes mobile Chrome/Safari lay out the print area at desktop width before rasterizing.
- No changes to `invoice-export.ts` (the jsPDF path is already device-independent).

### QA
- Verify on the mobile viewport (964×… preview) that the "Print / Save PDF" flow lays out identically to desktop, using Playwright to screenshot the print preview.

---

## Files touched

- `src/components/invoice-builder.tsx` — remove auto-delivered writes; drop the checkbox from new mode.
- `src/routes/invoices.$id.tsx` — new Delivery control (Pending / In Transit + assignee / Delivered); mobile viewport swap around `window.print()`.
- `src/styles.css` — hardened `@media print` block (A4 width, desktop layout override, wrap rules).
- One migration to add `delivery_assignee_id`, `delivery_assignee_label` on `invoices` (nullable, no default; update policy piggy-backs on existing invoice policy).

## Out of scope
- Delivery-receipt creation flow (unchanged).
- `create_invoice` / `update_invoice` RPCs and triggers (unchanged).
- Any change to how `delivered` cascades to stock/shortage logic.
