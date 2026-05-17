## الهدف

نظام تتبع لحظي وذكي لمحاضر الاستلام (Delivery Receipts) مع أرشيف للمحاضر المكتملة، يبان لكل حسابات الشركة فورًا.

---

## 1. مراحل التتبع الجديدة (Workflow)

نوسّع `delivery_receipts.status` ليشمل سلسلة مراحل واضحة:

| Status | عربي | متى |
|---|---|---|
| `draft` | مسودة | بعد الإنشاء قبل الإرسال |
| `out_for_delivery` | في الطريق 🚚 | بعد طبع/تسليم للمندوب |
| `signed` | مستلم وموقَّع ✍️ | العميل وقّع |
| `paid` | مغلق ومدفوع ✅ | بعد تسجيل الدفع كاملاً |
| `returned` | راجع ↩️ | المندوب رجع بالبضاعة |
| `cancelled` | ملغي ✖️ | تم إلغاء المحضر |

كل تغيير حالة يتسجل تلقائيًا في timeline (مع الوقت، المستخدم، السبب).

---

## 2. الأرشيف الذكي

- صفحة `/delivery-receipts/archive` تعرض المحاضر بحالات `paid` / `returned` / `cancelled` فقط.
- صفحة `/delivery-receipts` الأساسية تعرض النشطة فقط (`draft` / `out_for_delivery` / `signed`).
- شريط فلتر سريع + بحث برقم المحضر/الفاتورة/العميل/الحالة.
- زرار "نقل للأرشيف" بيظهر تلقائيًا لما الفاتورة المرتبطة `paid_amount >= total` والمحضر `signed`.

---

## 3. التتبع اللحظي (Realtime)

- استخدام Supabase Realtime على `delivery_receipts` و `delivery_receipt_audit_log` — أي تغيير حالة يبان لكل المستخدمين فورًا بدون refresh.
- إشعار داخل التطبيق (`notifications` table) لكل تحرك مهم لرول `manager` و`admin`:
  - "محضر DR-... في الطريق"
  - "محضر DR-... تم توقيعه"
  - "محضر DR-... رجع"

---

## 4. صفحة تفاصيل المحضر — Timeline ذكي

في `/delivery-receipts/$id`:

- **شريط مراحل (stepper)** ملوّن يعرض المرحلة الحالية والمراحل التالية.
- **Timeline تفصيلي** يقرأ من `delivery_receipt_audit_log`:
  - أيقونة + لون لكل حدث (إنشاء، تغيير حالة، تعديل عناصر، توقيع).
  - من قام بالحدث + الإيميل + الوقت بالضبط.
  - الحقول اللي اتغيرت (changed_fields).
- **أزرار إجراءات سياقية**: حسب الحالة الحالية بتظهر الأزرار المسموحة فقط (مثلاً "تأكيد التوقيع" لا تظهر إلا للمحاضر `out_for_delivery`).

---

## 5. التغييرات في قاعدة البيانات

```sql
-- توسيع الحالات المسموحة (CHECK constraint)
ALTER TABLE delivery_receipts
  DROP CONSTRAINT IF EXISTS delivery_receipts_status_check,
  ADD CONSTRAINT delivery_receipts_status_check
  CHECK (status IN ('draft','out_for_delivery','signed','paid','returned','cancelled'));

-- عمود لسبب الإرجاع/الإلغاء
ALTER TABLE delivery_receipts
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- RPC لتغيير الحالة بأمان مع تسجيل في الـ audit
CREATE OR REPLACE FUNCTION change_delivery_receipt_status(
  _receipt_id uuid, _new_status text, _reason text
) RETURNS void ...;

-- Trigger: عند توقيع المحضر + الفاتورة مدفوعة بالكامل → أرشفة تلقائية (paid + archived_at = now())
CREATE TRIGGER tg_auto_archive_dr ...;

-- إضافة الجدولين لـ realtime publication
ALTER PUBLICATION supabase_realtime
  ADD TABLE delivery_receipts, delivery_receipt_audit_log;
```

(الجدول `delivery_receipt_audit_log` موجود بالفعل وبيلتقط كل تعديل عبر trigger `tg_dr_audit` — هنستفيد منه مباشرة في الـ timeline.)

---

## 6. الملفات اللي هتتعدل/تتعمل

- **جديد**: `src/routes/delivery-receipts.archive.tsx` — صفحة الأرشيف.
- **جديد**: `src/components/delivery-receipt-tracker.tsx` — stepper + timeline + أزرار إجراءات.
- **جديد**: `src/lib/delivery-receipts.functions.ts` — server fn `changeReceiptStatus` تستدعي الـ RPC.
- **تعديل**: `src/routes/delivery-receipts.index.tsx` — فلترة النشط فقط + بادچ حالة ملون + زرار "أرشيف".
- **تعديل**: `src/routes/delivery-receipts.$id.tsx` — دمج `<DeliveryReceiptTracker />` أعلى الصفحة.
- **تعديل**: `src/components/app-shell.tsx` (لو فيها لينك جانبي) — إضافة لينك الأرشيف.
- **migration**: التغييرات أعلاه.

---

## 7. الواجهة (UX)

- ألوان واضحة لكل حالة (gray/sky/emerald/amber/rose) باستخدام design tokens.
- Stepper أفقي على الديسكتوب، عمودي على الموبايل.
- Timeline بتصميم zigzag مع خط رأسي وأيقونات Lucide.
- كل تحديث realtime بيظهر toast صغير "محضر DR-... → في الطريق".

---

## التأكيد

موافق على البلان كده وأبدأ التنفيذ؟