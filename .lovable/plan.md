
# ربط Zoho Books — صفحة منتجات لحظية بالجنيه المصري

## نظرة عامة

سحب كل المنتجات من حساب Zoho Books الخاص بـ **Steinheim Building materials** (الإمارات) إلى صفحة جديدة `/zoho-inventory` داخل التطبيق، مع:
- **عرض كل البيانات**: الاسم، SKU، الصورة، اللون، السيريال، الوصف، الكمية المتاحة، الحالة
- **تحويل الأسعار AED → EGP** بسعر صرف ثابت تحدده وتعدله من صفحة الإعدادات
- **تحديث لحظي** على كل الحسابات الأربعة (مزامنة كل 30 ثانية + Realtime)
- **حفظ دائم** في قاعدة البيانات — لا حذف نهائي، فقط `status=inactive` لأي صنف يُشال من Zoho
- **منفصل تماماً** عن `products` المحلية — لا يؤثر على المخزون أو الفواتير أو أي بيانات قائمة

## ما تراه أنت في الصفحة

- شبكة منتجات بالصورة + الاسم + SKU + المخزون + **السعر بالجنيه (السعر الأصلي بالدرهم بجوارها كمرجع)**
- شارة لونية للمخزون: أخضر (>10) / أصفر (1-10) / أحمر (نفد) / رمادي (محذوف من Zoho)
- بحث + فلتر (متاح/نفد/محذوف) + ترتيب حسب الاسم/السعر/المخزون
- نقرة على المنتج → نافذة بكل التفاصيل من Zoho
- شريط علوي: "آخر مزامنة منذ X ثانية" + مؤشر Live أخضر + زر "مزامنة الآن"
- صفحة **إعدادات صغيرة** (داخل نفس الصفحة) لتحديد:
  - **سعر صرف AED → EGP** (مثلاً 13.25)
  - تاريخ آخر تحديث للسعر ومن حدّثه

## التصميم التقني

### 1. الأسرار المطلوبة (5 قيم)
- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`
- `ZOHO_ORGANIZATION_ID`
- `ZOHO_REGION` (مثلاً `com`, `eu`, `sa`)

سأشرح طريقة الحصول عليها خطوة بخطوة قبل طلبها.

### 2. قاعدة البيانات (جداول جديدة فقط — لا تعديل على القائم)

**`zoho_items`** — مرآة لمنتجات Zoho:
```
item_id (text, PK), name, sku, description, unit, status,
rate_aed (numeric), rate_egp (numeric, محسوبة),
stock_on_hand, available_stock,
image_url (نسخة محلية في Storage), color, serial_number,
raw (jsonb للبيانات الكاملة),
hash (لاكتشاف التغيير), last_synced_at, deleted_from_zoho (bool), updated_at
```

**`zoho_settings`** — صف واحد للشركة:
```
id (text PK = 'default'), aed_to_egp_rate (numeric, default 13.25),
updated_by_email, updated_at
```

**`zoho_sync_state`** — تتبع حالة المزامنة:
```
last_run_at, last_success_at, items_synced, items_added, items_updated,
items_marked_deleted, last_error, last_error_at
```

- **RLS**: قراءة لأعضاء الشركة (`is_company_member()`) فقط، الكتابة من السيرفر فقط (service role)
- **Realtime مفعّل** على `zoho_items` و `zoho_settings`
- **Storage bucket** عام `zoho-images` لصور المنتجات
- **سياسة عدم الحذف**: عند اختفاء صنف من Zoho → `deleted_from_zoho=true, status='inactive'`. لا `DELETE` نهائياً.

### 3. السيرفر — TanStack Server Functions
**`src/server/zoho.server.ts`** (server-only):
- `refreshZohoToken()` — تجديد access token عبر refresh_token
- `fetchZohoItems(page, perPage)` — pagination لكل أصناف Zoho
- `downloadAndCacheImage(itemId)` — يرفع الصورة لـ Storage مرة واحدة عند تغيّر `image_document_id`
- `syncAllItems()` — المنطق الأساسي:
  1. اجلب كل الأصناف من Zoho
  2. احسب hash لكل صنف
  3. INSERT الجديد، UPDATE المتغير فقط، علّم الناقص بـ `deleted_from_zoho=true`
  4. اقرأ سعر الصرف الحالي واحسب `rate_egp = rate_aed * rate`
  5. سجّل النتائج في `zoho_sync_state`
- معالجة 429 (rate limit) مع backoff، تجديد Token تلقائي عند 401، transaction واحد لكل دفعة

**`src/server/zoho.functions.ts`**:
- `syncZohoNow()` — server function للزر اليدوي (محمي بـ `requireSupabaseAuth` + عضوية الشركة)
- `updateExchangeRate(rate)` — حفظ سعر جديد + إعادة حساب `rate_egp` لكل المنتجات

### 4. المزامنة الدورية كل 30 ثانية
**`src/routes/api/public/zoho-sync.ts`** — endpoint محمي بـ `x-cron-secret` header، يستدعي `syncAllItems()`.

**pg_cron** يستدعيه عبر `net.http_post` كل 30 ثانية على رابط `project--{id}.lovable.app`.

### 5. الواجهة
**`src/routes/zoho-inventory.tsx`** — جديد:
- شبكة منتجات (Grid) responsive، اشتراك `useRealtimeTable("zoho_items")` للتحديث الفوري
- مكوّن `ZohoExchangeRateCard` لتعديل سعر الصرف (يتطلب صلاحية)
- نافذة تفاصيل (Dialog) عند الضغط على منتج
- شارات الحالة + مؤشرات اللون
- بحث/فلتر/ترتيب client-side

**`src/components/app-shell.tsx`** — بند جديد في القائمة الجانبية: "منتجات Zoho / Zoho Inventory" بأيقونة `Boxes`.

**`src/lib/i18n.tsx`** — مفاتيح ترجمة AR/EN كاملة.

### 6. الدقة وعدم الأخطاء
- مقارنة hash لتجنب تحديثات وهمية وضوضاء Realtime
- Token refresh تلقائي عند 401 + retry واحد
- معالجة 429 + exponential backoff
- Transaction لكل دفعة → اتساق كامل
- تسجيل كل خطأ في `zoho_sync_state.last_error` لرؤيته في الواجهة
- لا يوجد DELETE نهائي إطلاقاً — فقط `deleted_from_zoho=true`
- إعادة حساب `rate_egp` على كل المنتجات تلقائياً عند تغيير سعر الصرف
- صور Zoho تُرفع لـ Storage مرة واحدة فقط عند تغيّر `image_document_id`

## الملفات الجديدة/المعدّلة

**جديدة**:
- `src/routes/zoho-inventory.tsx`
- `src/routes/api/public/zoho-sync.ts`
- `src/server/zoho.server.ts`
- `src/server/zoho.functions.ts`
- `src/lib/zoho-types.ts`
- migration: جدولا `zoho_items`, `zoho_settings`, `zoho_sync_state` + RLS + Realtime + bucket `zoho-images` + cron job

**معدّلة**:
- `src/components/app-shell.tsx` (بند جديد)
- `src/lib/i18n.tsx` (مفاتيح ترجمة)

## ما سأطلبه منك بعد الموافقة

1. **أشرح طريقة الحصول على بيانات Zoho OAuth** (5 خطوات سريعة في Zoho Developer Console)
2. **أطلب منك إدخال الـ5 أسرار** عبر أداة الأسرار الآمنة
3. **أطلب منك إدخال سعر الصرف الابتدائي** (مثلاً 13.25) — يمكن تغييره لاحقاً من الواجهة
4. **أنفّذ كل شيء** ثم نختبر سوياً

هل توافق على المضي قدماً؟
