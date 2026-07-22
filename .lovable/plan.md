## الوضع الحالي المؤكد

- `src/routes/team-chat.tsx` (540 سطر) — تصميم بسيط، فقاعات نص/صوت، حذف. من غير: ردود فعل، رد اقتباس، تعديل، تفاعل لحظي للتايبينج/online، ايموجي، صور/مرفقات، حركة "pop" عند وصول رسالة، تحميل تدريجي للرسائل القديمة.
- `src/components/chat/voice-recorder.tsx` و `voice-player.tsx` موجودين لكن التصميم بسيط.
- الجداول في DB جاهزة: `chat_messages`, `chat_rooms`, `chat_room_members`, `chat_presence` (5 أعمدة)، `chat_reactions` (5 أعمدة). يعني الـ presence والـ reactions موجودين لكن مش مستخدمين في الـ UI.
- `src/lib/chat.functions.ts` بيرجع الرسائل بدون pagination (كل شيء دفعة واحدة) وبدون ردود الفعل ولا reply_to.

## الرؤية

شات على مستوى Messenger/WhatsApp — بصريًا فاخر (Noir & Gold متسق مع باقي التطبيق) + سرعة إحساسية (optimistic + pop animation) + ميزات محادثة كاملة (ايموجي، ردود فعل، رد اقتباس، تايبينج، online، مرفقات)، مع تجاوب صارم لكل الشاشات والأجهزة.

## الخطة

### 1) تصميم بصري متكامل (Prestige Chat)

- **الليست الجانبية**: كروت محادثات "زجاجية" على gradient أسود، شارة ذهبية للـ unread، مؤشر نقطة خضراء للـ online، اسم آخر مرسِل + معاينة أذكى (يعرض "🎤 رسالة صوتية" / "📎 صورة" / نص مقتصّ).
- **رأس المحادثة**: أفاتار مع حلقة ذهبية، اسم + شارة الدور، حالة (متصل الآن / آخر ظهور HH:MM / يكتب…) بلون متحرّك.
- **فقاعات الرسائل**: 
  - رسائلي: gradient ذهبي على أسود مع حواف داخلية ناعمة.
  - الآخرون: زجاج داكن (bg-white/5 backdrop-blur) مع حد بذهبي شفاف.
  - الطابع الزمني يظهر hover فقط في الديسكتوب، دائم في الموبايل.
  - "ذيل" الفقاعة (tail) للأولى في كل مجموعة متتالية من نفس المرسل.
  - علامة استلام/قراءة (✓ / ✓✓) على رسائلي.

### 2) حركة "Pop" على الرسائل الواردة

- كل رسالة جديدة (سواء مني أو ورادة) تدخل بـ `scale 0.9 → 1` + `translateY 8px → 0` + `opacity` خلال 220ms مع easing spring-like.
- الرسائل الواردة من الطرف الآخر تضيف "pulse" ذهبي خافت حول الفقاعة لمرة واحدة + صوت اختياري (mute افتراضيًا).
- تُنفَّذ عبر Framer Motion (`AnimatePresence` + `layout`) مع دعم `prefers-reduced-motion` للأجهزة الضعيفة.

### 3) Composer احترافي

- Textarea تلقائي الارتفاع (سطر → 5 أسطر) مع Enter=إرسال، Shift+Enter=سطر جديد.
- **Emoji Picker**: زر يفتح لوحة (استخدام `emoji-mart` أو مكوّن بديل خفيف — نختار الأخف). آخر 8 ايموجي مستخدمة مثبتة أعلى.
- **زر مرفقات**: صور فقط في هذه المرحلة (رفع لـ storage bucket `chat-attachments`)، مع Preview ومسح قبل الإرسال.
- **زر الصوت**: يبقى VoiceRecorder، ماركوب أنيق (Waveform أثناء التسجيل + عدّاد ذهبي)، سحب لليسار للإلغاء (على الموبايل).
- **رد اقتباس (Reply)**: من قائمة الرسالة "…" → يظهر شريط أعلى الـ composer باسم المرسل ومقتطف، يُلغى بـ X.
- **مؤشر أنا بكتب**: كتابة أول حرف تحدّث `chat_presence` (throttled 3s) → الطرف الآخر يرى "يكتب…" متحركة.

### 4) تفاعلات الرسالة (long-press على الموبايل / hover على الديسكتوب)

- **Reactions**: 6 ايموجي سريعة (❤ 👍 😂 😮 😢 🙏) + "…" لبقية الايموجي، تحفظ في `chat_reactions`، تعرض كـ chips أسفل الفقاعة مع عدّاد.
- **Reply**: يفتح الاقتباس في الـ composer.
- **Copy**: نسخ النص للحافظة.
- **Delete**: حالي، بتصميم أفضل (Modal بدل confirm).

### 5) الحضور (Presence) اللحظي

- عند دخول الصفحة: heartbeat لـ `chat_presence` كل 25s (online=true, last_seen=now).
- عند مغادرة/إغلاق التبويب: `visibilitychange` → online=false.
- Realtime subscription على `chat_presence` → تحديث نقطة الأخضر + "آخر ظهور" في القائمة الجانبية ورأس المحادثة.
- "يكتب…" مستقل: عمود `typing_room_id` في `chat_presence` (لو مش موجود نضيفه)، يُصفَّى تلقائيًا بعد 5s سكون.

### 6) الأداء وسلاسة التمرير

- **Optimistic send**: الرسالة تظهر فورًا كـ pending (opacity 0.6)، تُثبَّت عند نجاح الـ RPC، تُظهر ✓ / ✓✓ مع الوقت.
- **Pagination بالـ scroll**: `listChatMessages` تُعدَّل تقبل `before_created_at` و `limit=50`، نحمّل القديم عند التمرير لأعلى.
- **Virtualization خفيف** فقط لو الرسائل > 200 (نتفادى overkill لأداء الأجهزة الضعيفة).
- **Debounced invalidations** — بدل invalidate على كل realtime event، نجمع.

### 7) التجاوب الكامل

- **موبايل**: القائمة الجانبية تختفي عند فتح محادثة (زي WhatsApp)، زر رجوع في الرأس. الـ Composer sticky مع safe-area padding (`env(safe-area-inset-bottom)`) لـ iOS.
- **تابلت**: عرض مقسّم 40/60.
- **ديسكتوب**: 320px / بقية الشاشة، حد أقصى 1400px متمركز.
- **iOS/Android WebView**: نتحاشى `100vh` (نستخدم `100dvh` + `-webkit-fill-available`)، ونعالج keyboard resize.
- **ديسكتوب Electron (Mac/Windows)**: نفس التخطيط، مع hover states كاملة.
- كل الأيقونات والأزرار hit-area ≥ 40×40 على اللمس.

### 8) الوصولية والتوطين

- كل الأزرار لها `aria-label` عربي/إنجليزي.
- RTL كامل (الفقاعات، ذيل الفقاعة، اتجاه الأنيميشن).
- كيبورد: Tab بين العناصر، Esc يلغي الرد، Cmd/Ctrl+Enter إرسال في الشاشات الكبيرة.

## الملفات المتأثرة

- Migration جديد: إضافة `chat_messages.reply_to_id` (nullable FK)، `chat_messages.attachments jsonb`، `chat_presence.typing_room_id`، `chat_presence.updated_at`، وbucket جديد `chat-attachments` مع policies. تحديث `listChatMessages` RPC/functions لتشمل `reactions` و `reply_to` snapshot، ودعم pagination.
- تحديث `src/lib/chat.functions.ts` — دوال: `addReaction`, `removeReaction`, `updatePresence`, `setTyping`, `uploadAttachment`, `sendChatMessage` (يقبل reply_to + attachments)، pagination للـ `listChatMessages`.
- تعديل `src/routes/team-chat.tsx` — إعادة بناء مع تقسيم لمكوّنات فرعية:
  - `src/components/chat/chat-sidebar.tsx`
  - `src/components/chat/chat-header.tsx`
  - `src/components/chat/message-bubble.tsx` (مع Reactions + Reply + Menu)
  - `src/components/chat/message-list.tsx` (pagination + auto-scroll + pop animation)
  - `src/components/chat/composer.tsx` (Emoji + Attachment + Voice + Reply bar)
  - `src/components/chat/emoji-picker.tsx` (خفيف، محلي)
  - `src/components/chat/typing-indicator.tsx`
  - `src/components/chat/presence-dot.tsx`
- تحديث `src/components/chat/voice-recorder.tsx` و `voice-player.tsx` بواجهة Waveform + عدّاد ذهبي.
- إضافة `src/lib/use-presence.ts` — Hook للتزامن اللحظي للـ presence والـ typing.
- إضافة حزمة: `framer-motion` (لو مش موجودة) + `emoji-mart` أو مكوّن أخف نختاره أثناء التنفيذ.

## معايير القبول

- الرسائل الواردة تدخل بـ pop واضح ≤ 250ms على الأجهزة الحديثة، بدون flicker على الضعيفة (reduce-motion).
- الايموجي والمرفقات والرد وردود الفعل تعمل ثنائي الاتجاه بين حسابين في نفس اللحظة (Realtime ≤ 500ms).
- "يكتب…" يظهر عند الطرف الآخر خلال ≤ 1s ويختفي خلال ≤ 5s من التوقف.
- Layout سليم على 320px حتى 2560px، بدون scroll أفقي، composer ما يختفي وراء كيبورد iOS.
- Send optimistic — لا انتظار مرئي أكثر من 50ms قبل ظهور الرسالة عند المرسل.
- كل مكوّن جديد فيه dark + light mode متطابق مع باقي التطبيق (Noir & Gold).

## خارج النطاق (نتفق قبل التنفيذ)

- المكالمات الصوتية/الفيديو.
- الرسائل المشفّرة end-to-end.
- Reply threads متداخلة (نكتفي بمستوى رد واحد).
- Stories / Statuses.
