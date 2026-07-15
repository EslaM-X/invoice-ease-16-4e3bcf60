## الهدف

في محاضر الاستلام **الجديدة من الآن فقط**:
- يظهر في المحضر (على الشاشة و في PDF) **كل بنود الفاتورة** — مش بس الي بسلمه دلوقتي.
- كل بند يظهر أمامه:
  - الكمية الي بسلمها **في هذا المحضر** (رقم — ممكن يكون 0).
  - أو "**مسلَّمة مسبقًا: N**" لو اتسلمت في محضر أقدم.
  - أو "لم تُسلَّم بعد" لو 0 من كل محاضر الفاتورة.
- الميزة الحالية (تسليم كامل / mixer / trim / خارجي) تفضل شغالة كما هي.
- **المحاضر القديمة لا تتأثر** — تعرض نفس الشكل القديم بالضبط.

---

## طريقة التمييز بين "قديم" و "جديد"

نضيف عمود `layout_version smallint` على `delivery_receipts`:
- كل المحاضر الحالية تتحدّث لـ `layout_version = 1` (الشكل القديم).
- الافتراضي الجديد `= 2` — أي محضر يُنشأ من الآن يحمل الشكل الجديد.
- المنطق في الفورم / صفحة العرض / PDF يتفرّع بناءً على القيمة.

القاعدة بتفضل صادقة تخزّن **فقط** البنود المُسلَّمة في المحضر ده (زي دلوقتي). العرض هو الي يجمّع الصورة الكاملة وقت الطباعة — عشان ما نتلخبطش مع الفواتير القديمة ومع RPCات التدقيق الموجودة.

---

## ما سيتغير — تفصيل غير تقني

**1) صفحة إنشاء محضر جديد (`/delivery-receipts/new`)**
- الجدول يعرض كل بنود الفاتورة، مش المتبقي فقط.
- كل صف فيه:
  - كمية الفاتورة، الكمية المسلَّمة مسبقًا، المتبقي.
  - خانة إدخال "كمية التسليم الآن" — قابلة للتصفير أو تعبئتها بالمتبقي بضغطة (زر مساعد "املأ المتبقي" / "صفّر").
  - لو البند مسلَّم بالكامل مسبقًا: يظهر شارة واضحة **"مسلَّمة مسبقًا"** والحقل يكون 0 وغير قابل للتعديل.
  - اختيار الجزء (كامل / mixer / trim) يفضل زي ما هو، ويظهر لأي بند متعدد الأجزاء.
- زرار سريع أعلى الجدول: "املأ كل المتبقي" / "صفّر الكل" — يسهل الاستخدام.
- ما تفضلش لازم تختار البند بتيك؛ الصف كله جاهز للكتابة، والصف الي كميته الآن = 0 يتبعت مع المحضر (لكن ما يتسجّلش كبند مُسلَّم في القاعدة — يظهر فقط عند الطباعة كـ "0" أو "مسلَّمة مسبقًا").

**2) صفحة عرض المحضر + PDF (`/delivery-receipts/$id`)**
- لو `layout_version = 1` (محضر قديم): نفس الشكل الحالي بالضبط — لا تغيير.
- لو `layout_version = 2` (محضر جديد):
  - الجدول المطبوع يعرض **كل بنود الفاتورة**.
  - عمود الكمية يعرض:
    - الرقم لو البند فعلاً مُسلَّم في هذا المحضر.
    - **"0"** لو البند مش داخل في هذا المحضر ومش مُسلَّم في محاضر سابقة.
    - **"مسلَّمة مسبقًا"** (مع رقم المحضر السابق أو التاريخ) في عمود الملاحظة لو اتسلمت في محضر أقدم.
  - ملاحظة البند (mixer / trim / full …) تفضل تظهر كما هي.
  - رسوم الشحن تظهر كما هي.

**3) قائمة "محضر آخر لنفس الفاتورة"** تفضل شغالة — عادي تعمل عدة محاضر جزئية على نفس الفاتورة، والمحضر الأحدث يفهم أن الأقدم "مسلَّم مسبقًا".

**4) لا تعديل على منطق المخزون / التدقيق / سجل التغييرات** — الي بيتخزّن هو نفس البنود المُسلَّمة فقط.

---

## Technical section (implementation details)

### 1. Migration (`supabase--migration`)
```sql
ALTER TABLE public.delivery_receipts
  ADD COLUMN IF NOT EXISTS layout_version smallint NOT NULL DEFAULT 2;

-- Freeze every existing receipt to the legacy layout so their PDFs stay identical
UPDATE public.delivery_receipts SET layout_version = 1 WHERE created_at < now();
```
No RLS/GRANT changes — new column inherits table-level grants. No RPC signature change: the RPC keeps inserting rows without touching the column, and the default (`2`) covers new receipts.

### 2. `src/lib/delivery-receipts.ts`
- Extend `InvoiceItemWithDelivered` with a `prior_delivered_qty` if useful, or add a new helper `fetchInvoiceItemsForPrint(invoiceId, receiptId)` that returns, for each invoice_item:
  - `invoice_qty`, `this_receipt_qty`, `delivered_before_this`, `delivered_after_this`, `notes_from_this_receipt`.
  Uses `created_at` ordering across sibling `delivery_receipt_items` joined on `receipt_id → delivery_receipts.created_at`.

### 3. `src/components/delivery-receipt-form.tsx`
- Only affects **`mode === "new"`**. `mode === "edit"` keeps current UX.
- In `new` mode:
  - Default `selected = true` for every row; keep the checkbox but pre-check all.
  - Add "Fill all remaining" / "Clear all" quick buttons above the table.
  - For rows where `remaining === 0 && delivered_other > 0`: render a badge "مسلَّمة مسبقًا"، disable the qty input, force `qty = 0`, keep the row visible.
  - Client-side submit already tolerates rows with `qty > 0` only — no change; qty-0 rows are simply not persisted.

### 4. `src/routes/delivery-receipts.$id.tsx` (view + PDF)
- Read `r.layout_version`.
- If `>= 2`: fetch `invoice_items` and all sibling `delivery_receipt_items` for the invoice; build a merged rows array (`allRows`) sorted by invoice item order; render the printable table from `allRows` instead of `items`, with:
  - qty column: `this_qty` (0 if none in this receipt).
  - note column: existing note; if `prior_qty > 0`, append `مسلَّمة مسبقًا: N (محضر #…)`.
- Else: render exactly as today (`items`). This preserves every old receipt visually.
- Shipping-fees row unchanged.

### 5. Types
- Regenerate `src/integrations/supabase/types.ts` implicitly after the migration (Lovable Cloud auto-regenerates). No code depends on the column name yet.

### 6. Backward compatibility checks
- Audit-log page still writes to `delivery_receipt_audit_log` unchanged — the new column is just data.
- Fulfillment engine / closure detection still counts by summing `delivery_receipt_items.quantity` — unchanged.
- Realtime subscriptions & existing dialogs (`DeliveryReceiptTracker`) — unchanged.

### 7. Non-goals (deliberately not touched)
- Old receipts' layout, storage schema of items, RPCs for create/update, mixer/trim/full logic, shipping fees, signatures, invoice statuses.

---

## Deliverables

1. New migration adding `layout_version` + backfilling existing receipts to `1`.
2. Updated `delivery-receipt-form.tsx` (new-mode UX only).
3. New helper `fetchInvoiceItemsForPrint` in `src/lib/delivery-receipts.ts`.
4. Updated `delivery-receipts.$id.tsx` view/PDF to switch on `layout_version`.
