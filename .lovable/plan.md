## Goal
Allow managers (`e.hesham` and `k.elsharbatly`) to attach an **invoice** (and any of its linked **delivery receipts**) to a task when assigning it to Esraa or F. Hesham. The attached invoice shows a badge:
- **مقفولة (Closed)** → "خدمة ما بعد البيع" (After-sales service)
- **مفتوحة (Open)** → "عميل" (Customer)

## Changes

### 1. Database (migration)
Add optional link columns to `public.tasks`:
- `invoice_id uuid references public.invoices(id) on delete set null`
- `delivery_receipt_ids uuid[]` (array — one task may reference multiple receipts of the same invoice)

Index `invoice_id`. Keep existing RLS as-is (link columns follow the task's own permissions).

### 2. Task creation dialog (`src/routes/tasks.tsx`)
In the create-task form, when the assignee is Esraa or F. Hesham, show a new optional section **"ربط بفاتورة"**:
- Smart search input (invoice number, customer name, phone) — debounced query against `invoices` returning last 50 matches with `status`, `customer_name`, `total`.
- After picking an invoice: show its badge (Closed→"خدمة ما بعد البيع", Open→"عميل") and a multi-select list of its delivery receipts (number + date) to attach.
- Save `invoice_id` + `delivery_receipt_ids` on insert.

### 3. Task row & detail view
- On each task card/row show a compact chip: invoice number + colored badge (Closed=amber "خدمة ما بعد البيع" / Open=blue "عميل"), plus a count of linked DRs.
- In the task detail dialog, list linked DRs as clickable links opening `/delivery-receipts/$id`, and invoice link to `/invoices/$id`.

### 4. Leadership card (`src/components/leadership-tasks-card.tsx`)
Mirror the same UI: the quick-create composer used by managers gets the same invoice search + DR multi-select, and rendered task items show the invoice chip + badge.

### 5. Filter
Add an "invoice status" filter in the tasks page toolbar: All / خدمة ما بعد البيع (closed) / عميل (open) / بدون فاتورة.

## Out of scope
- No change to invoice or delivery receipt schemas.
- No change to permissions for other users; regular assignees just see the read-only chip.
