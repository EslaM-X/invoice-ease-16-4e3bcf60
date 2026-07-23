# مكالمات صوت وفيديو داخل شات الفريق — LiveKit SFU (مفتوح المصدر ومجاني)

## الاختيار التقني (لماذا LiveKit؟)
بعد مقارنة أفضل الحلول المجانية على GitHub:
- **LiveKit** (Apache 2.0, 12k★) — SFU احترافي، مكتبة `@livekit/components-react` جاهزة بواجهة أفخم من واتساب، simulcast + dynacast + adaptive stream + TURN مضمّن، أفضل جودة/زمن استجابة في السوق المفتوح.
- Mediasoup / Ion-SFU / Jitsi — كلها ممتازة لكن Mediasoup DIY بالكامل، Ion أقل نضجًا، Jitsi ثقيل ويصعب دمج واجهته داخل شاتنا.

**التوصية:** LiveKit. مسار مجاني تمامًا عبر أحد الخيارين — نطلب منك الاختيار قبل التطبيق:
- **(أ) LiveKit Cloud Free Tier** — صفر عمليات، 5,000 دقيقة اتصال + 50GB شهريًا مجانًا، TURN عالمي جاهز. أسرع تشغيل.
- **(ب) Self-host** على أي VPS بـ Docker Compose (LiveKit + coturn). صفر تكلفة اشتراك، تحتاج سيرفر.

كلا الخياريْن نفس الكود، الفرق فقط في `LIVEKIT_URL`.

---

## نطاق العمل

### 1. البنية التحتية والأسرار
- إضافة أسرار: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (عبر add_secret).
- تركيب: `livekit-client`, `@livekit/components-react`, `@livekit/components-styles`, `livekit-server-sdk`.
- في حالة Self-host: توثيق `docker-compose.yml` + coturn في `docs/livekit-selfhost.md`.

### 2. قاعدة البيانات (migration جديدة)
- `chat_calls`: `id, room_id, initiator_id, mode ('audio'|'video'), scope ('dm'|'group'), status ('ringing'|'active'|'ended'|'missed'|'declined'|'failed'), livekit_room, started_at, connected_at, ended_at, duration_seconds`.
- `chat_call_participants`: `call_id, user_id, joined_at, left_at, join_status, leave_reason`.
- RLS: القراءة/الكتابة لأعضاء الغرفة فقط عبر `is_room_member(room_id)`؛ INSERT للمنشئ فقط.
- GRANTs الكاملة (authenticated + service_role) حسب سياسة المشروع.
- إضافة الجدولين إلى `supabase_realtime` publication.
- توسعة `chat_messages` بعمود `call_id uuid` + نوع رسالة `call_log` لعرض سطر المكالمة داخل الشات (مثل واتساب: "📞 مكالمة صوت · 3:24").

### 3. الـ Server Functions (`src/lib/calls.functions.ts`)
- `startCall({ roomId, mode, targetUserId? })` — ينشئ `chat_calls`، يصدر LiveKit JWT للمُنشئ، يبثّ إشعار `call:invite` عبر realtime لكل أعضاء الغرفة.
- `joinCall({ callId })` — يتحقق العضوية، يصدر توكن، يحدث `chat_call_participants`.
- `declineCall({ callId })` / `cancelCall({ callId })` — تحديث حالة + رسالة `call_log` نظامية.
- `endCall({ callId })` — عند خروج آخر مشارك.
- Server route عام `src/routes/api/public/livekit/webhook.ts` — يتحقق من توقيع Webhook (LiveKit يستخدم JWT موقّع بـ API secret)، يزامن `status`, `duration_seconds`, `participants` من أحداث `room_started/finished`, `participant_joined/left`. يعامل الجسم كـ untrusted ويتحقق قبل أي كتابة (يستخدم `supabaseAdmin` داخل الـ handler بعد التحقق).

### 4. الواجهة داخل الشات (`src/routes/team-chat.tsx` + مكونات جديدة تحت `src/components/chat/calls/`)
- **زران في هيدر الشات**: 🎤 صوت / 🎥 فيديو (يعملان في DM ومجموعات).
- **`IncomingCallDialog`** — يفتح لكل عضو مدعو، نغمة رنين، صور الأفاتار، Accept/Decline، Auto-miss بعد 30ث.
- **`CallStage`** (Sheet ملء الشاشة) — يستخدم `LiveKitRoom` + `GridLayout` + `ControlBar` + `RoomAudioRenderer` + `ConnectionQualityIndicator`. تخصيص "Noir & Gold" على `@livekit/components-styles`.
- **عناصر التحكم الاحترافية** (كلها من LiveKit): كتم/تشغيل ميكروفون، كاميرا on/off، تبديل الأجهزة (mic/cam/speaker)، مشاركة شاشة، عرض بلاطات/متحدث، رفع اليد، مؤشر جودة الشبكة لكل مشارك، عدّاد مدة المكالمة، أزرار قابلة للمس على الموبايل.
- **`ActiveCallPill`** داخل الشات — "مكالمة جارية · انضم" لمن دخل بعد البدء.
- **`CallLogMessage`** — رسالة inline في الشات: أيقونة، نوع، مدة، قائمة المشاركين، زر "إعادة الاتصال".
- **`CallHistoryPanel`** داخل معلومات الغرفة — سجل كامل بحالات نجحت/فشلت/فائتة/مرفوضة.
- **إشعارات لحظية**: تكامل مع مركز الإشعارات الحالي + Browser Notification API عند خلفية التبويب + صوت رنين متميز + عنوان تبويب وامض.
- **PiP/تصغير**: إمكانية تصغير المكالمة إلى نافذة عائمة قابلة للسحب (استعادة `chat-popup-notifier`) للتصفح داخل الشات أثناء المكالمة.

### 5. جودة الشبكة والاستقرار
- تفعيل Simulcast + Dynacast + Adaptive Stream (افتراضيات LiveKit).
- Opus DTX + FEC للصوت، VP9/AV1 حيث مدعوم، fallback H.264.
- افتراضيات موبايل: كاب 640p @ 24fps، بت‑ريت متكيف.
- Auto-reconnect + resume مع exponential backoff.
- عرض تحذير عند `ConnectionQuality.Poor`.

### 6. الاختبارات والقياس
- **Vitest**: آلة حالة المكالمة، صلاحيات RLS محاكاة، تنسيق المدة، حساب المشاركين، منطق missed vs declined.
- **Playwright E2E**: سياقان متصفح، إنشاء مكالمة → قبول → التحقق من مسارات الصوت/الفيديو منشورة → mute/unmute → hangup → قيد سجل في الشات. مصفوفة LTR/RTL على mobile + desktop.
- **Perf harness** جديد `scripts/call-loadtest.ts` باستخدام `livekit-cli load-test` (أو `@livekit/rtc-node`): يقيس publish latency, packet loss %, reconnect time لـ N مشاركين. GitHub Action `.github/workflows/call-perf.yml` يشغّله عند وجود أسرار staging (يتخطى بأمان إن لم توجد).

---

## تفاصيل تقنية (للمرجع)

### Auth للتوكن
LiveKit JWT يُوقّع بـ `LIVEKIT_API_SECRET` داخل `.handler()` فقط. TTL = 6 ساعات. `identity` = `user.id`، `name` = display name، grants = `roomJoin`, `room = livekit_room`, `canPublish=true`, `canSubscribe=true`.

### أمان الـ Webhook
`Authorization: <JWT>` من LiveKit — نتحقق `iss = LIVEKIT_API_KEY` + توقيع HMAC-SHA256 بـ secret، ثم `timingSafeEqual`. أي فشل → 401 بدون جسم.

### تدفق المكالمة
```text
initiator → startCall RPC → chat_calls(ringing) + livekit token + realtime broadcast
   ↓
invitees ← IncomingCallDialog ← realtime "call:invite"
   ↓ accept
joinCall RPC → token → LiveKitRoom connect
   ↓
webhook participant_joined → status=active, connected_at
   ↓ آخر مشارك يخرج
webhook room_finished → status=ended, duration → CallLogMessage inserted
```

### ملفات جديدة/معدّلة (تقريبية)
- migration واحدة جديدة
- `src/lib/calls.functions.ts` (جديد)
- `src/routes/api/public/livekit/webhook.ts` (جديد)
- `src/components/chat/calls/{CallStage,IncomingCallDialog,ActiveCallPill,CallLogMessage,CallHistoryPanel,CallControls,useIncomingCall}.tsx` (جديد)
- `src/routes/team-chat.tsx` (تعديل: أزرار + hooks)
- `src/lib/chat.functions.ts` (تعديل: قراءة `call_log` messages)
- `tests/calls-*.test.ts`, `tests/e2e/team-chat-calls.spec.ts`, `.github/workflows/call-perf.yml` (جديد)

---

## قبل البدء — سؤال واحد
عند الموافقة سأطلب منك اختيار مسار الاستضافة (Cloud مجاني أم Self-host)، ثم أطلب الأسرار الثلاثة عبر add_secret وأبدأ التنفيذ بالترتيب: migration → server functions → webhook → واجهة → اختبارات.
