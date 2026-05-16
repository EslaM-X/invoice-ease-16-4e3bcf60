# دليل بناء وتحميل التطبيق على كل المنصات

ده الدليل الكامل لإزاي تبني نسخة جديدة من تطبيق Steinheim لأي منصة (Android / iOS / Windows / macOS)، ترفعها، وتنشرها للموظفين من جوه التطبيق.

> 📌 كل ما تنشر نسخة جديدة من صفحة `/download` كـ Admin، **كل الموظفين هيوصلهم إشعار تلقائي** فيه رقم النسخة ورابط التحميل.

---

## 0) المتطلبات لمرة واحدة

```bash
bun install
# Capacitor (موبايل)
bun add @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
bun add @capacitor/push-notifications @capgo/capacitor-updater
bun add @capacitor-community/speech-recognition   # مايك أصلي على الموبايل
```

> الـ **Speech Recognition plugin** بيدّينا دقة أعلى بكتير للهجة المصرية (`ar-EG`) من Web Speech API لأنه بيستخدم المحرك الأصلي للنظام (Google STT على أندرويد / Siri على آيفون).

أول مرة بس:

```bash
npx cap add android
npx cap add ios     # محتاج Mac
```

---

## 1) Android (`.apk`)

محتاج Android Studio.

```bash
bun run build           # ينتج /dist
npx cap sync android
npx cap open android    # يفتح Android Studio
```

في Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
ملف الـ APK هيطلع في `android/app/build/outputs/apk/release/`.

ارفعه (Storage / Drive / موقع) واعمل publish من `/download` → Platform: Android.

---

## 2) iOS (`.ipa`)

محتاج Mac + Xcode.

```bash
bun run build
npx cap sync ios
npx cap open ios        # يفتح Xcode
```

في Xcode: **Product → Archive → Distribute App**.

- لو عندك Apple Developer Account ($99/سنة): اختار **TestFlight** (الأسهل).
- من غير Developer Account: استخدم **AltStore / Sideloadly** لتثبيت الـ `.ipa` على الأجهزة (الـ certificate بيعدّى 7 أيام مع الحساب المجاني).

ارفع الـ `.ipa` واعمل publish من `/download` → Platform: iOS.

---

## 3) Windows (`.exe`)

محتاج جهاز ويندوز (أو VM).

```bash
# مرة واحدة
npm install --save-dev electron @electron/packager

# في كل بيلد
bun run build
npx @electron/packager . "Steinheim" --platform=win32 --arch=x64 --out=electron-release --overwrite --ignore="^/(android|ios|src|public|electron-release)"
```

النتيجة في `electron-release/Steinheim-win32-x64/`. زِبّها (`.zip`) وارفعها، أو اعمل installer بـ `electron-builder` لو محتاج `.exe` رسمي.

publish من `/download` → Platform: Windows.

---

## 4) macOS (`.dmg` أو `.zip`)

محتاج Mac.

```bash
bun run build
npx @electron/packager . "Steinheim" --platform=darwin --arch=universal --out=electron-release --overwrite --ignore="^/(android|ios|src|public|electron-release)"

# اعمل DMG
hdiutil create -volname "Steinheim" -srcfolder electron-release/Steinheim-darwin-universal -ov -format UDZO Steinheim.dmg
```

publish من `/download` → Platform: macOS.

---

## 5) إزاي تنشر نسخة جديدة (Admin)

1. ابني الملف للمنصة اللي عاوزها (الخطوات فوق).
2. ارفع الملف على أي storage عام (يفضّل Supabase Storage bucket عام، أو Google Drive بـ direct download link).
3. ادخل **`/download`** في التطبيق.
4. في كرت **"نشر نسخة جديدة (Admin)"** املأ:
   - **المنصة**: android / ios / windows / macos
   - **رقم النسخة**: مثلاً `1.2.0`
   - **رابط التحميل**: الرابط المباشر للملف
   - **ملاحظات الإصدار**: أهم التغييرات
   - **تحديث إجباري؟**: لو محتاج تجبر التحديث
5. اضغط **نشر**.

النتيجة:
- النسخة بتظهر فوراً في `/download` لكل المستخدمين.
- **كل موظفين الشركة بيوصلهم إشعار** (جرس + push على الموبايل).
- النسخة بتفضل محفوظة في سجل النسخ للأبد.

---

## 6) OTA Updates (Capgo) — تحديثات JS فقط من غير ما الناس تنزّل APK تاني

لما بتعدّل **ويب فقط** (مفيش plugins جديدة)، Capgo بيوزّع الـ JS bundle مباشرة:

```bash
bun add @capgo/cli --dev
npx @capgo/cli login YOUR_CAPGO_API_KEY
npx @capgo/cli bundle upload --channel production
```

التطبيقات اللي شغّالة هتنزّل التحديث في الخلفية وتطبّقه في فتحة قادمة.

> ⚠️ Capgo بيشتغل بس مع تغييرات JS/HTML/CSS. لو زوّدت plugin أصلي جديد لازم build APK/IPA جديد ونشره من `/download`.

---

## 7) Speech Recognition (المايك الأصلي على الموبايل)

البلَجِن متركّب. التطبيق بيستخدمه أوتوماتيك على الموبايل ويرجع لـ Web Speech في المتصفح.

أضف الصلاحيات:

**Android** (`android/app/src/main/AndroidManifest.xml`):
```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
```

**iOS** (`ios/App/App/Info.plist`):
```xml
<key>NSSpeechRecognitionUsageDescription</key>
<string>للتعرف على الكلام لما تتكلم مع المساعد X</string>
<key>NSMicrophoneUsageDescription</key>
<string>عشان تسجل صوت للمساعد X</string>
```

ابعد كده `npx cap sync` وابني التطبيق تاني.
