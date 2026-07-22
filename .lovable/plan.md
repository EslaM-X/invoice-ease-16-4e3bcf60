## الهدف

ضمان الثقة الكاملة في أرقام النواقص عبر: (1) وضع تدقيق يعرض استجابة الـRPC الخام، (2) صفحة تحقق تقارن `/in-transit` و `/stock-shortages` وتكشف أي اختلاف، (3) زر "إعادة حساب الآن" + طابع زمني لآخر تحديث في الصفحتين.

## الخطوات

### 1) وضع التدقيق داخل `/stock-shortages`
- إضافة Toggle "وضع التدقيق" (Admin/CEO/COO/CFO فقط) أعلى الصفحة.
- عند التفعيل، يظهر داخل كل بطاقة منتج قسم قابل للطي "Raw RPC Data" يعرض JSON الخام لعناصر: `sources`, `incoming_pos`, `coverage`, `needed_qty`, `stock_quantity`, `incoming_qty`, `net_shortage`, `severity`.
- زر "نسخ JSON" لكل صف + زر "تنزيل تقرير كامل (JSON)" لكل النتائج.
- عرض آخر 10 حركات من `inventory_logs` لكل منتج (سحب مباشر من الـDB داخل قسم Expand، بدون منطق تجميع).

### 2) زر "إعادة حساب الآن" + طابع زمني
- في `/stock-shortages` و `/in-transit`: شريط علوي صغير فيه:
  - "آخر تحديث: HH:MM:SS" (وقت اكتمال آخر استدعاء للـRPC).
  - زر "إعادة حساب الآن" ⟳ يعيد استدعاء `get_inventory_shortage_alerts()` + الـRPCs المرافقة فورًا مع Spinner.
- Realtime: الاشتراك الحالي على الجداول يستمر كما هو (تحديث تلقائي)، والزر يوفّر تحديث يدوي فوري.

### 3) صفحة التحقق الداخلي `/inventory-consistency`
- صفحة جديدة (Admin/CEO/COO/CFO) تستدعي **مرة واحدة** الـRPCs التي تغذّي الصفحتين:
  - `get_inventory_shortage_alerts()` (المصدر الموحّد).
  - `get_active_invoice_reservations()`, `get_sold_qty_by_product()`, `get_reserved_qty_by_product()`, `get_delivered_qty_by_product()`.
- تقوم بإعادة تركيب نفس الحسابات التي كانت `/in-transit` تعملها محليًا سابقًا، وتقارنها منتجًا-منتجًا مع نتائج الـRPC الموحّدة.
- تعرض جدول:
  - المنتجات المتّسقة: عدد فقط + Chip أخضر "كل الأرقام متطابقة".
  - المنتجات المختلفة: كل صف يعرض `product`, `field`, `alerts_value`, `computed_value`, `diff`.
- بالإضافة لفحوصات ثابتة:
  - `needed_qty == sum(sources.remaining_qty)` لكل صف.
  - `net_shortage == max(0, needed - stock - incoming)`.
  - أي فاتورة داخل `sources` حالتها `draft/voided/cancelled/archived` أو `delivery_status='delivered'` → خطأ.
- زر "إعادة الفحص" + طابع زمني لآخر فحص.
- رابط للصفحة من `/in-transit` و `/stock-shortages` (زر صغير "فحص الاتساق").

### 4) التحقق النهائي بعد التنفيذ
- تشغيل الصفحة الجديدة والتأكد من: 0 اختلافات، 0 فواتير غير مؤهّلة، `needed_qty` مساوٍ لمجموع `remaining_qty` لكل صف.
- التأكد من أن زر "إعادة حساب الآن" في الصفحتين يحدّث الطابع الزمني فورًا ويعرض نفس الأرقام.

## الملفات المتأثرة

- `src/routes/stock-shortages.tsx` — Toggle تدقيق + JSON خام + inventory_logs + زر إعادة حساب + طابع زمني.
- `src/routes/in-transit.tsx` — زر إعادة حساب + طابع زمني + رابط "فحص الاتساق".
- `src/routes/inventory-consistency.tsx` — صفحة جديدة (تُنشأ الآن).
- `src/lib/nav-catalog.ts` — إضافة الصفحة الجديدة للتنقّل (Admin only).

## النتيجة المتوقعة

- شفافية كاملة: كل رقم في التقرير قابل للتفتيش على مستوى الـRPC الخام.
- ضمان الاتساق تلقائيًا بين الصفحتين، وأي انحراف يظهر فورًا مع تفاصيله.
- تحكم يدوي فوري بالتحديث + رؤية واضحة لعمر البيانات.
