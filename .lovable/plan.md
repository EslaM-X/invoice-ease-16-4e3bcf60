## الهدف

في محاضر الاستلام الجديدة فقط (layout_version ≥ 2) — كل شيء يظهر في العرض على الشاشة و PDF/الطباعة:

### 1) عرض "الباقي" الذكي لكل بند
- جمب كل بند تظهر شارة صغيرة بجانب الكمية مكتوب فيها:
  - **"فاضل: N"** لو لسه في كميات متسلمتش (سواء من هذا المحضر أو مسبقًا).
  - **"مكتمل ✓"** لو البند اتسلّم بالكامل (this + prior + later = invoice_qty).
- في عمود الملاحظة سطر ذكي مختصر: "من أصل X — سُلِّم الآن: A، مسبقًا: B، لاحقًا: C، الباقي: R".

### 2) تفصيل الأجزاء (Mixer / Trim / Full) لأي منتج متعدد الأجزاء
لكل بند من نوع multi-part (mixer / concealed / free-standing / shower … كما هو معرّف في `product-parts.ts`) نعرض جدول صغير تحت اسم المنتج يوضح — بالتجميع من كل محاضر الفاتورة:
- المنتج كامل (Full): سُلِّم X
- الخلاط الدفن (MIXER): سُلِّم Y
- الجزء الظاهر (Trim): سُلِّم Z
- **الباقي**: mixer ناقص = invoice_qty − (Full + Mixer)، trim ناقص = invoice_qty − (Full + Trim).
- في المحضر الحالي: يوضّح كل جزء اتسلّم فيه كام (5 mixer + 2 trim + 1 full = 8 قطع).

المثال الي المستخدم كتبه (5 mixer، 2 trim، 1 full، الفاتورة 8) يظهر كـ:
- الآن: Mixer 5 • Trim 2 • Full 1
- الإجمالي المسلم: mixers=6/8، trims=3/8
- الباقي: mixer 2 • trim 5

### 3) ميزة الضرائب 14% (اختيارية لكل محضر)
- في فورم إنشاء / تعديل المحضر: توجل "تطبيق ضريبة 14%" (افتراضي: مطفي).
- لو مفعّل:
  - يظهر أسفل جدول البنود (فوق التوقيعات) صف واضح:
    - المجموع الفرعي (سعر الوحدة × الكمية المسلمة الآن) لكل بند من الفاتورة + رسوم الشحن.
    - ضريبة القيمة المضافة 14%.
    - الإجمالي شامل الضريبة.
- لو مطفي: لا يظهر أي صف ضريبي إطلاقًا (زي دلوقتي بالظبط).
- المحاضر القديمة (v1) ما تتأثرش.

## القسم التقني

### Migration جديدة
```sql
ALTER TABLE public.delivery_receipts
  ADD COLUMN IF NOT EXISTS tax_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) NOT NULL DEFAULT 14.00;
```
لا تغيير في RLS/GRANT. RPC `create_delivery_receipt` و `update_delivery_receipt` تتحدّث لقبول `_tax_enabled boolean DEFAULT false` (الافتراضي يخلي المحاضر القديمة من الكود القديم شغالة).

### `src/lib/delivery-receipts.ts`
- إضافة `tax_enabled?: boolean` لـ `DRPayload` وتمريره في `createDeliveryReceipt` / `updateDeliveryReceipt`.
- توسيع `PrintRow` بحقول: `unit_price`, `part_totals: { full_this, mixer_this, trim_this, full_all, mixer_all, trim_all }` — يتم استخراجها من parsing لـ `note` (باستخدام `parsePartFromNote`) عبر كل محاضر الفاتورة (نفس الاستعلام الحالي، نضيف حساب per-part).
- إرجاع `unit_price` من `invoice_items.unit_price`.

### `src/components/delivery-receipt-form.tsx` (mode="new" و "edit")
- إضافة Switch "تطبيق ضريبة 14%" جنب حقل رسوم الشحن.
- تمرير `tax_enabled` في submit.
- (بدون تغيير في منطق الأجزاء الحالي.)

### `src/routes/delivery-receipts.$id.tsx` (العرض + PDF، v2 فقط)
- بجانب رقم الكمية في الخلية: badge صغيرة "فاضل N" أو "مكتمل".
- ملاحظة موسّعة: "من أصل X — الآن A، مسبقًا B، لاحقًا C، الباقي R".
- لو `isMultiPartProduct(product_name)`: قسم مصغّر تحت اسم المنتج بشبكة 3 أعمدة (Full/Mixer/Trim) يعرض الأرقام الحالية والإجمالية والباقي، بتصميم أنيق (borders رفيعة، أرقام واضحة، ألوان محايدة تطبع كويس على الأبيض).
- لو `r.tax_enabled`: بعد جدول البنود يظهر بلوك ملخّص مالي:
  - Subtotal = Σ(this_qty × unit_price) + shipping
  - VAT 14% = Subtotal × 0.14
  - Total = Subtotal + VAT
  - يظهر بأرقام واضحة، RTL/LTR حسب اللغة، بخطوط hairline ذهبية على الشاشة و بسيط أبيض/أسود عند الطباعة.

### توافق رجعي
- المحاضر القديمة (v1) تفضل كما هي — لا `tax_enabled` badge ولا part-breakdown، نفس العرض بالضبط.
- المحاضر v2 الحالية بدون tax تفضل شغالة (default false).

## Deliverables
1. Migration: إضافة `tax_enabled` + `tax_rate` وتحديث RPCات create/update.
2. تحديث `src/lib/delivery-receipts.ts` (payload + PrintRow موسّع + unit_price + part aggregates).
3. تحديث `src/components/delivery-receipt-form.tsx` (Switch للضريبة).
4. تحديث `src/routes/delivery-receipts.$id.tsx` (شارات الباقي + جدول الأجزاء + بلوك الضريبة).
