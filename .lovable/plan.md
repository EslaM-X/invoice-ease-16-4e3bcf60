
# لوحة تحكم "Access Studio" — تخصيص كامل لكل حساب

نظام موحّد End-to-End يسمح للسوبر-أدمن (e.hesham@ و k.elsharbatly@ فقط) بإنشاء حسابات جديدة داخل الشركة، والتحكم بدقة في كل ما يظهر لكل مستخدم: التابات، البنود داخل التاب، الصفحات، كروت لوحة التحكم، الترتيب، ومعاينة التطبيق بعينَي أي مستخدم.

## 1) صفحة جديدة `/admin/access-studio`

لوحة واحدة فخمة بستايل Noir & Gold، محمية بـ `SuperAdminGate` (تسمح فقط للإيميلين المذكورين).
يمين: قائمة كل مستخدمي الشركة (بحث + شارة الحالة + الأدوار).
يسار (أو أسفل على الموبايل): **Inspector** بالتابات التالية:

1. **Overview** — بيانات المستخدم، حالة الحساب (نشط/موقوف)، آخر دخول، عدد الصفحات المسموح بها.
2. **Roles** — تعديل أدوار (admin / manager / cashier / call_center / purchasing / cfo / user) وامتيازات "executive" و "inventory_admin".
3. **Navigation** — شجرة كل السايدبار (المجموعات + العناصر) + المزيد من الصفحات المخفية. لكل عنصر: مفتاح Show/Hide + Drag to reorder + إمكانية إعادة ترتيب المجموعات نفسها. تتحكم أيضًا في شريط التبويب السفلي على الموبايل (Mobile Tab Bar).
4. **Dashboard Cards** — قائمة بكل كروت لوحة التحكم (KPI cards + قسم "المهام" + "الفواتير القابلة للإغلاق" + "إشعارات إلخ"). لكل كارت: Show/Hide + ترتيب بالسحب.
5. **Preview As User** — زر "شاهد التطبيق كأنك هذا المستخدم" يفتح الشِل داخل iframe (أو ينشط وضع impersonation-view فقط بدون كتابة) مع بانر ذهبي "أنت تشاهد كـ …" وزر خروج.
6. **Create Account** — نموذج (إيميل + اسم + كلمة سر مؤقتة + اختيار Preset "Cashier / Call Center / Manager / Custom") ينشئ الحساب فورًا عبر Auth Admin API ويطبق البريسِت.

## 2) قاعدة البيانات (Migration)

- `user_ui_preferences` — { user_id PK, nav_visibility jsonb, nav_order jsonb, dashboard_cards jsonb, mobile_tabs jsonb, updated_by, updated_at }.
- `nav_catalog` (Seed ثابت في الكود): مصدر واحد للحقيقة لكل مفاتيح التنقل والكروت — يستخدم في السايدبار وفي Access Studio معًا (لا مزيد من التكرار).
- `account_presets` — قوالب افتراضية (Cashier, CallCenter, Manager, Distributor, Purchasing, CFO, Executive) قابلة للتطبيق بضغطة.
- RLS: قراءة/تعديل مسموحة فقط لسوبر-أدمن (دالة `is_super_admin()`)؛ كل مستخدم يقرأ صفوفه الخاصة فقط.
- `audit_log` قيد لكل تعديل: "Admin X changed navigation for user Y".

## 3) مصدر واحد للتنقل (Refactor)

- إنشاء `src/lib/nav-catalog.ts` يحوي **كل** عناصر السايدبار + الكروت الحالية (مع i18n keys والأيقونات والصلاحية الأساسية).
- تحديث `app-shell.tsx` و `mobile-tab-bar.tsx` ليستهلكا الكتالوج + تفضيلات المستخدم (`useUiPrefs()`).
- تحديث `dashboard.tsx` ليعرض كروت بناءً على `dashboard_cards` order/visibility.
- لو ما فيش تفضيلات → يظهر الافتراضي الحالي (لا كسر لأي مستخدم قائم).

## 4) قواعد صارمة

- **Super Admins (e.hesham@, k.elsharbatly@)**: يتخطون كل قيود التفضيلات ويشوفون كل شيء دائمًا (مضمون في `useUiPrefs`).
- الصلاحيات الحقيقية (RLS / has_role) هي مصدر الأمان — التفضيلات هنا "إخفاء بصري" فقط. لن نعتبر إخفاء تاب أمانًا؛ الحماية الفعلية تبقى على مستوى Route Guards و RLS كما هي.
- كل عنصر تنقّل جديد يُضاف مستقبلًا: يكفي تسجيله في `nav-catalog.ts` وسيظهر تلقائيًا داخل Access Studio.

## 5) Preview-as-User

- زر يخزّن `impersonate_user_id` في `sessionStorage` ويعيد تحميل الشِل.
- `useUiPrefs` يقرأ تفضيلات المستخدم المستهدف بدل الحالي (باستعلام سوبر-أدمن).
- بانر علوي ذهبي ثابت + زر "خروج من المعاينة".
- المعاينة عرض فقط: يتم منع أي كتابة/تحديث فعلي أثناء الـ impersonation (بدون تغيير جلسة Supabase نفسها).

## 6) الملفات المتأثرة

جديدة: `src/routes/admin.access-studio.tsx`, `src/components/access-studio/*` (UserList, RoleEditor, NavTreeEditor, DashboardCardsEditor, CreateAccountDialog, PreviewBanner), `src/lib/nav-catalog.ts`, `src/lib/use-ui-prefs.ts`, `src/lib/super-admin.ts`, `src/components/super-admin-gate.tsx`, `src/lib/access-studio.functions.ts` (server fns للسوبر-أدمن: createAccount, applyPreset, saveUserPrefs, loadUserPrefs).
تعديل: `app-shell.tsx`, `mobile-tab-bar.tsx`, `dashboard.tsx`, `routes/admin.tsx` (زر دخول للـ Access Studio).
Migration واحد: الجداول + RLS + preset seeds + `is_super_admin()`.

## 7) التسليم

- تصميم Noir & Gold متسق مع باقي الأدمن.
- عربي/إنجليزي كامل.
- ريلتايم: أي تعديل يظهر فورًا للمستخدم المعني (Supabase realtime على `user_ui_preferences`).
- بدون كسر للتصرف الحالي لأي حساب قائم.

هل أبدأ التنفيذ بهذه المواصفات؟
