## الهدف
حالة تسليم الفاتورة (`invoices.delivery_status`) تُحسب **تلقائياً** من محاضر الاستلام المرتبطة بيها، مش من زر يدوي. لما مجموع الكميات المُسلَّمة عبر كل المحاضر (غير الـ draft وغير المؤرشفة) = مجموع كميات بنود الفاتورة → `delivered`. لو أقل > 0 → `in_transit` (جزئي). لو صفر → `pending`.

لا يُطبَّق على: الفواتير المؤرشفة/الملغاة/المقفولة، ولا على الفواتير القديمة اللي حالتها دلوقتي `delivered` من غير محاضر (نسيبها زي ما هي).

## الخطوات

1. **Migration — دالة إعادة الحساب + Trigger**
   - `public.recompute_invoice_delivery_status(_invoice_id uuid)`:
     - Skip لو الفاتورة `status IN ('voided','archived')` أو `archived_at IS NOT NULL`.
     - يحسب `needed = SUM(invoice_items.quantity)`.
     - يحسب `delivered = SUM(delivery_receipt_items.quantity)` من محاضر بحالة `signed` أو `out_for_delivery` فقط (يستبعد `draft` و `archived_at IS NOT NULL`).
     - `delivered >= needed AND needed > 0` → `'delivered'` ويُثبّت `delivery_assignee_*` لو موجودة.
     - `delivered > 0` → `'in_transit'`.
     - غير كده → `'pending'` (وينضّف الـ assignee).
     - يعمل `UPDATE` بس لو الحالة اتغيّرت فعلاً.
   - Triggers `AFTER INSERT/UPDATE/DELETE` على:
     - `delivery_receipt_items` (يستدعي للـ `invoice_id` عن طريق join مع `delivery_receipts`).
     - `delivery_receipts` (لما `status` أو `archived_at` يتغيّر).
   - `SECURITY DEFINER`, `SET search_path=public`.
   - Backfill: `SELECT recompute_invoice_delivery_status(id) FROM invoices WHERE status NOT IN ('voided','archived') AND archived_at IS NULL AND EXISTS (SELECT 1 FROM delivery_receipts dr WHERE dr.invoice_id = invoices.id);` — بيحدّث بس الفواتير اللي عندها محاضر (يحمي الفواتير القديمة اللي متسلّمة يدوياً من غير محاضر).

2. **Frontend — `src/components/delivery-status-control.tsx`**
   - إزالة الأزرار الثلاثة (Pending/In Transit/Delivered) وأي `saveStatus` يدوي.
   - الكارت يبقى **قراءة فقط** لحالة التسليم + شارة توضيحية "الحالة تُحسب تلقائياً من محاضر الاستلام" مع رابط لصفحة إنشاء/عرض المحاضر.
   - يفضل قسم "المسؤول عن التسليم" (Assignee) شغّال زي ما هو — دا مش جزء من الحساب الأوتوماتيكي.
   - `onMarkDelivered` prop تتشال من الاستدعاء في `src/routes/invoices.$id.tsx`.

3. **`src/routes/invoices.$id.tsx`**
   - إزالة أي كود يعمل `update({ delivery_status: 'delivered' })` يدوي من زر التسليم (السطر 71 و 102).
   - الاعتماد على Realtime على جدول `invoices` (موجود) لإظهار الحالة الجديدة بعد أي تغيير في المحاضر.

## نطاق ما لن يتأثر
- الفواتير المؤرشفة أو `voided` — الـ trigger بيخرج بدري.
- الفواتير القديمة اللي `delivered` بدون محاضر — الـ Backfill بيتجاهلها.
- منطق المحاضر نفسها، النواقص، التسعير، الأرصدة، الأوامر.

## Technical notes
- الـ trigger يستدعي `recompute_invoice_delivery_status` مرة واحدة لكل `invoice_id` متأثر (يستخدم `NEW.receipt_id` → `dr.invoice_id` أو `OLD` عند الحذف).
- يستخدم `PERFORM` مش `SELECT` عشان يتجنب unused-result.
- يتأكد أن الـ `UPDATE` على `invoices` ما يعملش recursion (شرط `IS DISTINCT FROM`).
