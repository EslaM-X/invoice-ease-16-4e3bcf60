## المشكلة
صفحة "متتبع المخزون" الموجودة على المسار `/inventory-traceability` (اللي فيها تبويب "مستويات المخزون / Stock Levels") **مش موجودة أصلاً في القائمة الجانبية**، فمافيش طريقة تدخلها إلا لو تكتب الرابط يدوي. عشان كده مش لاقيها.

## الحل

### 1) إضافة رابط دائم في القائمة الجانبية (Sidebar)
في `src/components/app-shell.tsx` تحت مجموعة "المخزون" (`inventory_group`)، أضف عنصر جديد بعد `/inventory`:

```
{ to: "/inventory-traceability", icon: Boxes, key: "inventory_traceability" }
```

وأضف مفتاح الترجمة في `src/lib/i18n.tsx`:
- `inventory_traceability: "متتبع المخزون ومستويات"`

كده هيظهر بند ثابت في السايدبار (ديسكتوب + الشيت على الموبايل) تحت قسم المخزون مباشرة.

### 2) فتح تبويب "مستويات المخزون" مباشرة برابط
تعديل `src/routes/inventory-traceability.tsx`:
- إضافة `validateSearch` يقرأ `?tab=stock|lines|per-product|validate|timeline`.
- تمرير القيمة إلى `<Tabs defaultValue={...}>` أو `value` مع `onValueChange` يحدث الـ URL.

يبقى الرابط المختصر: `/inventory-traceability?tab=stock` يفتح تبويب المستويات فورًا.

### 3) اختصار سريع من صفحات المخزون الأخرى
إضافة زر صغير "مستويات المخزون" (Link إلى `/inventory-traceability?tab=stock`) في:
- شريط العنوان أعلى `src/routes/inventory.tsx` (لو موجودة)، أو
- كارت "تنبيهات المخزون المنخفض" `src/components/low-stock-alerts.tsx` كزر "عرض كل المستويات".

كده الوصول يبقى من 3 أماكن: السايدبار الدائم، الرابط المباشر بالـ query، وزر مختصر من صفحة المخزون.

## شرح للمستخدم بعد التنفيذ
- **ديسكتوب:** افتح القائمة الجانبية → قسم **المخزون** → اضغط **متتبع المخزون ومستويات** → اختر تبويب **مستويات المخزون** (له شارة NEW ذهبية).
- **موبايل:** من أسفل يمين اضغط **⋯** → القائمة → قسم المخزون → **متتبع المخزون ومستويات**.
- **أسرع طريق:** افتح الرابط مباشرة `/inventory-traceability?tab=stock`.

## ملفات هتتعدل
- `src/components/app-shell.tsx` — إضافة بند السايدبار.
- `src/lib/i18n.tsx` — مفتاح ترجمة جديد.
- `src/routes/inventory-traceability.tsx` — قراءة `?tab=` من الـ URL وتفعيله كافتراضي.
- (اختياري) `src/components/low-stock-alerts.tsx` — زر مختصر.
