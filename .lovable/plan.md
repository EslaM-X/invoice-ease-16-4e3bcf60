## Goal
Let users add new product collections (like JOY/UP/ART/QUATRO) from the Products page — each with its own distinct color — and reuse them everywhere collections appear (filters, badges, invoice/PO pickers).

## Approach
Move collections from a hardcoded constant to a database-backed list, keep the four existing ones as defaults, and add a small manager on the Products page.

## Backend
- New table `public.collections`:
  - `code` (unique, uppercase, e.g. `JOY`)
  - `label` (display name)
  - `color_hex` (accent color — used to derive pill/badge/dot styles)
  - `sort_order`, `is_active`
  - standard `created_at/updated_at` + updated-by trigger
- GRANT + RLS:
  - `SELECT` for `authenticated` (everyone in the app can see them)
  - `INSERT / UPDATE / DELETE` restricted to admins (via existing `has_role`)
- Seed the four existing values (`JOY` rose, `UP` sky, `ART` violet, `QUATRO` amber) so nothing visually changes on day one.
- Products table already has a free-text `collection` column — no schema change there; we just validate against the list.

## Frontend
1. `src/lib/collection-styles.ts`
   - Convert from a static map to a runtime style built from `color_hex` (inline styles for solid/soft/badge/dot). Keep the same exported function signatures so all existing callers keep working.
2. New hook `src/lib/use-collections.ts`
   - Loads `collections` once (cache-first via existing `cachedListFetch`), exposes `list`, `byCode`, `refresh`, and realtime updates.
3. `src/lib/data.ts`
   - Replace the exported `COLLECTIONS` constant with a helper that reads from the hook/cache; keep the type as `string` so existing code compiles.
4. `src/routes/products.tsx`
   - Filter chips + form dropdown + CSV import validation switch to the dynamic list.
   - Add a "Manage collections" (إدارة الكولكشنات) button next to the filter chips → opens a dialog where admins can:
     - Add a new collection (code, label, color picker with live preview swatch)
     - Rename / recolor / deactivate existing ones
     - Reorder
   - Non-admins see the button disabled with a tooltip.
5. Other consumers (`invoice-builder.tsx`, `qr-price-list.tsx`, `purchase-orders.tsx`, `in-transit.tsx`) — swap the `COLLECTIONS` import for the new hook. No UI redesign, same chips/pickers.

## UX details
- Color picker: native `<input type="color">` + 8 curated Noir & Gold-friendly presets (rose, sky, violet, amber, emerald, fuchsia, teal, orange).
- Code is auto-uppercased and validated unique.
- Deleting a collection that's still in use is blocked; offer "Deactivate" instead (hides it from pickers but keeps history intact).
- Everything stays consistent with the existing Noir & Gold styling — no visual regression for the 4 seeded collections.

## Out of scope
- No changes to profits/PO cost logic.
- No migration of existing product rows (their `collection` text values stay as-is and match by code).
