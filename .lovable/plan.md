# خطة تحويل التطبيق لتطبيق أصلي متعدد المنصات

## النظرة العامة
تحويل التطبيق الحالي (Web/PWA) إلى تطبيق أصلي يمكن تثبيته على Android, iOS, Windows, macOS بدون متاجر، مع تحديثات فورية OTA من خلال Lovable، وإصلاح الصوت في البوت.

---

## 1. التغليف لتطبيق أصلي (Capacitor)

استخدام **Capacitor** (نفس تقنية واتساب وتطبيقات كبيرة) لتغليف الـ web build في تطبيق أصلي.

**الناتج النهائي:**
- **Android**: ملف `.apk` مباشر — المستخدم بينزله ويثبته (يفعّل "Install from unknown sources" مرة واحدة)
- **iOS**: ملف `.ipa` — يتثبت عبر AltStore أو Sideloadly (مجاني لكن محتاج توقيع كل 7 أيام بحساب Apple ID مجاني)، أو TestFlight لو احتجنا حل أنظف
- **Windows**: ملف `.exe` عبر Electron wrapper
- **macOS**: ملف `.dmg` عبر Electron wrapper

**ملاحظة مهمة عن iOS:** بدون حساب مطور Apple ($99/سنة) أي توزيع خارج App Store محدود. أنصح إضافة TestFlight لاحقًا لو احتجت توزيع iOS احترافي.

---

## 2. التحديثات الفورية OTA (Capgo)

ربط **Capgo** (مجاني لحد 1000 جهاز شهريًا) عشان لما ترفع تحديث من Lovable:
1. سكربت build بيرفع الـ web bundle لـ Capgo تلقائيًا
2. كل الأجهزة المثبت عليها التطبيق بتشيك على التحديث وبتنزله في الخلفية
3. إشعار push (عبر Supabase + OneSignal/Firebase) بيتبعت لكل الموظفين: "في تحديث جديد متاح"
4. التحديث بيتفعل عند فتح التطبيق التالي

**ميزة كبيرة:** التحديث بيوصل في دقائق بدون مراجعة متاجر، وبدون ما الموظف يعيد تنزيل التطبيق.

---

## 3. الإشعارات بأولوية عالية (حتى لو التطبيق مغلق)

- **Android/iOS**: استخدام `@capacitor/push-notifications` مع Firebase Cloud Messaging (مجاني)
- **Windows/macOS**: إشعارات النظام عبر Electron native notifications
- جدول `push_subscriptions` موجود بالفعل في القاعدة — هنوسعه ليدعم FCM tokens
- الإشعارات هتيجي حتى لو التطبيق مقفول تمامًا (high-priority FCM)

---

## 4. إصلاح الصوت في البوت

المشكلة الحالية: `VoiceMic` بيستخدم Web Speech API بس مش شغّال صح.

**الحل:**
- **STT (صوت → نص)**: Web Speech API مع `lang="ar-EG"` للعربية المصرية و `lang="en-US"` / `lang="en-GB"` للإنجليزي. على الموبايل عبر Capacitor هنستخدم `@capacitor-community/speech-recognition` اللي بيستخدم نظام التشغيل (دقة أعلى بكتير للهجة المصرية)
- **TTS (نص → صوت)**: 
  - افتراضي: `speechSynthesis` الموجود في النظام
  - على iOS/Android: أصوات النظام الأصلية أدق (Siri Arabic, Google TTS Arabic)
  - زر اختيار اللهجة: مصري / أمريكي / بريطاني
- **الردود**: Lovable AI Gateway مع system prompt يجبر اللهجة المصرية في الردود العربية

---

## 5. نظام إشعار التحديثات للموظفين

عند رفع تحديث جديد:
1. سكربت ما بعد build بيرفع لـ Capgo + بيدخل صف في جدول `app_updates` جديد (version, release_notes, published_at)
2. Trigger في Supabase بيبعت notification لكل المستخدمين النشطين
3. Push notification بيوصل لكل الأجهزة
4. أول ما الموظف يفتح التطبيق: dialog "تحديث جديد متاح — إيه الجديد؟" مع release notes

---

## 6. الخطوات التنفيذية (بالترتيب)

1. **تثبيت Capacitor** وإضافة منصات Android + iOS
2. **إصلاح إعدادات Vite** (`base: './'`) عشان يشتغل في `file://`
3. **إعداد Capgo** — حساب مجاني، إضافة plugin، وإعداد سكربت رفع
4. **إعداد Firebase Cloud Messaging** للإشعارات (الـ project ID مجاني)
5. **إنشاء جدول `app_updates`** + trigger إشعارات
6. **إصلاح `VoiceMic`** بـ STT/TTS صح + اختيار اللهجة
7. **بناء Electron wrapper** لويندوز وماك
8. **توفير صفحة تنزيل داخلية** (`/download`) فيها كل الملفات للموظفين

---

## التفاصيل التقنية

- **Capacitor 6** + `@capacitor/android` + `@capacitor/ios`
- **Capgo plugin**: `@capgo/capacitor-updater`
- **Push**: `@capacitor/push-notifications` + Firebase Admin SDK في server function
- **Voice native**: `@capacitor-community/speech-recognition`
- **Desktop**: Electron + `@electron/packager`
- **CI build**: سكربت `npm run build:mobile` يبني الـ web + يرفع لـ Capgo + يحدّث جدول `app_updates`

---

## ما يحتاج منك:
1. **Firebase**: حساب مجاني (5 دقايق) — هتديني الـ `google-services.json` و `GoogleService-Info.plist`
2. **Capgo**: حساب مجاني — API key
3. **(اختياري) Apple Developer**: لو عاوز iOS احترافي عبر TestFlight ($99/سنة)
4. **أيقونة التطبيق + Splash screen** (PNG 1024×1024)

---

## ملاحظة عن المدة
التنفيذ كبير وهيتقسم على عدة مراحل. أقترح نبدأ بالمرحلة الأولى (Capacitor + Android APK + إصلاح الصوت) لأنها الأهم وبتغطي معظم الموظفين، وبعدين iOS/Desktop/OTA.

هل تأكدلي إني أبدأ بالمرحلة الأولى، ولا تحب نخطط تفاصيل أكثر؟
