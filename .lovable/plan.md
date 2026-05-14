
## الهدف
نظام تتبّع متقدم لكل أمر شراء (PO) بمراحل واضحة، صفحة سجل/تتبع لكل الـ POs، وعند الاستلام تتم إضافة الكميات تلقائياً للمخزون بدقة وبدون تكرار.

## 1) مراحل الحالة الجديدة
نوسّع `purchase_orders.status` لتشمل سير عمل كامل:

```
draft → pending_cfo → priced → payment_pending → paid 
      → ordered → shipped → in_warehouse → received → cancelled
```

- كل تغيير حالة يسجَّل في جدول جديد `po_status_history` (المرحلة، التاريخ، المستخدم، ملاحظة اختيارية).
- إضافة أعمدة على `purchase_orders`:
  - `paid_at`, `paid_by`, `paid_by_email`
  - `shipped_at`, `expected_arrival_at`
  - `received_at`, `received_by`, `received_by_email`
  - `stock_applied_at` (Timestamp — يُستخدم كحارس لمنع إضافة المخزون مرتين)

## 2) صفحة "تتبع أوامر الشراء" — `/po-tracking`
تظهر في نفس تاب المشتريات/الربح في الـ Sidebar.

تعرض:
- جدول/كروت بكل POs مع: رقم، مورد، تاريخ، إجمالي USD/EGP، الحالة الحالية كـ Stepper مرئي، عدد القطع، المستلم منها فعلياً.
- فلاتر: حسب الحالة، المورد، التاريخ، بحث برقم PO.
- نقر على PO يفتح Drawer/Dialog فيه:
  - **Timeline كامل** من `po_status_history` (مَن/متى/ملاحظة).
  - تفاصيل كل المنتجات (صورة، اسم، سيريال، لون، كمية مطلوبة، كمية مستلمة).
  - أزرار الانتقال للمرحلة التالية حسب الصلاحية (admin/purchasing/cfo).

## 3) زر التتبع داخل صفحة `/purchase-orders`
- في كل صف PO وفي رأس الـ Detail Dialog: زر **«التتبع»** (أيقونة Route/Activity) يفتح نفس الـ Tracker Dialog (مكوّن مشترك `POTrackerDialog`).
- داخل الـ Dialog: Stepper أفقي + Timeline + أزرار تغيير الحالة + حقل ملاحظة لكل انتقال.

## 4) منطق الاستلام (Receive → Inventory)
- داخل الـ Tracker زر **«تم الاستلام»**:
  1. يفتح شاشة تأكيد تعرض كل بنود الـ PO مع حقل "الكمية المستلمة" لكل صف (Default = الكمية المطلوبة، يمكن للمستخدم تعديلها لو الاستلام جزئي).
  2. عند التأكيد، Server Function (`receivePurchaseOrder`) تنفّذ بشكل ذرّي:
     - تتحقق أن `stock_applied_at IS NULL` (حارس ضد التكرار).
     - تطابق كل بند بـ `product_id` (لو السيريال/اللون مختلف → يحدّث/ينشئ منتج بنفس البيانات والصورة).
     - تزيد `products.stock_quantity` بالكمية المستلمة.
     - تكتب صفّاً في `inventory_logs` (change موجب، reason="PO {رقم}", invoice_id=null, مرتبط بـ PO عبر reason/metadata).
     - تكتب `po_status_history` بحالة `received`.
     - تضع `status='received'`, `received_at=now()`, `stock_applied_at=now()`.
  3. لو حصل خطأ في أي خطوة → Rollback كامل (Postgres function داخل migration للأمان الذرّي).
- استلام جزئي: الـ PO يبقى في حالة `in_warehouse` لو لم تُستلم كل القطع، وتظهر بوضوح كميات متبقية.

## 5) تغييرات قاعدة البيانات (Migration)
- جدول `po_status_history` (po_id, from_status, to_status, note, actor_id, actor_email, created_at) + RLS.
- أعمدة جديدة على `purchase_orders` (انظر §1).
- دالة `apply_po_to_inventory(po_id uuid, items jsonb)` — SECURITY DEFINER، تتحقق من الحارس وتؤدي الزيادات + اللوجز ذرياً.
- RLS: قراءة لكل أعضاء الشركة، كتابة لـ admin/purchasing/cfo فقط.

## 6) ملفات الكود المتأثرة
- جديد: `src/routes/po-tracking.tsx`, `src/components/po-tracker-dialog.tsx`, `src/lib/po-tracking.functions.ts` (server fns: `transitionPOStatus`, `receivePurchaseOrder`).
- تعديل: `src/routes/purchase-orders.tsx` (زر التتبع + statusBadge موسّع), `src/components/app-shell.tsx` (إضافة عنصر القائمة), `src/lib/i18n.tsx` (مفاتيح الترجمة), `src/routeTree.gen.ts` (تلقائي).

## 7) i18n & UX
- جميع النصوص بالعربية والإنجليزية.
- Stepper متجاوب على الموبايل (يتحول رأسي تحت `sm`).
- إشعار `toast` + `notifications` لكل انتقال حالة (خاصة الاستلام).
- لا Reload للصفحة — كل التحديثات Realtime عبر `useRealtimeTable`.

## 8) أمان وذرّية
- منع إضافة المخزون مرتين عبر `stock_applied_at` + شرط داخل الـ DB function.
- كل Server Function محمية بـ `requireSupabaseAuth` + فحص الدور.
- تسجيل في `audit_log` لكل تغيير حالة وكل عملية استلام.

بعد موافقتك أبدأ التنفيذ على الفور.
