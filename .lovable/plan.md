# خطة العمل: Realtime كامل + Offline PWA

غيرت بالفعل **حاسبة الربح** عشان تفتح بـ "السعر الحالي" افتراضياً (مع إمكانية الرجوع لسعر الـ PO من الـ toggle).

الباقي (offline + sync لحظي شامل) حجمه كبير، فهنقسمه على 3 مراحل عشان نضمن الجودة وما نكسرش حاجة شغالة.

## ⚠️ تنبيه مهم عن الـ PWA

- الـ Service Worker و offline mode **مش هيشتغلوا داخل preview الـ Lovable** (عشان الـ iframe). هيشتغلوا فقط على الموقع المنشور (`admin.steinheim-eg.com` و `invoice-ease-16.lovable.app`).
- لازم نختبر بعد كل publish من جهاز حقيقي (موبايل/متصفح خارجي).

---

## المرحلة 1: مراجعة وتقوية Realtime (أولوية أولى)

**الهدف**: أي تعديل في DB يظهر فوراً عند كل المستخدمين بدون refresh.

### الخطوات
1. مراجعة الـ Supabase Realtime publication والتأكد إن الجداول دي مفعلة:
   - `products`, `invoices`, `invoice_items`, `purchase_orders`, `purchase_order_items`, `po_profit_scenarios`, `customers`, `delivery_receipts`, `delivery_receipt_items`, `notifications`, `inventory_logs`, `stock_intakes`
2. عمل hook موحد `useRealtimeTable(table, queryKey)` يستخدم `supabase.channel().on('postgres_changes')` ويعمل invalidate لـ React Query تلقائياً.
3. تطبيق الـ hook على كل الصفحات الرئيسية:
   - Products list
   - Invoices list & detail
   - Purchase Orders
   - Profit Calculator (موجود جزئياً)
   - Profit Scenarios (موجود)
   - Delivery Receipts
   - Customers
   - Notifications
4. اختبار من جهازين: تعديل من جهاز ⇒ يظهر فوراً عند التاني.

---

## المرحلة 2: PWA Shell + Offline Read

**الهدف**: المستخدم يقدر يفتح التطبيق ويتصفح المنتجات/الفواتير/الـ POs حتى من غير نت.

### الخطوات
1. إضافة `vite-plugin-pwa` بإعدادات آمنة:
   - `devOptions.enabled: false` (مش يشتغل في preview)
   - guard في `main.tsx` يمنع التسجيل في الـ iframe وعلى hosts الـ preview
   - `NetworkFirst` للـ HTML, `StaleWhileRevalidate` للـ assets
2. عمل `manifest.webmanifest` بـ:
   - app name, icons (192, 512), theme color, display: standalone
   - زر "Install App" يظهر لما المتصفح يدعمه
3. تخزين البيانات الأساسية في **IndexedDB** عبر `dexie` (أخف من supabase-js cache):
   - cache آخر نسخة من products/invoices/customers/POs محلياً
   - عند الفتح offline: نقرأ من IndexedDB ونعرض banner "أنت غير متصل"
4. QR codes: يتولدوا client-side (موجود فعلاً), فهيشتغلوا offline تلقائياً.

---

## المرحلة 3: Offline Write + Sync Queue

**الهدف**: تقدر تعمل فاتورة/تعدل منتج وانت offline، ولما النت يرجع كل حاجة تترفع تلقائياً.

### الخطوات
1. عمل `outbox` table في IndexedDB يخزن أي mutation فشلت بسبب الانترنت:
   ```
   { id, table, op (insert/update/delete), payload, created_at, retry_count }
   ```
2. wrapper حول كل supabase mutations:
   - يحاول الـ DB
   - لو فشل بسبب network → يحفظ في outbox + يحدث IndexedDB cache محلياً (optimistic)
   - يعرض badge "X تغييرات في انتظار المزامنة"
3. Background sync:
   - listener على `window.online` event
   - لما النت يرجع → يعالج الـ outbox بالترتيب
   - في حالة conflict (نفس الصف اتعدل من جهاز تاني) → نطبق "last-write-wins" مع log في audit
4. حماية حالات حرجة:
   - **invoice numbers / receipt numbers**: مش نولدها offline (نسيب server يولدها)؛ لو الفاتورة اتعملت offline، نعطيها رقم temp ونستبدله لما تترفع.
   - **stock_quantity**: نطبق التغيير optimistically لكن نحذر من oversell عند الـ sync.
5. UI feedback:
   - أيقونة في الـ header: 🟢 online / 🟡 syncing / 🔴 offline (X pending)
   - toast لما sync ينجح/يفشل

---

## ملاحظات تقنية

- **مش هنغير** schema أو RLS الحالي — الـ realtime publication بس محتاج تأكيد.
- **مكتبات جديدة**: `vite-plugin-pwa`, `dexie`, `workbox-window` (كلها صغيرة).
- **التيستينج**: بعد كل مرحلة، publish + اختبار من موبايل + متصفح ثاني عشان نضمن الـ realtime/offline.

---

## ايه اللي محتاجه منك دلوقتي

أبدأ بـ **المرحلة 1 (Realtime)** فوراً لأنها الأساس وأقل خطر. لما أخلصها وتختبرها وتأكدها، نعدي للمرحلة 2 ثم 3.

موافق نمشي بالترتيب ده، ولا تحب نبدأ بحاجة معينة الأول؟
