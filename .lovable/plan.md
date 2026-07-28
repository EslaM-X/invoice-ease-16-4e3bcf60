# Phase 2 — Reservation Engine (خطوات ثابتة ودقيقة)

الهدف: فصل "الحجز" عن "الخصم الفعلي" من المخزون. عند إنشاء الفاتورة يتم **حجز** الكمية (بدون خصم فعلي)، ولا يتم الخصم إلا عند **توقيع محضر الاستلام**. عند إلغاء المحضر أو الفاتورة يرجع الحجز/الخصم تلقائياً.

---

## المفاهيم الأساسية (State Model)

لكل بند فاتورة (`invoice_items`) نتتبع 3 كميات:
- `quantity` — الكمية المطلوبة
- `reserved_qty` — كمية محجوزة (بدون خصم فعلي)
- `delivered_qty` — كمية مُسلَّمة فعلياً (خُصمت من المخزون)

لكل منتج (`products`) نضيف عمود محسوب/مادي:
- `stock_quantity` — الرصيد الفعلي (كما هو)
- `reserved_quantity` — إجمالي المحجوز عبر الفواتير النشطة
- `available_quantity = stock_quantity - reserved_quantity` (المتاح للبيع)

---

## الخطوات (بالترتيب — كل خطوة تُنفَّذ وتُختبر قبل التالية)

### 1) Schema Migration
- إضافة `reserved_qty INT DEFAULT 0` و `delivered_qty INT DEFAULT 0` على `invoice_items`.
- إضافة `reserved_quantity INT DEFAULT 0` على `products`.
- Backfill: احسب القيم الحالية من البيانات القائمة (المحاضر الموقعة → delivered_qty، الباقي في الفواتير النشطة → reserved_qty).
- تريجر يحدّث `products.reserved_quantity` عند أي تغيير في `invoice_items.reserved_qty`.

### 2) Reservation RPC
- `reserve_invoice_items(invoice_id)` — يستدعى عند إنشاء/تفعيل الفاتورة، يضع `reserved_qty = quantity`.
- إذا لم يكفِ المتاح (`stock - reserved < needed`): يحجز المتاح فقط ويُدرج الباقي في `shortage_requests` تلقائياً.
- `release_invoice_reservation(invoice_id)` — عند الإلغاء/الحذف/المسودة، يُصفّر `reserved_qty`.

### 3) Delivery ↔ Stock Deduction
- عند توقيع محضر استلام (`delivery_receipts.status = 'signed'`):
  - لكل بند مُسلَّم: `delivered_qty += signed_qty` و `reserved_qty -= signed_qty`.
  - خصم فعلي من `products.stock_quantity` (+ `inventory_logs`).
- عند إلغاء المحضر: العملية العكسية بالكامل (إرجاع للمخزون + رجوع للحجز).

### 4) استبدال منطق الخصم الحالي
- إزالة أي خصم مباشر من `stock_quantity` عند إنشاء الفاتورة في `invoice-builder.tsx` و`create_invoice` RPC.
- الاعتماد على reservation فقط أثناء البيع، والخصم الفعلي فقط عبر المحاضر.

### 5) UI Updates
- `stock-tracker`: يعرض 3 أرقام (المخزن / المحجوز / المتاح).
- `invoice-builder`: يتحقق من `available_quantity` (وليس `stock_quantity`) قبل السماح بالإضافة.
- `product-card` وصفحة المخزون: عمود "متاح" الجديد.

### 6) Data Migration (One-Time)
- تشغيل backfill script لكل الفواتير غير المؤرشفة:
  - `reserved_qty = quantity - delivered_qty`
  - `products.reserved_quantity = SUM(reserved_qty)` لكل فاتورة نشطة.
- تصحيح أي فروق ناتجة عن الخصومات القديمة.

### 7) الاختبارات والتحقق
- **Case A**: فاتورة جديدة بمنتج متوفر → المخزون لا يتغير، `reserved` يزيد، `available` ينقص.
- **Case B**: محضر استلام موقّع → `stock` ينقص، `reserved` ينقص، `delivered` يزيد.
- **Case C**: إلغاء محضر → `stock` يرجع، `reserved` يرجع.
- **Case D**: إلغاء فاتورة → `reserved` يُصفَّر.
- **Case E**: طلب أكبر من المتاح → حجز المتاح + إدراج تلقائي في `shortage_requests`.
- **Case F**: الفاتورة #168 (السابقة) — تُصلَّح تلقائياً بعد Backfill.

---

## التنفيذ

سأنفّذ الخطوات على شكل **3 موجات (migrations)** يتخللها انتظار موافقتك بعد كل موجة:

**Wave 1 (Schema + Backfill)**: خطوات 1 و 6 معاً — تُنشئ الأعمدة، التريجرات، وتملأ البيانات القديمة. **بدون تغيير في السلوك حتى الآن.**

**Wave 2 (RPCs + Delivery Hooks)**: خطوات 2 و 3 — تنشئ الدوال الجديدة وتربطها بمحاضر الاستلام.

**Wave 3 (Switch-Over + UI)**: خطوات 4 و 5 — إزالة الخصم القديم وتفعيل النظام الجديد على الواجهة.

بعد كل موجة سأعرض عليك نتائج الفحص (Case A–F) قبل الانتقال للتي بعدها.

---

## Technical Notes
- كل التغييرات إضافية أولاً (backward-compatible) لتجنّب أي كسر في البيانات الحيّة.
- التريجرات ستستخدم `security definer` للحفاظ على RLS.
- سيتم توثيق كل عملية في `inventory_logs` بمصدر واضح (`reservation` / `delivery_deduction` / `receipt_cancellation`).
- Rollback plan: كل موجة قابلة للتراجع عبر migration عكسي، والبيانات القديمة تُحفظ سليمة حتى بعد Wave 3.

هل أبدأ بـ **Wave 1** الآن؟
