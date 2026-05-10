# نظام محاضر الاستلام (Delivery Receipts)

## الهدف
نظام كامل لإنشاء محاضر استلام مرتبطة بالفواتير، مع إمكانية تسليم جزئي على دفعات، تواقيع، طباعة بنفس هوية الفاتورة (لوجو أسود على خلفية بيضاء)، وتعليم الفاتورة كـ"تم تسليمها بالكامل" تلقائياً.

---

## 1. قاعدة البيانات (Migration)

### جدول `delivery_receipts`
- `id` uuid PK
- `user_id` uuid (مالك السجل، للـ RLS)
- `invoice_id` uuid → invoices(id) (مرتبط بفاتورة)
- `receipt_number` text (مثل `DR-2026-00001`، تسلسل عبر `company_counters`)
- `delivered_to_name` text (اسم المستلم — يُملأ تلقائياً من اسم العميل ويمكن تعديله)
- `delivered_to_phone` text
- `delivered_to_id_number` text (اختياري: رقم بطاقة المستلم)
- `notes` text (ملاحظات عامة على المحضر)
- `signature_customer` text (data URL لتوقيع المستلم — canvas)
- `signature_manager` text (توقيع المدير)
- `signature_accountant` text (توقيع مدير الحسابات)
- `manager_name`, `accountant_name` text
- `status` text default `'draft'` (`draft` | `signed`)
- `delivered_at` timestamptz default now()
- `created_by`, `created_by_email`, `updated_by`, `updated_by_email`
- `created_at`, `updated_at`

### جدول `delivery_receipt_items`
- `id` uuid PK
- `receipt_id` uuid → delivery_receipts(id) ON DELETE CASCADE
- `invoice_item_id` uuid → invoice_items(id) (لربط الكمية المتبقية)
- `product_name`, `serial_number`, `color` text (snapshot)
- `quantity` int (الكمية المسلّمة في هذا المحضر)
- `note` text (ملاحظة على هذا البند، مثل: "نصف الكمية متبقي 5")
- `created_at`

### عمود جديد على `invoices`
- `delivery_status` text default `'pending'` (`pending` | `partial` | `delivered`)
- يتم تحديثه تلقائياً عبر trigger كل ما يتم insert/update/delete على `delivery_receipt_items`:
  - مجموع الكميات المسلمة لكل `invoice_item_id` ≥ كمية الفاتورة → `delivered`
  - 0 < المجموع < المطلوب → `partial`
  - 0 → `pending`

### Functions/RPCs
- `create_delivery_receipt(_invoice_id, _delivered_to_*, _notes, _items jsonb, _signatures jsonb)` → uuid
  - يتحقق أن المستخدم له حق على الفاتورة
  - يتحقق أن مجموع الكميات الجديدة + المسلّم سابقاً ≤ كمية الفاتورة لكل بند
  - يولّد رقم محضر من `company_counters`
- `update_delivery_receipt(_id, ...)` نفس المنطق للتعديل
- `delete_delivery_receipt(_id)` ويعيد حساب `delivery_status`
- `recalc_invoice_delivery_status(_invoice_id)` helper

### RLS
- نفس نمط `invoices` (company_members + can_access_user_data)

---

## 2. واجهة المستخدم

### أ) صفحة قائمة المحاضر `src/routes/delivery-receipts.index.tsx`
- جدول: رقم المحضر | رقم الفاتورة | العميل | تاريخ التسليم | الحالة | إجراءات (عرض/تعديل/حذف/طباعة)
- فلاتر: تاريخ، اسم عميل، حالة، رقم فاتورة
- زر "محضر استلام جديد" يفتح اختيار فاتورة

### ب) صفحة إنشاء/تعديل محضر `src/routes/delivery-receipts.new.tsx` و `delivery-receipts.$id.edit.tsx`
1. **اختيار الفاتورة**: combobox بحث بالفواتير غير الملغاة وغير المسلّمة بالكامل.
2. عند الاختيار: تظهر بنود الفاتورة مع:
   - الكمية الإجمالية في الفاتورة
   - الكمية المسلّمة سابقاً (من محاضر سابقة)
   - **الكمية المتبقية** (max قابل للإدخال)
   - حقل "كمية التسليم الآن" (افتراضياً = المتبقي)
   - حقل **ملاحظة على البند** (مثلاً: "تم تسليم 5 من أصل 10")
   - checkbox لاستبعاد البند من المحضر
3. بيانات المستلم: اسم، هاتف (تُملأ من بيانات العميل)، رقم بطاقة (اختياري).
4. ملاحظات عامة.
5. **التواقيع** (3 لوحات canvas): توقيع المستلم، المدير، مدير الحسابات + اسم كل واحد.
6. أزرار: "حفظ كمسودة" / "حفظ وإنهاء (signed)" / "حفظ وطباعة".

### ج) صفحة عرض/طباعة `src/routes/delivery-receipts.$id.tsx`
- نفس هوية الفاتورة (نسخة مبسّطة من invoice print):
  - **اللوجو بالأسود على خلفية بيضاء** (نفس component اللي في الفاتورة)
  - عنوان كبير: **محضر استلام** + رقم المحضر + رقم الفاتورة المرجعي
  - بيانات الشركة (من settings)
  - بيانات العميل / المستلم
  - جدول البنود المسلَّمة (Code | Name+Color | Quantity | الملاحظة)
  - الملاحظات العامة
  - 3 خانات توقيع في الأسفل (توقيع المستلم / مدير الحسابات / المدير العام)
  - زر طباعة (window.print) مع `@media print` نظيف
  - زر "تعديل" / "محضر جديد لنفس الفاتورة"

### د) ربط في صفحة عرض الفاتورة `src/routes/invoices.$id.tsx`
- شارة (badge) في رأس الفاتورة: `pending` / `partial` / `delivered`
- قسم جديد "محاضر الاستلام" يعرض كل المحاضر المرتبطة بهذه الفاتورة + زر "إنشاء محضر استلام" (يفتح صفحة الإنشاء مع `invoiceId` معبأ).
- في قائمة الفواتير: شارة صغيرة بحالة التسليم.

### هـ) قائمة جانبية
- إضافة لينك "محاضر الاستلام" في `app-shell` التنقل.

---

## 3. الملفات الجديدة/المعدّلة
**جديد:**
- `src/routes/delivery-receipts.index.tsx`
- `src/routes/delivery-receipts.new.tsx`
- `src/routes/delivery-receipts.$id.tsx` (عرض + طباعة)
- `src/routes/delivery-receipts_.$id.edit.tsx`
- `src/components/signature-pad.tsx` (canvas توقيع)
- `src/lib/delivery-receipts.ts` (helpers قاعدة البيانات)

**تعديل:**
- `src/routes/invoices.$id.tsx` — قسم محاضر + شارة حالة + زر إنشاء
- `src/routes/invoices.index.tsx` — شارة حالة التسليم + فلتر اختياري
- `src/components/app-shell.tsx` — لينك القائمة
- `src/lib/i18n.tsx` — الترجمات
- `src/integrations/supabase/types.ts` — يُجدَّد تلقائياً بعد migration

---

## 4. ملاحظات تقنية مهمة
- تواقيع canvas تُحفظ كـ data URL (PNG) في حقول text — لا داعي لـ storage bucket.
- ترقيم المحضر: عدّاد جديد في `company_counters` (نضيف عمود `receipt_dr_seq` أو نستخدم id منفصل `'delivery_receipt'`).
- التحقق من الكمية المتبقية يتم **في RPC على السيرفر** (مش بس client) لمنع التجاوز.
- الـ trigger على `delivery_receipt_items` يحدّث `invoices.delivery_status` تلقائياً → "تعليم الفاتورة كمنتهية" يحصل لوحده.
- الطباعة بنفس CSS print classes الموجودة في الفاتورة (نعيد استخدام `.print-area` واللوجو الأسود).

---

## التنفيذ على مرحلتين
**المرحلة 1**: Migration (قاعدة البيانات + RPCs + trigger + RLS) — يحتاج موافقة.
**المرحلة 2**: كود الواجهة بالكامل بعد تنفيذ migration.

هل تعتمد الخطة لأبدأ بالـ migration؟
