# بناء التطبيق الأصلي (Android / iOS / Windows / macOS)

هذا التطبيق يعمل كـ Web + PWA + تطبيق أصلي عبر **Capacitor** بدون الحاجة للنشر على متاجر التطبيقات.

## الإعداد لمرة واحدة (على جهازك المحلي)

> سحب المشروع من Lovable إلى GitHub أولاً، ثم على جهازك:

```bash
git clone <repo-url>
cd <repo>
bun install

# تثبيت Capacitor + المنصات
bun add @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios \
        @capacitor/push-notifications @capacitor/splash-screen \
        @capacitor/status-bar @capacitor-community/speech-recognition
bun add @capgo/capacitor-updater    # OTA

# إضافة المنصات (أول مرة فقط)
npx cap add android
npx cap add ios
```

## بناء الـ Web Bundle

```bash
bun run build      # ينتج /dist
npx cap sync       # ينسخ /dist للمشاريع الأصلية
```

## 1. Android APK (مجاني، بدون متجر)

```bash
npx cap open android
```

في Android Studio:
- **Build → Build Bundle(s) / APK(s) → Build APK(s)**
- الملف بيظهر في: `android/app/build/outputs/apk/debug/app-debug.apk`
- ابعت الـ APK لموظفين الشركة عبر واتساب/Drive
- المستخدم: **Settings → Security → Install from unknown sources** → ثبّت

## 2. iOS IPA (محتاج Mac + Apple ID)

```bash
npx cap open ios
```

في Xcode:
- اختر الـ Team (حتى Apple ID مجاني يكفي للتوزيع الداخلي لمدة 7 أيام)
- **Product → Archive → Distribute App → Ad Hoc**
- للتوزيع طويل المدى بدون متاجر: استخدم **AltStore** أو **Sideloadly**
- أو اشترك في Apple Developer ($99/سنة) واستخدم **TestFlight** (موصى به)

## 3. Windows EXE + macOS DMG (Electron)

سيتم إضافة Electron wrapper في المرحلة التالية (يحتاج تثبيت Electron محلياً).

## التحديثات الفورية (Capgo OTA)

بعد كل مرة ترفع تحديث من Lovable:

```bash
# 1. اسحب آخر تحديثات الكود
git pull

# 2. ابني الـ web
bun run build

# 3. ارفع التحديث على Capgo (مجاني لـ 1000 جهاز)
npx @capgo/cli upload --apikey YOUR_CAPGO_KEY

# 4. سجّل التحديث في قاعدة البيانات عشان الموظفين يجيلهم إشعار
psql -c "INSERT INTO app_updates (version, release_notes) VALUES ('1.2.3', 'إصلاح الصوت + الكلندر الذكي')"
```

كل الأجهزة المثبت عليها التطبيق:
1. هتشيك على التحديث عند فتح التطبيق
2. هتنزّله في الخلفية
3. هيتفعّل تلقائياً
4. هيوصلهم إشعار: "في تحديث جديد متاح"

## الإشعارات Push (حتى لو التطبيق مقفول)

1. أنشئ مشروع مجاني على Firebase: https://console.firebase.google.com
2. حمّل `google-services.json` لـ Android و `GoogleService-Info.plist` لـ iOS
3. ضعهم في `android/app/` و `ios/App/App/` على التوالي
4. الإشعارات هتشتغل تلقائياً عبر الجدول الموجود `push_subscriptions`

## ملاحظات

- **Vite base path**: لو ظهر screen أبيض في Electron، تأكد إن `vite.config.ts` فيه `base: './'`
- **iOS Safari**: ميكروفون مدعوم بس محتاج HTTPS — الأصلي مش هيكون فيه مشكلة
- **Egyptian Arabic STT**: على Android بيستخدم Google TTS الأصلي (دقة ممتازة)، على iOS بيستخدم Siri Arabic
