
## الهدف
اقدر أعمل/أعدّل أي فاتورة حتى لو الكمية أكبر من المخزون + الشحنات القادمة، والنظام يفتكر كل نقص ويجمّعه في لوحة "نواقص المخزون" بكل تفاصيل المنتج والفواتير المرتبطة.

## 1) قاعدة البيانات
- تعديل RPC `create_invoice` و `update_invoice`:
  - إزالة استثناء `OUT_OF_STOCK` نهائياً.
  - نفس منطق التغطية الحالي: أولاً من المخزون الفعلي، ثم من `purchase_order_items` القادمة (حجز في `invoice_po_reservations` بحالة `active`).
  - أي كمية باقية (uncovered) تُسجَّل في نفس جدول `invoice_po_reservations` مع `po_item_id = NULL` وحالة جديدة `needs_order` وحقل `quantity` = العجز الحقيقي. → يعني عمود `po_item_id` يصير nullable + توسيع CHECK للحالة.
  - في `update_invoice` نفس المعالجة عند زيادة الكمية، وعند تقليلها نُحرّر أول من صف `needs_order` قبل الحجوزات النشطة.
- إضافة view/RPC `get_stock_shortages()` يرجع لكل منتج:
  - `product_id`, name, serial, color, collection, image_url, current stock, incoming qty, total needed, net shortage
  - Array من الفواتير المرتبطة (invoice_number, customer_name, qty, created_at, status)
- Migration بيعمل backfill لأي فاتورة قديمة عندها بنود ناقصة بدون حجز.

## 2) واجهة إنشاء/تعديل الفاتورة (`src/components/invoice-builder.tsx`)
- شيل الـ cap على input الكمية (السطر ~1193-1204) لكل الفواتير (مش بس draft).
- شيل التحقق الحالي في `save()` اللي بيعرض confirm عن الحجز من القادم، واستبدله بـ:
  - Badge أحمر تحت كل بند: "⚠ نقص: X — سيُطلب" لو الكمية > (stock + incoming − reservations).
  - Sticky banner فوق الفاتورة يقول: "هذه الفاتورة بها N قطعة نقص إجمالي — سيتم إدراجها في نواقص المخزون".
  - Confirm واحد قبل الحفظ يوضح كل الأصناف الناقصة والكميات المطلوب طلبها.

## 3) صفحة جديدة: نواقص المخزون
- Route: `src/routes/stock-shortages.tsx` بمسار `/stock-shortages`.
- Link في القائمة الجانبية + Badge على أيقونتها بعدد الأصناف الناقصة (realtime).
- Cards فاخرة (Noir & Gold) لكل منتج ناقص:
  - صورة المنتج + اسم + سيريال + لون (swatch) + كولكشن + spare-part badge
  - رقم كبير: "محتاج تطلب: 10 قطع" مع breakdown: `المخزون: 5 | القادم: 3 | العجز الصافي: 2`
  - قائمة قابلة للطي: كل فاتورة محتاجة القطعة (رقم الفاتورة، العميل، الكمية، التاريخ) — clickable
  - زر "إضافة إلى أمر شراء" يفتح `restock-order-dialog` مع pre-fill بالمنتج والكمية المطلوبة
- فلاتر: كولكشن / بحث بالاسم أو السيريال / ترتيب حسب أعلى نقص أو أقدم فاتورة.
- Realtime updates عبر Supabase channel على `invoice_po_reservations` و `products`.

## 4) الداشبورد
- KPI card جديد "نواقص المخزون" في `src/routes/dashboard.tsx` بعدد الأصناف + الكميات + link للصفحة الجديدة.

## تفاصيل تقنية
- الحفاظ على منطق `fulfill_reservations_on_po_received` بحيث ما يلمسش صفوف `needs_order` (لأنها بدون po_item_id) — لكن عند تأكيد PO جديد لنفس المنتج، ننقل صفوف `needs_order` إلى `active` مربوطة بالـ PO الجديد حسب أولوية أقدم فاتورة → داخل trigger `after po status = ordered/shipped`.
- كل تغيير في المخزون/الحجوزات ينشر realtime notification فوري بحيث لوحة النواقص تتحدث لحظياً حتى مع 1000+ فاتورة.
- Indexes: `(product_id, status)` على `invoice_po_reservations` موجود؛ نضيف partial index على `status='needs_order'`.

## الملفات المتأثرة
- Migration جديدة (RPCs + reservations schema + view + backfill)
- `src/components/invoice-builder.tsx`
- `src/routes/stock-shortages.tsx` (جديد)
- `src/router.tsx` + navigation menu
- `src/routes/dashboard.tsx` (KPI)
- `src/lib/data.ts` (helper types)
