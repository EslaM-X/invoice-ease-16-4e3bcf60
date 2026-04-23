

# Showroom Accounting Workflow — Edit, Void & Bulk QR

Make the system fully usable for your in-showroom flow: scan → invoice → print → edit/void with automatic stock correction, all server-side and accurate.

## What you'll get

### 1. Edit an existing invoice (safely)
- New page `/invoices/$id/edit` with the same builder UI as "New Invoice".
- Save calls a new server RPC `update_invoice` that runs in **one atomic transaction**:
  1. Locks the invoice and all related products (`FOR UPDATE`).
  2. Restores stock from the **old** items (reverse the original sale).
  3. Validates the **new** items against fresh stock.
  4. If any item is out of stock → rollback completely, nothing changes.
  5. Re-deducts stock for new items, replaces `invoice_items`, recalculates `subtotal`/`total` server-side, writes paired `inventory_logs` (`reason='edit-revert'` and `reason='edit-resale'`).
- "Edit" button added on the invoice view page and in the invoices list.

### 2. Void / delete invoice with stock restoration
- New RPC `void_invoice(_id)`:
  - Locks the invoice + products, adds quantities back to `products.stock_quantity`.
  - Inserts `inventory_logs` rows with `reason='void <invoice_number>'`.
  - Marks invoice `status='voided'` (keeps the record permanently — your data history stays intact) **and** offers a hard-delete variant `delete_invoice` that does the same restore then removes the row.
- Invoices list: replace raw `DELETE` with confirm dialog → calls `void_invoice` (default) or `delete_invoice` (with extra confirmation).
- Voided invoices show a "VOIDED" badge and are excluded from sales totals on the dashboard/reports.

### 3. Duplicate invoice — now safe
- Rewrite the existing `duplicate` action to call `create_invoice` RPC with the original line items. This guarantees stock validation, fresh prices, and a new invoice number.

### 4. Faster scan-to-invoice flow (showroom speed)
- **Continuous scan mode** in the QR dialog: after a successful scan, item is added and the camera stays open with a small toast — keep scanning the next item without reopening.
- **Auto-open scanner** when arriving at `/invoices/new` from a new "Scan & Sell" button on the dashboard.
- **Duplicate scan handling**: scanning the same product increments quantity instead of adding a duplicate line.
- **Audible beep** on successful scan (short Web Audio tone, no asset needed).
- Keyboard shortcut `S` to open scanner, `Enter` to save invoice.

### 5. Bulk QR printing for the showroom
- On `/products`, add **"Print QR Labels"** button:
  - Select multiple products (checkboxes) or "select all".
  - Opens a print-optimized A4 sheet with a grid of labels (3 columns × 8 rows) — each label shows: QR (product UUID), product name, serial, color, price.
  - Browser print → stick on the items in the showroom.

### 6. Inventory adjustment log
- Add an "Adjust stock" action on each product (manual +/- with reason). Writes to `inventory_logs` with `reason='manual: <text>'` so every stock change is auditable.

## Technical details

**New migration** (`update_invoice` + `void_invoice` + `delete_invoice` RPCs):
- All `SECURITY DEFINER`, `SET search_path = public`, validate `auth.uid() = invoices.user_id`.
- Use `FOR UPDATE` on products to prevent races (already proven by the 100-concurrent test).
- Add column `invoices.status` value `'voided'` (already free-text, no schema change needed) and an index on `(user_id, status, created_at)` for faster reports filtering.

**Files changed**:
- `supabase/migrations/<new>.sql` — three new RPCs + index.
- `src/routes/invoices.$id.edit.tsx` — new edit page (reuses builder form).
- `src/routes/invoices.new.tsx` — extract builder into shared `<InvoiceBuilder>` component used by both new + edit.
- `src/routes/invoices.$id.tsx` — add Edit + Void buttons; show VOIDED badge.
- `src/routes/invoices.index.tsx` — call RPC for delete/void; rewrite `duplicate` to use `create_invoice`; show status badges.
- `src/routes/products.tsx` — multi-select + "Print QR Labels" + "Adjust stock" dialog.
- `src/components/qr-scanner.tsx` — continuous mode, beep, dedupe.
- `src/routes/dashboard.tsx` — exclude `status='voided'` from totals; add "Scan & Sell" CTA.
- `src/routes/reports.tsx` — exclude voided from sales aggregates.
- `src/lib/i18n.tsx` — Arabic + English strings for new labels (Edit, Void, Voided, Adjust stock, Print labels, Continuous scan, etc.).

## Out of scope (ask if you want them)
- Offline mode (PWA / IndexedDB queue).
- Barcode (1D) support — only QR for now.
- Multi-user roles (cashier vs admin).

