## الهدف
تحسين تجربة شات الفريق على الديسكتوب لرؤية عدد أكبر من الرسائل + سكروول لانهائي + زر العودة لأحدث رسالة + تشخيص أفاتار أعمق (أبعاد فعلية، دعم AVIF/WebP، تحديث تلقائي عند تغير DPR).

---

## 1) كثافة عرض الرسائل (Density)
- إضافة تفضيل `chat_density` في `user_ui_preferences` بقيم: `comfortable | cozy | compact`.
- زر جديد في هيدر الشات (بجانب البحث/الأعضاء) لفتح قائمة اختيار الكثافة، تُحفظ فورًا للمستخدم.
- تطبيق الكثافة عبر CSS variables على حاوية الرسائل:
  - `comfortable`: padding رأسي 10px، gap 12px، حجم خط 15px، حجم أفاتار 60px
  - `cozy` (افتراضي): 6px / 8px / 14px / 52px
  - `compact`: 3px / 4px / 13px / 40px، وإخفاء الأفاتار للرسائل المتتالية من نفس المرسل
- الكثافة تظهر فقط على الديسكتوب؛ الموبايل يبقى ثابتًا للراحة.

## 2) سكروول لانهائي للرسائل الأقدم
- تعديل `chat_list_messages` (server function) لدعم `before` cursor + `limit` (افتراضي 50).
- عند وصول أعلى قائمة الرسائل (IntersectionObserver على sentinel علوي)، جلب الدفعة التالية والحفاظ على موضع السكروول (anchor على أول رسالة مرئية).
- مؤشر تحميل رقيق أعلى القائمة + حالة "لا مزيد من الرسائل" عند النهاية.
- الاشتراك في Realtime للرسائل الجديدة يبقى كما هو ويُلحقها بالأسفل فقط.

## 3) تثبيت مربع الكتابة + زر "العودة لأحدث رسالة"
- الـcomposer يبقى `sticky bottom-0` داخل حاوية الشات مع خلفية بلور.
- تتبع `isAtBottom` (ضمن آخر 120px). لو المستخدم مطوّل لأعلى:
  - يظهر FAB دائري في أسفل يمين منطقة الرسائل ("↓ أحدث الرسائل") مع عدّاد رسائل غير مقروءة جديدة.
  - الضغط يمرّر بسلاسة لأسفل ويعلّم الرسائل مقروءة.
- عند وصول رسالة جديدة والمستخدم بالأسفل → auto-scroll؛ لو لأعلى → يزيد العداد فقط.

## 4) تشخيص الأفاتار المتقدم
تحديث `DiagnosticsPanel` في `members-sheet.tsx`:
- **الأبعاد الفعلية**: قياس `naturalWidth/naturalHeight` بعد تحميل كل صورة ومقارنتها بالمتوقع من رابط HD (`width` param). عرض شارة "مطابق ✓" أو "أقل من المطلوب ⚠️".
- **دعم الصيغ**: كشف دعم AVIF/WebP للمتصفح (عبر `createImageBitmap` على data URI صغير) وعرض ما تم فعليًا تسليمه (من `Content-Type` عبر `fetch HEAD` على رابط HD).
- **تنبيه Fallback**: لو المتصفح يدعم AVIF ولكن السيرفر رجّع JPEG/PNG → شارة تحذير.

## 5) تحديث تلقائي عند تغير DPR
- إضافة hook `useDevicePixelRatio()` يستمع لـ `matchMedia(`(resolution: ${dpr}dppx)`)` ويعيد التقييم عند تغيّر الـZoom/الشاشة.
- عند التغير: استدعاء `refreshAvatars()` تلقائيًا لإعادة توليد روابط بالحجم المناسب للـDPR الجديد.

---

## تفاصيل تقنية
- ملفات ستتغير:
  - `src/routes/team-chat.tsx` — الكثافة، sticky composer، FAB، سكروول لانهائي.
  - `src/components/chat/message-bubble.tsx` — قراءة متغيرات CSS للكثافة.
  - `src/components/chat/members-sheet.tsx` (DiagnosticsPanel) — الأبعاد الفعلية + دعم الصيغ.
  - `src/lib/chat.functions.ts` — دعم `before` cursor في list.
  - `src/lib/avatar-url.ts` — تصدير helper لدعم AVIF/WebP detection.
  - `src/lib/use-dpr.ts` (جديد) — hook DPR.
  - Migration: عمود `chat_density text default 'cozy'` في `user_ui_preferences`.
- بدون تغيير على منطق الأعمال أو صلاحيات الشات.
