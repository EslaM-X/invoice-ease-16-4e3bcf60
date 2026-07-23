## المشكلة (السبب الجذري)

`AppShell` يضع محتوى الصفحة داخل `<main class="mx-auto w-full max-w-7xl px-3 sm:px-6 lg:px-8">` بجانب شريط جانبي ثابت للديسكتوب. صفحة `team-chat` كانت تحاول كسر هذا القيد عبر الحيلة:

```
md:-my-8 md:w-screen md:max-w-[100vw] md:mx-[calc(50%-50vw)]
```

هذه الحيلة تحسب `50vw` من كامل عرض المتصفح، لكن الـ`<main>` ليس ممتدًا لكامل العرض — بل يزاحمه الشريط الجانبي (lg+) و`max-w-7xl`. النتيجة: يمتد الشات فوق الشريط الجانبي وعناصر الهيدر الخاصة بالتطبيق، فيبان كل شيء متراكب ومنزلق كما في اللقطة، مع ظهور الـ`ChatPopupNotifier` فوقه لأن كلاهما مرسي على حواف viewport مختلفة.

## الحل

استبدال حيلة الـfull-bleed بميزة مدعومة من `AppShell` نفسها لضمان ملء المساحة المتاحة **بجانب الشريط الجانبي** فقط، بدون أي `100vw`.

### 1) `src/components/app-shell.tsx` — دعم `fullBleed`

- إضافة prop اختياري `fullBleed?: boolean` على `AppShell`.
- عندما يكون `true`: تنطبق كلاسات الـ`<main>` كالتالي بدل `mx-auto max-w-7xl px-* py-*`:
  ```
  flex-1 min-w-0 min-h-0 w-full overflow-hidden p-0 pb-tabbar lg:pb-0
  ```
  يبقى الهيدر الخاص بـAppShell أعلى الصفحة، ويملأ الشات الباقي بدون padding ولا `max-w`.

### 2) `src/routes/team-chat.tsx` — استخدام `fullBleed` وإزالة الحيلة

- `<AppShell fullBleed>` بدل `<AppShell>`.
- الحاوية الرئيسية للشات تصبح:
  ```
  flex overflow-hidden bg-card border-t h-[calc(100dvh-3.5rem)] w-full
  ```
  حذف كل من: `md:-my-8`, `md:w-screen`, `md:max-w-[100vw]`, `md:mx-[calc(50%-50vw)]`, `rounded-2xl md:rounded-none`, `shadow-lg md:shadow-none`, `border md:border-0`. تبقى الحواف نظيفة داخل الـshell.
- ارتفاع الحاوية يعتمد على ارتفاع هيدر AppShell (14 = 3.5rem) بدل `8rem/4rem` المرتبطة بالـpadding المحذوف.

### 3) التحقق البصري

- التقاط شاشة تلقائية (Playwright headless) في وضعي RTL/LTR على viewport 1280 و1440 للتأكد:
  - لا يوجد تمرير أفقي (`documentElement.scrollWidth === clientWidth`).
  - الشريط الجانبي للشات ملاصق لحدود منطقة الـ`<main>`، والفقاعات محاذية بشكل صحيح.
  - `ChatPopupNotifier` لا يتراكب مع أزرار الهيدر الخاصة بالتطبيق.
- تشغيل `tsgo --noEmit`.

## ملاحظات

- لا حاجة لأي تغيير في قاعدة البيانات — التعديلات تنسيقية بحتة.
- إعدادات المستخدم (عرض الشات، وضع التركيز، الكثافة، الخلفية) تبقى كما هي؛ فقط ألغيت الحيلة التي كانت تخترق حاوية AppShell.
- بعد التعديل: `chatWidth = full` يعني ملء كامل مساحة الـ`<main>` بجانب الشريط الجانبي (وهذا هو السلوك الصحيح المتوقع من "ملء الشاشة" داخل التطبيق).