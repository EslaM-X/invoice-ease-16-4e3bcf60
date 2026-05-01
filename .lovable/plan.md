# ربط Zoho Books بالتطبيق — صفحة منتجات لحظية

## نظرة عامة

إنشاء صفحة جديدة `/zoho-inventory` داخل التطبيق تعرض كل المنتجات الموجودة في حساب Zoho Books الخاص بالمصنع/المورد، مع تحديث لحظي للصور والكميات والأسعار وأي إضافة/حذف/زيادة/نقصان — بدون أن تؤثر على المخزون الداخلي للتطبيق (يبقى منفصل تمامًا).

## كيف يعمل الربط مع Zoho

Zoho Books يوفر REST API رسمي:
- `GET /api/v3/items` — قائمة كل الأصناف (المنتجات) مع `name`, `sku`, `rate`, `stock_on_hand`, `image_document_id`, إلخ.
- `GET /api/v3/items/{item_id}` — تفاصيل صنف واحد.
- `GET /api/v3/items/{item_id}/image` — صورة الصنف.
- المصادقة: OAuth 2.0 — يحتاج `client_id`, `client_secret`, `refresh_token`, و `organization_id` للمصنع.

**مهم:** Zoho **لا يدعم Webhooks للمخزون** بشكل عام في خطة Books الأساسية. لذلك "اللحظي" يتحقق عبر **polling ذكي كل 15-30 ثانية** من السيرفر + بث التغييرات للمستخدم عبر Supabase Realtime. هذا هو المعيار الصناعي المتبع مع Zoho.

## التصميم التقني

### 1. الأسرار (Secrets)
يطلب من المستخدم إدخال:
- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`
- `ZOHO_ORGANIZATION_ID`
- `ZOHO_REGION` (مثلاً `com`, `eu`, `sa`) — لتحديد دومين API الصحيح

تعليمات الحصول عليها سأشرحها خطوة بخطوة في الشات قبل طلب الأسرار.

### 2. قاعدة البيانات
جدول جديد `zoho_items` (cache + مصدر للـRealtime):
```
- item_id (text, PK)            — من Zoho
- name, sku, description, unit
- rate (numeric)                — السعر
- stock_on_hand (numeric)
- available_stock (numeric)
- image_url (text)              — مخزّنة في Supabase Storage
- status (text)                 — active/inactive
- raw (jsonb)                   — كل البيانات من Zoho للعرض الكامل
- last_synced_at, updated_at
```
+ جدول `zoho_sync_state` لتتبع آخر مزامنة وأي أخطاء.

RLS: قراءة فقط لأعضاء الشركة (`is_company_member()`). لا أحد يكتب من الواجهة — السيرفر فقط.

تفعيل Realtime على `zoho_items` لبث أي INSERT/UPDATE/DELETE فورًا لكل الحسابات الأربعة.

### 3. السيرفر — Server Function للمزامنة
`src/server/zoho.functions.ts`:
- `syncZohoItems()` — يجلب refresh→access token، يستدعي `/items` بصفحات (pagination)، يقارن مع `zoho_items`، ثم:
  - INSERT للأصناف الجديدة
  - UPDATE للمتغير منها (سعر/مخزون/صورة)
  - DELETE (أو `status=inactive`) للمحذوف من Zoho
  - يرفع الصور الجديدة إلى Supabase Storage في bucket `zoho-images` (عام)
- `getZohoItemDetails(itemId)` — للتفاصيل الكاملة عند الضغط على منتج

### 4. المزامنة الدورية (cron)
Endpoint عام محمي بسر: `src/routes/api/public/zoho-sync.ts`
- يُستدعى كل 30 ثانية بواسطة pg_cron (Supabase) عبر `net.http_post`
- يتحقق من header `x-cron-secret`
- يستدعي `syncZohoItems()`

هذا يضمن التحديث اللحظي بدون أي تدخل من المستخدم وعلى كل الحسابات الأربعة.

### 5. الواجهة — `/zoho-inventory`
صفحة جديدة في `src/routes/zoho-inventory.tsx`:
- شبكة منتجات (Grid) مع صورة، اسم، SKU، السعر، المخزون المتاح
- شارة لونية للمخزون: أخضر/أصفر/أحمر (نفد)
- بحث + فلتر حسب الحالة + ترتيب
- نافذة تفاصيل عند الضغط (كل بيانات Zoho)
- مؤشر "آخر مزامنة منذ X ثانية" + زر "مزامنة الآن" يدوي
- اشتراك `useRealtimeTable("zoho_items", ...)` — أي تغيير من المزامنة يظهر فورًا في الواجهات الأربعة
- مؤشر "live" أخضر عند اتصال Realtime

ترجمات AR/EN كاملة، RTL، نفس ستايل باقي التطبيق (cards, tabs, popovers).

### 6. العنصر في الـSidebar
إضافة بند جديد "منتجات Zoho / Zoho Inventory" بأيقونة `Boxes` أو `Cloud` في `app-shell.tsx`.

## الملفات الجديدة/المعدلة

**جديدة:**
- `src/routes/zoho-inventory.tsx`
- `src/routes/api/public/zoho-sync.ts`
- `src/server/zoho.server.ts` (Zoho client + token refresh)
- `src/server/zoho.functions.ts` (server functions)
- `src/lib/zoho-types.ts`
- migration: جدولا `zoho_items`, `zoho_sync_state` + RLS + Realtime + bucket تخزين الصور + cron job

**معدلة:**
- `src/components/app-shell.tsx` — بند جديد في القائمة
- `src/lib/i18n.tsx` — مفاتيح الترجمة
- `src/integrations/supabase/types.ts` — يتحدث تلقائيًا

## الدقة وعدم الأخطاء

- **مقارنة hash** لكل صنف لتجنب تحديثات وهمية
- **رفع الصور بكسلًا واحدًا** فقط عند تغيّر `image_document_id`
- **معالجة أخطاء Zoho rate limit** (HTTP 429) مع backoff
- **Token refresh تلقائي** عند 401
- **Transaction واحد** لكل دفعة مزامنة لضمان الاتساق
- **سجل أخطاء** في `zoho_sync_state` لرؤية أي مشكلة فورًا
- لا يتم حذف أي بيانات تاريخية — فقط `status=inactive` لو الصنف اتشال من Zoho

## ما سأطلبه منك بعد الموافقة

1. سأشرح طريقة الحصول على Zoho OAuth credentials (5 خطوات في Zoho Developer Console).
2. سأطلب منك إدخال الـ4 أسرار + المنطقة + organization_id عبر أداة الأسرار الآمنة.
3. ثم أنفذ كل شيء بالترتيب.

هل توافق على المضي بهذا التصميم؟
