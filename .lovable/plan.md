## الهدف
- إزالة قسم "الخصم النهائي" بالكامل من صفحة `/purchase-orders`.
- إنشاء صفحة جديدة `/profit-calculator` (حاسبة الربح) منفصلة، يدخلها CFO + Admin فقط.
- في الصفحة الجديدة: تختار أمر شراء جاهز، تجرب نسبة/قيمة خصم وأسعار بيع، ويظهر صافي الربح للطلبية.
- البيانات تتحدث لحظياً (Realtime) لو أي حد عدّل أمر الشراء أو أسعار المنتجات.

---

## 1. قاعدة البيانات (Migration واحدة)

### جدول جديد `po_profit_scenarios` (سيناريو واحد لكل PO — UNIQUE على `po_id`)
- `id` uuid PK
- `po_id` uuid (UNIQUE) → purchase_orders(id) ON DELETE CASCADE
- `user_id` uuid (نفس مالك الـ PO، للـ RLS عبر `can_access_user_data`)
- `discount_mode` text default `'percent'` (`percent` | `fixed`)
- `discount_value` numeric default 0
- `selling_overrides` jsonb default `'{}'` — `{ [po_item_id]: { unit_sell_price: number } }` لتخصيص سعر البيع لكل بند
- `notes` text
- `updated_by`, `updated_by_email`, `created_at`, `updated_at`

### RLS
- SELECT/INSERT/UPDATE/DELETE: مسموح فقط لـ `is_admin() OR has_role(auth.uid(), 'cfo')` **و** `can_access_user_data(user_id)`.

### إزالة من `purchase_orders` (اختياري — آمن نتركها)
- نسيب الأعمدة `final_discount_mode` / `final_discount_value` / `final_discount_percent` موجودة (عشان البيانات القديمة) بس نوقف استخدامها من الـ UI. هنشيلها من صفحة `purchase-orders` بس.

---

## 2. تعديل صفحة `src/routes/purchase-orders.tsx`
- شيل كل state و UI و logic الخاص بـ `discountMode` / `discountPct` / `discountVal` / `Percent` icon / كروت "Net cost after discount".
- شيل أي حقل `final_discount_*` من payload الحفظ.
- باقي الصفحة (USD, customs, taxes, shipping, EGP totals) يفضل زي ما هو.

---

## 3. صفحة جديدة `src/routes/profit-calculator.tsx`
بنفس روح UI أوامر الشراء (AppShell + شريط جانبي + ستايل نضيف).

### الهيكل
1. **Combobox اختيار أمر الشراء**: قائمة بكل الـ POs (آخر تحديث أولاً) — رقم PO + المورد + التاريخ + الإجمالي EGP.
2. **ملخص PO** (read-only، يتحدث لحظياً):
   - إجمالي USD، سعر الصرف، الجمارك، الضرائب، الشحن، الإجمالي EGP، عدد القطع.
3. **جدول البنود**: لكل بند:
   - الصورة | المنتج | الكود/اللون | الكمية | تكلفة الوحدة EGP (محسوبة من PO) | **سعر البيع المتوقع** (input — يبدأ بسعر `products.price` الحالي وتقدر تعدله) | إجمالي البيع | ربح البند.
4. **شريط الخصم النهائي**:
   - Toggle `%` / `EGP` (نفس النمط القديم).
   - Input للقيمة.
5. **كروت النتيجة**:
   - إجمالي تكلفة PO بعد الخصم (EGP)
   - إجمالي البيع المتوقع (EGP)
   - **صافي الربح** (EGP) + هامش %
6. **حفظ**: زر "حفظ السيناريو" → upsert على `po_profit_scenarios` بـ `po_id`. عند فتح نفس الـ PO تاني تلاقي قيمك محفوظة.
7. **ملاحظات**: textarea للـ CFO.

### Realtime
- اشتراك Supabase channel على:
  - `purchase_orders` (UPDATE للـ po_id الحالي) — يعيد جلب الـ PO فوراً.
  - `purchase_order_items` (أي تغيير على البنود).
  - `products` (للحصول على آخر سعر بيع).
  - `po_profit_scenarios` (لو CFO تاني عدّل من جهاز تاني).

### الصلاحيات
- في أعلى الصفحة: لو `!isCFO && !isAdmin` → Redirect لـ `/` + toast "غير مصرح".
- في الـ AppShell sidebar: link "حاسبة الربح" يظهر فقط لـ `isCFO || isAdmin`.

---

## 4. تعديلات إضافية
- `src/components/app-shell.tsx`: إضافة عنصر قائمة جديد "حاسبة الربح" (icon: `Calculator` من lucide) داخل الـ sidebar محصور بـ `isCFO || isAdmin`.
- `src/routeTree.gen.ts`: يتحدث تلقائياً.
- `src/integrations/supabase/types.ts`: يتحدث بعد الـ migration.

---

## الملفات
**جديدة:**
- `src/routes/profit-calculator.tsx`
- migration واحدة لجدول `po_profit_scenarios` + RLS

**تعديل:**
- `src/routes/purchase-orders.tsx` (إزالة الخصم النهائي)
- `src/components/app-shell.tsx` (لينك في القائمة)

---

## ملاحظة مهمة
بما اخترت "سيناريو واحد فقط (يتحدث)": كل مرة CFO يعدّل ويحفظ → الـ row القديم يتحدث (UPSERT). مش هنخزن سجل تاريخي. لو حبيت بعدين تشوف التاريخ نقدر نضيف جدول log منفصل.

موافق أبدأ بالـ migration؟