
# خطة شاملة: شحنات مميزة + حجز ذكي + قطع غيار

## 1) أنواع الشحنات وترقيم ذكي للـ PO والدفعات

### تعديلات قاعدة البيانات
- `purchase_orders`: إضافة عمودين
  - `shipment_type` text NOT NULL DEFAULT 'grounded' — قيم: `grounded` (بحري - G - أحمر/كهرماني)، `air` (طيران - A - أزرق سماوي)، `door_to_door` (D - بنفسجي).
  - `shipment_code` text — كود تسلسلي للعرض، مثل `G1`, `A3`, `D2`. يتولّد عبر تريغر `BEFORE INSERT` يقرأ من جدول عدّاد جديد `shipment_counters(user_id, shipment_type, last_seq)` ويزيد `last_seq` لكل نوع على حدة. (يبقى `po_number` كما هو للأرشيف).
- `po_receipts`: إضافة `receipt_code` text محسوب تلقائياً = `<shipment_code>#<receipt_number>` (مثلاً `G1#1`, `G1#2`)، يتولّد في تريغر `BEFORE INSERT` بعد قراءة `shipment_code` من الـ PO الأم.
- Migration لتعبئة `shipment_type='grounded'` و توليد `shipment_code` للسجلات القديمة بترتيب `created_at`، ثم توليد `receipt_code` للمحاضر الحالية.

### واجهة المستخدم
- **عند إنشاء PO** (`src/routes/purchase-orders.tsx`): اختيار نوع الشحنة من ٣ بطاقات ملوّنة كبيرة (G/A/D) مع وصف عربي + أيقونة (سفينة/طائرة/شاحنة). الكود يظهر فوراً بعد الحفظ.
- **عرض الـ PO**: شارة لونية واضحة بنوع الشحنة بجانب `shipment_code` ضخم، و `po_number` صغير كمرجع.
- **محضر استلام جديد** (`po-tracker-dialog.tsx` → استلام جزئي): يفتح حواراً يعرض الأصناف المتبقية فقط مع الكميات (مع `max = ordered − received_so_far`)، أزرار `استلم الكل` / `استلم المحدد`. عند الحفظ يُولَّد `receipt_code` تلقائياً ويُحسب المتبقي ويُحدّث `status` تلقائياً (`partial` ↔ `received`).
- **تاريخ الاستلام**: في `POTrackerDialog` تبويب جديد «دفعات الاستلام» يعرض كل المحاضر بـ `receipt_code` ملوّن، تواريخها، من استلم، الكميات، والفرق بين المطلوب والمستلم لكل صنف.

## 2) الشحنات القادمة في لوحة التحكم
- مكوّن `incoming-shipments-strip.tsx` يتحدّث ليعرض ٣ مجموعات أفقية مفصولة لونياً بحسب `shipment_type`، تحت كل مجموعة: عدد الـ POs، الكمية المتبقية للاستلام، ETA لكل واحد، وشريط تقدّم استلام (received_qty/total_qty).
- بطاقة قابلة للنقر تفتح `POTrackerDialog` مباشرة.

## 3) إصلاح منطق المخزون: حجز عند الفاتورة، خصم عند التسليم

**المشكلة الحالية**: `create_invoice` يخصم `stock_quantity` فوراً، فيختفي الصنف من المخزون قبل التسليم الفعلي.

**الإصلاح**:
- تعديل `create_invoice` و `update_invoice` و `cancel_invoice` و `restore_invoice`: لا تلمس `stock_quantity` على الإطلاق. بدلاً منه تكتب في `invoice_po_reservations` كحجز (حالة `reserved`).
- إنشاء تريغر على `delivery_receipt_items`: عند إضافة سطر، يخصم الكمية من `stock_quantity` للمنتج (مع لوج في `inventory_logs`)، ويحدّث الحجز إلى `fulfilled`. عند حذف/إلغاء محضر يُعاد المخزون.
- دالة `get_available_stock(product_id)` = `stock_quantity − SUM(reservations حيث status='reserved')`. تستخدم في كل واجهة (بحث المنتجات، باني الفاتورة، صفحة المخزون).
- صفحة `inventory` و `in-transit`: عمود جديد «متاح للبيع» = الفعلي − المحجوز، مع badge «محجوز في N فاتورة» قابلة للنقر.

### تنبيهات وحجز ذكي في باني الفاتورة (`invoice-builder.tsx`)
- عند اختيار منتج:
  - إذا `available > 0`: علامة خضراء «متاح».
  - إذا `available == 0` و في شحنة قادمة: علامة كهرمانية «سيتوفر من شحنة `G2` المتوقعة 2026-07-10 — حجز مسبق» مع زر **حجز من الشحنة**.
  - إذا لا مخزون ولا شحنة: بطاقة حمراء «غير متوفر — أنشئ أمر شراء؟» مع زر يفتح `purchase-orders.tsx` بنموذج مُعبّأ مسبقاً (المنتج + الكمية).
- منع إضافة كمية تتجاوز `available + incoming`، مع رسالة دقيقة توضّح الفرق.
- جرس تنبيه `reservation-alerts-bell.tsx` يعرض الفواتير التي حجزت آخر القطع.

## 4) قطع الغيار / القطع المنفصلة (Spare Parts)

### قاعدة البيانات
- `products`: إضافة `is_spare_part` boolean DEFAULT false، و `parent_product_id` uuid NULL (للربط الاختياري بالمنتج الرئيسي مثل ربط HANDLE بكولكشن JOY).
- لا تأتي قطع الغيار من PO نهائياً (يُفرض في الواجهة)؛ تُضاف يدوياً فقط لضمان تتبّع الضمان.

### واجهة المستخدم
- صفحة `products.tsx`: تبويب جديد «قطع غيار» بجانب «منتجات». نموذج إضافة فيه: الاسم، الكود/SKU، الكولكشن، اللون، الكمية، السعر، صورة، ملاحظات. يدعم بالكامل الكولكشنات الحالية والألوان.
- في `invoice-builder.tsx`: تصنيف منفصل في نتائج البحث «قطع غيار» بأيقونة مفتاح ربط ولون مختلف.
- في `delivery-receipt-form.tsx`: تظهر قطع الغيار ضمن أصناف الفاتورة بشكل طبيعي مع badge مميز.
- في `inventory.tsx`: فلتر `الكل / منتجات / قطع غيار` وأيقونة مميزة لكل بند.

## 5) العرض البصري المميز

ثلاثة tokens لونية جديدة في `src/styles.css`:
- `--shipment-grounded` (كهرماني/برتقالي بحري)
- `--shipment-air` (أزرق سماوي)
- `--shipment-door` (بنفسجي)

كل من: قائمة PO، Tracker، شريط الشحنات القادمة، شارات الفواتير المرتبطة بـ PO — تستخدم اللون والأيقونة المناسبة. حركات framer-motion خفيفة عند فتح Tracker واحترام `prefers-reduced-motion`.

## 6) تأثير على المشتريات والربح وحاسبة الربح والسيناريوهات
- `profit-calculator.tsx` و `profit-scenarios.tsx`: عرض `shipment_code` بدل (أو إلى جانب) `po_number` ليكون التمييز فورياً، وفلتر حسب نوع الشحنة. لا تغيير في صيغ الحساب.
- صفحة `po-tracking.tsx`: فلاتر إضافية حسب نوع الشحنة، عمود `shipment_code` بارز، تجميع بصري (G ثم A ثم D).

## تفاصيل تقنية

### الملفات التي ستتغير
- ميغريشن جديدة: أعمدة + عدّادات + تريغرات + تعديل الدوال (`create_invoice`, `update_invoice`, `cancel_invoice`, `restore_invoice`, `create_delivery_receipt`, `update_delivery_receipt`, إضافة `get_available_stock`).
- `src/routes/purchase-orders.tsx`: مُنتقي نوع الشحنة، عرض الكود.
- `src/routes/po-tracking.tsx`: فلاتر/ألوان، عمود الكود.
- `src/routes/in-transit.tsx` + `src/routes/inventory.tsx`: عمود متاح/محجوز، فلتر قطع غيار.
- `src/routes/products.tsx`: تبويب قطع الغيار.
- `src/components/po-tracker-dialog.tsx`: تبويب الدفعات، حوار استلام جزئي بالكميات.
- `src/components/incoming-shipments-strip.tsx`: تقسيم بحسب النوع.
- `src/components/invoice-builder.tsx`: حالات «متاح/قادم/غير متوفر» وزر إنشاء PO، حجز من الشحنة.
- `src/components/delivery-receipt-form.tsx`: تأكيد أنه هو من يخصم المخزون.
- `src/styles.css`: ٣ tokens لونية + variants.

### اعتبارات التوافق
- Migration لتوليد أكواد للسجلات القديمة قبل فرض `NOT NULL` على `shipment_code` / `receipt_code`.
- اختبار idempotency للتريغرات (محضر يُعاد حفظه لا يخصم مرتين).
- الحفاظ على القواعد الأمنية الحالية (RLS و SECURITY DEFINER).

## نقطة توضيح واحدة قبل التنفيذ
هل توافق أن الفواتير القديمة (قبل التحديث) تبقى «خصمت بالفعل من المخزون» — أم تريد ميغريشن يُعيد حساب المخزون من الصفر بناءً على محاضر الاستلام فقط؟ الخيار الثاني أنظف لكنه يُعدّل أرصدة قائمة.
