## الفكرة

بعد أن يدخل المستخدم إلى التطبيق (نفس الجهاز / نفس الحساب) **أكثر من 5 مرات**، نعرض له **شاشة افتتاحية فاخرة (Splash Screen)** بدل الدخول المباشر، تظهر لثوانٍ معدودة ثم تختفي تلقائيًا إلى لوحة التحكم.

الشاشة بطابع **فاخر / Luxury Editorial**:
- خلفية سوداء عميقة (`oklch(0.04 0 0)`) مع تدرج خفيف للرمادي الفحمي.
- الشعار في المنتصف بلمسة **فضية لامعة (Platinum Shimmer)** باستخدام `--gradient-silver` و`--gradient-platinum-text` الموجودين فعلاً في `src/styles.css`.
- خط تحت الشعار رفيع متحرك (hairline) باللون الفضي.
- اسم العلامة "Steinheim" بخط Display أبيض ناعم + تحته إيبرو فضي صغير.
- تأثير حركي: ظهور تدريجي (fade + scale) ثم لمعان فضي يمر على الشعار مرة واحدة، ثم اختفاء سلس.
- مدتها ≈ 2.4 ثانية، يمكن تخطيها بالنقر.

## الشروط (متى تظهر؟)

1. عدّاد دخول مخزّن في `localStorage` باسم `steinheim_entry_count`.
2. يزداد العدّاد +1 عند كل تحميل ناجح للتطبيق وهو مسجّل دخول.
3. عند تجاوز **5 مرات** → تظهر الشاشة الفاخرة بدل الـ splash العادي.
4. بعد عرضها تُسجَّل آخر مرة ظهرت فيها (`steinheim_splash_lastShownAt`) حتى لا تتكرر في كل تنقّل داخلي — تظهر فقط عند بدء جلسة/فتح التطبيق.

## الملفات المتأثرة

- **جديد**: `src/components/luxury-splash.tsx` — مكوّن الشاشة الفاخرة (motion + tailwind tokens).
- **جديد**: `src/lib/entry-counter.ts` — منطق العدّاد ومتى تُعرض الشاشة.
- **تعديل**: `src/routes/__root.tsx` أو `src/components/app-shell.tsx` — لتركيب `<LuxurySplash />` فوق المحتوى عند الحاجة.
- **تعديل بسيط**: `src/styles.css` — إضافة keyframes للّمعان الفضي العمودي على الشعار (إن لزم).

## التفاصيل التقنية

```text
on app mount (authenticated):
  count = +localStorage.steinheim_entry_count || 0
  count += 1
  save count
  if count > 5 AND lastShownAt is older than current session start:
     show <LuxurySplash />
     after 2400ms → hide + save lastShownAt
```

- لا تغييرات على الـ backend / RLS / auth.
- متوافق RTL تلقائيًا (لا نص اتجاهي حساس داخل الشاشة).
- يحترم `prefers-reduced-motion` (يعطّل اللمعان والحركة).
- يعمل على iOS / Android / Windows / macOS لأنه مجرد طبقة CSS + framer-motion.

## أسئلة سريعة قبل التنفيذ

- هل تريد أن تظهر الشاشة **مرة واحدة فقط** بعد المرة الخامسة، أم **في كل فتح للتطبيق** بعد ذلك؟
- هل تفضّل ظهور **شعار صورة فعلي** (لو عندك ملف SVG/PNG في `src/assets`) أم نعتمد على **اسم العلامة بخط فخم + خط فضي** فقط؟

أخبرني وسأبدأ التنفيذ مباشرة.
