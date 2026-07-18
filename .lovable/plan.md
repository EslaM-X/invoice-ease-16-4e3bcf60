# خطة تحسين الأداء الشاملة — بدون فقدان أي شكل أو ميزة

الهدف: تشغيل أنعم وأخف وأقل تقطيعًا في كل الصفحات (لوحة التحكم، الفواتير، المنتجات، المهام، الأرباح، محاضر الاستلام، النواقص، Access Studio…) مع الحفاظ الكامل على الهوية البصرية (Noir & Gold)، الألوان، الأنيميشن، الكروت، والمميزات.

---

## 1) تقليل إعادة الرندر (Re-renders)

- تغليف الكروت والصفوف الثقيلة بـ `React.memo` مع دوال مقارنة سطحية (Dashboard KPI, LeadershipTasksCard, InvoiceRow, ProductRow, ShortagesRow…).
- استخدام `useCallback` / `useMemo` لكل handler ومصفوفة تُمرّر لمكونات مذكورة.
- تحويل الحسابات الثقيلة (تجميع KPI، حساب WAC، فرز/فلترة الفواتير والمنتجات) إلى `useMemo` مع مفاتيح دقيقة.
- استبدال setState بالكامل بـ setState الوظيفي + دمج بالـ id (نفس نمط `mergeTasks` الحالي) عبر: invoices, products, POs, receipts, shortages.

## 2) Realtime أهدأ

- توحيد اشتراكات Supabase Realtime في `src/lib/realtime.ts` لتفادي إعادة الاشتراك عند كل رندر.
- Debounce (150–250ms) لأحداث INSERT/UPDATE/DELETE المتتابعة قبل تحديث الحالة.
- تحديث تفاضلي بالـ id فقط بدل إعادة تحميل الجدول كامل.

## 3) Virtualization للقوائم الطويلة

- تطبيق `react-window` (المتوفر بالفعل) على: الفواتير، المنتجات، محاضر الاستلام، النواقص، الأوديت لوج، تاريخ التكلفة، تقارير المتتبع — عند تجاوز 50 صف.

## 4) سلاسة التمرير والانتقالات

- إضافة `content-visibility: auto` + `contain-intrinsic-size` للكروت خارج الشاشة.
- `will-change: transform` مضبوطة فقط أثناء الأنيميشن ثم تُزال.
- تفعيل `scroll-behavior: smooth` + `overscroll-behavior: contain` على الحاويات القابلة للتمرير.
- احترام `prefers-reduced-motion` لتخفيف الأنيميشن للأجهزة الضعيفة (بدون حذفه للباقين).

## 5) تحميل ذكي (Data & Code)

- الاعتماد على TanStack Query cache: `staleTime` مناسب لكل استعلام (30s–5m) لمنع إعادة الجلب المتكررة.
- Prefetch للـ routes المجاورة عند `hover`/`focus` على الروابط (`Link preload="intent"`).
- Code-splitting الصفحات الثقيلة (Profits, Traceability, Access Studio) — تلقائي بالفعل عبر TanStack؛ سنتحقق ألا تُصدَّر مكونات الصفحة.

## 6) صور وأصول أخف

- تحويل الأڤاتارات وصور المنتجات لاستخدام Supabase Image Transform (WebP/AVIF) بأحجام srcset — مثل نمط `LeaderAvatar` الحالي.
- `loading="lazy"` + `decoding="async"` لكل صور المنتجات في القوائم.

## 7) استقرار

- ثبات الترتيب في القوائم (نفس نمط ثبات مهام القيادة) — لا إعادة ترتيب أثناء الفلترة أو الريلتايم.
- Skeletons بنفس أبعاد المحتوى النهائي لمنع Layout Shift (CLS).
- عزل الأخطاء بحدود `errorComponent` موجودة أصلًا؛ سنراجع ونضيف حيث ينقص.

## 8) قياس ومراجعة

- تشغيل build وقياس حجم الحزم لكل route؛ التحقق من عدم زيادة الحجم.
- فحص سريع بواجهة React DevTools Profiler (عبر Playwright) على 3 صفحات ثقيلة: Dashboard, Invoices, Products.

---

## ما لن يتغير

- التصميم Noir & Gold، الألوان، التدرجات، الظلال الذهبية، الأڤاتارات، الأنيميشن الحالية، ترتيب الأقسام، الأيقونات، النصوص، الصلاحيات، والمنطق التجاري بالكامل.

## Technical section

- ملفات مركزية ستُلمس: `src/routes/dashboard.tsx`, `src/routes/invoices.index.tsx`, `src/routes/products.tsx`, `src/routes/tasks.tsx`, `src/routes/stock-shortages.tsx`, `src/routes/delivery-receipts.index.tsx`, `src/routes/profits.tsx`, `src/routes/inventory-traceability.tsx`, `src/components/noir-kpi-card.tsx`, `src/components/leadership-tasks-card.tsx`, `src/components/closeable-invoices-card.tsx`, `src/lib/realtime.ts`, `src/styles.css` (utilities جديدة: `.cv-auto`, `.smooth-scroll`).
- لا تعديلات على السكيمة أو الـ RPCs أو RLS.
- سيتم التنفيذ على موجات: (Wave A) realtime + memoization في Dashboard و Tasks و Invoices، (Wave B) virtualization + صور، (Wave C) CSS containment + prefetch + قياس.

هل أبدأ التنفيذ بالخطة كاملة؟
