
# خطة التنفيذ — مرحلة 2: تعديل الشحنات + قطع غيار + إصلاح المخزون يدويًا

## 1) تعديل الشحنات بأمان (نوع + تاريخ + إعادة ترقيم)

### قاعدة البيانات
- إضافة دالة `reassign_shipment_code(po_id, new_type, new_date)`:
  - تحدّث `shipment_type` و `created_at` (أو عمود جديد `shipment_date timestamptz` للحفاظ على `created_at` الأصلي — **سؤال أدناه**).
  - بعد التعديل: تُعيد ترقيم **جميع POs** للمستخدم/الشركة لكل نوع على حدة، مرتّبة تصاعديًا حسب `shipment_date` بتوقيت القاهرة (`AT TIME ZONE 'Africa/Cairo'`).
  - تحدّث `receipt_code` لكل `po_receipts` المرتبطة (مثل `G3#1` → `A5#1`).
  - تحدّث `shipment_counters.last_seq` للنوعين المتأثرين.
  - SECURITY DEFINER، مقصور على admin/purchasing.
- إضافة عمود `shipment_date timestamptz` على `purchase_orders` (افتراضي = `created_at`) ليصبح هو مفتاح الترتيب، فلا نفقد سجل الإنشاء الفعلي.

### واجهة `purchase-orders.tsx`
- زر «تعديل الشحنة» على كل بطاقة PO يفتح Dialog:
  - منتقي النوع (G/A/D) بنفس البطاقات الملوّنة.
  - منتقي تاريخ + ساعة (DateTimePicker بتوقيت القاهرة).
  - تحذير واضح: «سيتم إعادة ترتيب كل أكواد الشحنات تلقائيًا».
- بعد الحفظ: تحديث الواجهة وإظهار توست بالكود الجديد.

## 2) إضافة دفعات استلام تاريخية (Backfill)

- في `po-tracker-dialog.tsx` زر «إضافة دفعة قديمة» (يظهر للأدمن فقط):
  - يفتح نموذج محضر جزئي + حقل تاريخ يدوي.
  - يستخدم RPC جديدة `record_historical_po_receipt(po_id, receipt_date, items, notes)`:
    - يحترم نفس قواعد `apply_po_to_inventory` لكن مع تاريخ مخصّص.
    - يولّد `receipt_code` بشكل تسلسلي صحيح حسب التاريخ.
    - **لا** يُحدّث المخزون تلقائيًا (نفصل القرار للنقطة 4).

## 3) قطع الغيار — تبويب كامل في `products.tsx`

- تبويبان: «منتجات» / «قطع غيار» باستخدام `Tabs`.
- نموذج إضافة قطعة غيار = نفس نموذج المنتج تمامًا (اسم، كود/SKU، كولكشن من JOY/UP/ART/QUATRO، لون من الـ swatches الحالية، كمية، سعر بيع، سعر تكلفة، صورة، ملاحظات) لكن:
  - يحفظ `is_spare_part = true`.
  - `parent_product_id` **اختياري** — Combobox بحث في المنتجات الأصلية للربط (للضمان/الصيانة).
- فلتر «الكل / منتجات / قطع غيار» في `inventory.tsx` و `invoice-builder.tsx` و `delivery-receipt-form.tsx`، مع أيقونة 🔧 مميزة وbadge بنفسجي.
- قطع الغيار **لا تأتي من PO أبدًا** (مفروض في الواجهة فقط، بدون قيد قاعدة بيانات).

## 4) إصلاح المخزون يدويًا (بدون كسر الأرصدة)

لن نُغيّر `create_invoice` / `update_invoice` / `void_invoice` الآن. بدلًا من ذلك:

### أداة «تسوية المخزون» (`/inventory-audit` موجودة بالفعل، سنوسّعها)
- صفحة جديدة `inventory-reconcile.tsx` تعرض لكل منتج:
  - الرصيد الحالي (`stock_quantity`).
  - الرصيد المحسوب من السجلات (intakes + PO receipts − delivery receipts).
  - الفرق.
  - حقل «الرصيد الصحيح حسب الورق» (إدخال يدوي).
  - زر «تعديل» يكتب في `inventory_logs` بسبب `manual-reconcile by <email>` ويحدّث `stock_quantity`.
- استيراد جماعي من CSV/Excel: عمودان (SKU, correct_qty) للمعالجة دفعة واحدة.
- RPC جديدة `manual_reconcile_stock(product_id, new_qty, reason)` تسجّل الفرق وتحدّث الرصيد بأمان (admin فقط).

هذا هو الحل الأدق والأأمن: تترك الفواتير القديمة كما هي، تستورد PO والاستلامات التاريخية، ثم تضبط كل منتج يدويًا من الورق دفعة واحدة.

## نقطة قرار واحدة قبل التنفيذ

**التواريخ القديمة للـ PO**: هل تريد:
- (أ) عمود جديد `shipment_date` منفصل عن `created_at` (يحفظ سجل الإنشاء الفعلي + يسمح بتاريخ شحنة مخصّص للترتيب) ✅ **مُوصى به**
- (ب) تعديل `created_at` مباشرة (أبسط لكن نفقد توقيت الإدخال الحقيقي)

أعتمد (أ) افتراضيًا إن لم تُحدّد.

## الملفات التي ستتغير
- ميغريشن: `shipment_date` + `reassign_shipment_code()` + `record_historical_po_receipt()` + `manual_reconcile_stock()` + grants
- `src/routes/purchase-orders.tsx` — زر/حوار تعديل الشحنة
- `src/components/po-tracker-dialog.tsx` — دفعة تاريخية
- `src/routes/products.tsx` — تبويب قطع الغيار + فلاتر
- `src/routes/inventory.tsx` — فلتر قطع غيار + رابط لصفحة التسوية
- `src/routes/inventory-reconcile.tsx` (جديدة) + رابط في القائمة
- `src/components/invoice-builder.tsx` و `src/components/delivery-receipt-form.tsx` — badge قطع غيار
