
## المشكلة الفعلية (بعد فحص القاعدة والدوال)

الأرقام في **متتبع المخزون** و**تسوية المخزون من الورق** بتيجي من 3 دوال (`get_sold_qty_by_product`, `get_delivered_qty_by_product`, `get_reserved_qty_by_product`) بالإضافة لدالة `rebuild_inventory_from_source_of_truth`. الفحص كشف تعارضين حقيقيين يفسّرون الأعطال اللي بتشوفها:

**١) "تم تسليمه" أكبر من "تم بيعه"** (مستحيل منطقيًا، وظاهر في السكرين شوت — مثال `STM-50-F800-009` سولد 16 / ديليفرد 19):
- `get_sold_qty_by_product` بيستبعد الفواتير `draft/voided/cancelled`.
- `get_delivered_qty_by_product` بيستبعد فقط محضر التسليم الملغي، **ومش بيستبعد** محاضر التسليم المرتبطة بفواتير `voided/cancelled/draft`. النتيجة: بند اتسلّم ثم الفاتورة اتلغت أو رجعت درافت → بيتحسب "متسلّم" بس مش "متباع".
- كمان `sold` بيستخدم `can_access_user_data(i.user_id)` و `delivered` بيستخدم `can_access_user_data(dr.user_id)` — لو الفاتورة لموزّع ومحضر التسليم مسجّل باسم أدمن (أو العكس)، هيبان فرق.

**٢) "قادم في الطريق / في المخزن" بيظهر 0 لأصناف موجودة فعلاً**:
- الرقم "في المخزن" في المتتبع بيتقرا من `products.stock_quantity` بعد ما زر **"إعادة بناء المخزون من المصادر الحقيقية"** صفّر كل حاجة وبناها من `po_receipt_items − delivery_receipt_items`.
- كل الـ POs الحالية عندها receipt lines (اتأكدت)، لكن الرصيد النهائي = مستلم − متسلَّم. أي انحراف في دالة "delivered" (نفس مشكلة #١) بيخلي منتجات ترصيدها الحقيقي موجب لكن الرصيد المخزّن = 0 (لأن الـ GREATEST(...,0) بيقصّها).
- كمان لو محضر تسليم مرتبط بفاتورة `voided` — إعادة البناء بتخصمه من المخزون بالغلط ونتيجة المنتج تنزل صفر رغم إنه موجود على الرف.

**٣) الـ Path B في `get_delivered_qty_by_product`** (المطابقة عبر `product_name` داخل نفس الفاتورة) بتشتغل حتى لو الفاتورة `voided` — نفس الجذر بيتكرر.

## الخطة (SQL فقط — بدون أي تعديل على الفواتير أو محاضر التسليم كسجلات)

### 1. توحيد فلتر حالة الفاتورة عبر كل الدوال
تعديل الدوال دي لتستبعد الفواتير `draft/voided/cancelled` من حساب "المُسلَّم"، بحيث `delivered ≤ sold` دايمًا:

- `get_delivered_qty_by_product`: إضافة `JOIN invoices i ON i.id = dr.invoice_id` وشرط `COALESCE(i.status,'') NOT IN ('draft','voided','cancelled')` قبل حساب Path A و Path B.
- `rebuild_inventory_from_source_of_truth`: نفس الفلتر داخل CTE `delivered_linked` و `delivered_orphan`، بحيث محاضر التسليم لفواتير ملغاة/مسودّة **مش بتخصم** من المخزون.
- توحيد `can_access_user_data` بحيث كلاهما يستخدم `i.user_id` (بدل `dr.user_id` في delivered) عشان الأرقام تكون متسقة لنفس المستخدم.

### 2. دالة تشخيصية جديدة `inventory_discrepancy_report()`
ترجع لكل منتج: `received`, `delivered_counted`, `delivered_excluded_by_invoice_status`, `sold`, `stock_quantity_now`, `expected_stock`, `delta`. تُستخدم داخل صفحة "تسوية المخزون من الورق" لتوضّح بالظبط منين جه كل رقم قبل أي إعادة بناء.

### 3. إعادة تشغيل `rebuild_inventory_from_source_of_truth` بعد الإصلاح
بعد اعتماد التعديلات أعلاه — تشغيل الدالة مرة واحدة يعيد ضبط `products.stock_quantity` على القيمة الصحيحة (مستلم − متسلَّم-من-فواتير-فعّالة). المنتجات اللي بتظهر 0 وهي موجودة هترجع لرصيدها الحقيقي تلقائيًا.

### 4. لا تغيير في:
- بيانات الفواتير، `invoice_items`، `delivery_receipts`، `delivery_receipt_items`، `purchase_orders`، `po_receipt_items` — كلها تبقى كما هي كسجلات.
- الواجهة (`in-transit.tsx` / `inventory-reconcile.tsx`) — بس هتبدأ تعرض أرقام صحيحة تلقائيًا؛ ممكن إضافة زر "عرض التقرير التشخيصي" لاحقًا لو حبيت.

## تفاصيل تقنية (مرجع)

```text
delivered_counted(product) =
  Σ dri.quantity  WHERE dr.status ≠ 'cancelled'
                    AND invoice.status NOT IN (draft, voided, cancelled)
                    AND ii.product_id IS NOT NULL         -- Path A
              +  Path B (same invoice-status filter)
              +  orphan-by-serial (unchanged; no invoice link exists)

expected_stock(product) = Σ po_receipt_items.quantity − delivered_counted
                          (clamped ≥ 0)
```

كل التغييرات في migration واحدة `CREATE OR REPLACE FUNCTION`؛ لا DROP TABLE ولا حذف صفوف.
