
## Goal
Replace the hardcoded "21 يوم عمل" delivery term with a per-invoice selectable value (7 / 21 / 30 / 45 / 60 working days), editable when creating or editing any invoice (draft or real), reflected on the printed invoice, and filterable from the invoices lists.

## 1. Database
Add a new column on `invoices`:
- `delivery_days integer NULL` (allowed values 7, 21, 30, 45, 60; enforced by a CHECK constraint that also allows NULL for legacy rows).
- No default — legacy invoices stay NULL and render as "21 working days" for backward compatibility.

No RLS changes; existing policies already cover the column.

## 2. Invoice Builder (`src/components/invoice-builder.tsx`)
- Add `deliveryDays` state (default `21`, initialized from `initial.delivery_days` in edit mode).
- Add a segmented select (chips: 7 / 21 / 30 / 45 / 60) inside the "Notes / Subject" section, labeled "شروط التسليم (أيام عمل) / Delivery term (working days)".
- Persist the value: since the create/update RPCs don't accept the new field, write it via a follow-up `supabase.from('invoices').update({ delivery_days }).eq('id', …)` right after the existing `subject` update (same pattern already used for `subject`). Applies to both new and edit paths, drafts and real invoices.

## 3. Edit page loader (`src/routes/invoices_.$id.edit.tsx`)
- Pass `delivery_days` through the `initial` object so the builder pre-selects the correct chip.

## 4. Printed invoice (`src/routes/invoices.$id.tsx`)
- Replace the hardcoded "21 يوم عمل من تاريخ الفاتورة" line with a dynamic string using `invoice.delivery_days ?? 21`:
  - AR: `"{n} يوم عمل من تاريخ الفاتورة"`
  - EN: `"{n} working days from invoice date"`

## 5. Filter on invoice lists
- `src/routes/invoices.index.tsx` and `src/routes/invoices.drafts.tsx`: add a "شروط التسليم / Delivery term" dropdown filter alongside the existing filters with options: All / 7 / 21 / 30 / 45 / 60. When a value is chosen, filter the fetched list by `delivery_days === value` (client-side filter to match the pattern of other filters on these pages).

## 6. Types
Regenerated Supabase types will pick up `delivery_days` automatically after the migration runs, so the `as any` casts in the update calls can be dropped in a follow-up.

## Out of scope
- Global default in Settings (kept as free-text `delivery_terms` for header block).
- Business-day date computation / due-date display (only the term label is requested).
