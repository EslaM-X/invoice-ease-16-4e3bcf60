
# خطة التنفيذ: WhatsApp Bot + الشات الداخلي

سنبني المرحلتين بالتوازي. الكلام التقني في آخر القسم.

---

## القرار التقني الأهم: مزوّد WhatsApp

اخترتلك **WhatsApp Cloud API الرسمي من Meta** للأسباب دي:
- **مجاني فعلياً** (أول 1000 محادثة خدمة/شهر مجاناً، وردود العملاء على رسايلهم خلال 24 ساعة مجانية بالكامل).
- الوحيد اللي **مش هيتقفل** ولا يتعطّل، لأن رقمك بيتسجّل رسمياً.
- بيدعم إرسال PDF تلقائي، أزرار تفاعلية، قوائم، صور.
- بيشتغل مع n8n/أي webhook بسهولة.

### المتطلبات اللي محتاج تجهزها (مرة واحدة بس):
1. **حساب Meta Business Manager** (مجاني — business.facebook.com).
2. **رقم 01223998124 يكون مش متسجّل حالياً على واتس اب أو واتس اب بيزنس** على الموبايل (لازم تشيله من أي تطبيق قبل ما نسجّله في Cloud API).
3. تتأكد إن الرقم يقدر يستقبل SMS أو مكالمة للتحقق.
4. بعد ما تجهز ده، الـ Lovable Cloud هيخزن: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.

> لو الرقم ده مستخدم حالياً على واتس اب بيزنس وعليه شغل، فيه طريقة هجرة بنعملها بحيث ما يضيعش الشات القديم لكنها بتحتاج downtime ~10 دقايق.

---

## المرحلة 1: WhatsApp Bot (Backend + Frontend)

### Backend (TanStack server functions + routes)

**1. Webhook endpoint عام يستقبل من Meta**
- `/api/public/whatsapp/webhook` — GET للـ verification + POST لاستقبال الرسايل.
- بيتحقق من توقيع Meta (`x-hub-signature-256`) باستخدام `WHATSAPP_APP_SECRET`.

**2. معالج الرسائل الذكي (`processIncomingMessage`)**
- يحفظ الرسالة في `whatsapp_messages`.
- يحدد/ينشئ العميل في جدول `customers` بناءً على رقمه (E.164).
- يربط المحادثة بـ `whatsapp_conversations` (thread).
- يستدعي AI gateway (`google/gemini-2.5-flash`) مع:
  - history كامل للمحادثة.
  - tools (function-calling) فيها:
    - `search_products(query)` — بيرجّع منتجات+سعر+مخزون من `products` و `price_list_items`.
    - `create_quote(customer_phone, items[])` — ينشئ فاتورة `status='draft'` ويرجّع رابط PDF.
    - `confirm_order(invoice_id)` — يحوّل draft → completed، يطلق inventory deduction، ويبعت PDF الفاتورة + محضر الاستلام.
    - `open_support_ticket(category, description)` — `category` ∈ {صيانة, ضمان, خط ساخن}.
    - `lookup_invoice(invoice_number_or_serial)`.

**3. مولّد PDF تلقائي على السيرفر**
- نستخدم `@react-pdf/renderer` (شغّال على Cloudflare Worker) — مفيش Puppeteer.
- نفس قوالب الـ PDF اللي عندك في صفحات `/invoices` و `/delivery-receipts` بس نحوّلها لـ React-PDF components.
- نرفع الـ PDF لـ Supabase Storage bucket `invoices-pdf` (private) ونبعت signed URL للعميل عبر واتس اب.

**4. مرسل الرسايل (`sendWhatsAppMessage`)**
- POST لـ `graph.facebook.com/v21.0/{phone_number_id}/messages`.
- بيدعم: text, document (PDF), template (للرسايل خارج الـ 24 ساعة), interactive buttons.

**5. نظام Tickets/Queue**
- جدول `support_tickets` (category, priority, status, customer_id, assigned_to).
- لما العميل يطلب صيانة/ضمان، البوت يفتح ticket تلقائي، يضيفه لقائمة الانتظار حسب الـ category، ويبعتله رقم الـ ticket ومدة الانتظار التقديرية.
- إشعار يطلع للموظف المختص في الـ Notifications (موجود عندك بالفعل).

### Frontend
- صفحة جديدة `/whatsapp` (داخل الـ sidebar) فيها:
  - **Inbox**: كل المحادثات الواردة (مع unread count) — UI شبيه بواتس اب.
  - **Conversation view**: messages, إرسال يدوي، إرفاق ملف، تحويل لموظف.
  - **Templates manager**: قوالب الرسايل الموافق عليها من Meta.
  - **Tickets dashboard**: قوائم الصيانة/الضمان/الخط الساخن مع SLA.
  - **Settings tab**: حالة الاتصال + إعدادات البوت (auto-reply on/off, working hours).

### قواعد الأمان
- Webhook signature verification إجباري (يرفض أي request مش من Meta).
- Rate limiting على إنشاء الفواتير عبر البوت (max 5/دقيقة/رقم).
- العميل لازم يأكّد الطلب بزر "تأكيد الطلب" قبل خصم المخزون فعلياً.

---

## المرحلة 2: الشات الداخلي للموظفين (لحظي)

### قاعدة البيانات
جداول جديدة:
- `chat_rooms` (id, type ∈ {direct, group}, name, avatar, created_by).
- `chat_room_members` (room_id, user_id, role, last_read_at).
- `chat_messages` (id, room_id, sender_id, body, attachments[], voice_note_url, reply_to_id, created_at, edited_at).
- `chat_reactions` (message_id, user_id, emoji).
- `chat_presence` (user_id, status, last_seen_at).

كل الجداول عليها RLS: المستخدم يشوف الرسايل بس في الـ rooms اللي هو عضو فيها، وأعضاء `company_members` بس يقدروا ينشئوا rooms.

### Realtime
- نفعّل Supabase Realtime على `chat_messages` و `chat_presence`.
- الـ frontend يفتح channel واحد لكل room المستخدم فيه.

### Storage
- bucket `chat-attachments` (private) — كل ملف path: `{room_id}/{message_id}/{filename}`.
- bucket `chat-voice-notes` — voice notes mp3/opus, recorded بـ MediaRecorder API.

### Frontend
صفحة `/team-chat` فيها:
- **Sidebar**: قائمة rooms (direct + groups) مع آخر رسالة + unread badge + online dot.
- **Chat window**: messages list (مع virtualization), typing indicator, reply, react, voice notes (record + playback waveform).
- **New chat/group**: modal فيه list of company members.
- **File uploader**: drag-drop + preview للصور.
- **Notifications**: Browser notifications + in-app toast + badge في الـ sidebar الرئيسي.
- **سجل كامل**: search في كل المحادثات (Postgres full-text search).

---

## ترتيب التنفيذ (نشتغل بالتوازي على Phase 1 + Phase 2)

### Sprint 1 (الأساسات)
1. Migration: كل الجداول الجديدة (whatsapp_*, chat_*, support_tickets) + RLS + Storage buckets.
2. WhatsApp webhook + signature verification + رسالة "Hello World" يدوية للتأكد.
3. Chat: rooms + messages + Realtime + UI أساسي يبعت text بس.

### Sprint 2 (الذكاء + الإرسال)
4. AI tool-calling للبوت (`search_products`, `lookup_invoice`).
5. PDF generation (`@react-pdf/renderer`) للفاتورة ومحضر الاستلام + upload لـ Storage.
6. Chat: file upload + voice notes + presence + notifications.

### Sprint 3 (الأتمتة الكاملة)
7. `create_quote` + `confirm_order` tools مع خصم المخزون.
8. Tickets system + auto-routing للموظفين + SLA timers.
9. WhatsApp inbox UI كامل + templates manager.
10. تجربة end-to-end + توثيق "إزاي تجهز Meta Business".

---

## التفاصيل التقنية (للمراجعة لو حابب)

**Architecture**: كل الـ backend هيكون TanStack server functions (`createServerFn`) + server routes تحت `/api/public/whatsapp/*` للـ webhooks. مفيش Supabase Edge Functions جديدة.

**AI**: `google/gemini-2.5-flash` (سريع ورخيص للمحادثات اليومية) مع fallback لـ `google/gemini-2.5-pro` للطلبات المعقدة. كل tool فيه Zod schema للـ inputs.

**PDF**: `@react-pdf/renderer` (pure JS, شغّال على Worker). لو احتجنا fonts عربية، هنرفع Cairo/Tajawal كـ assets ونعملها embed.

**Voice notes**: `MediaRecorder API` في الـ browser → blob → upload لـ Storage → `<audio>` للـ playback. مفيش transcoding سيرفر-side.

**Realtime**: Supabase Realtime على `postgres_changes` events. الـ presence من `presence` channel built-in.

**Notifications**: نستخدم جدول `notifications` الموجود + browser Notification API + service worker للـ PWA push (لو حابب لاحقاً).

**Secrets المطلوبة (هطلبهم بعد موافقتك):**
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`  
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_VERIFY_TOKEN` (string عشوائي بنخترعه)

**حد ميزانية متوقع:**
- WhatsApp Cloud API: مجاني للحجم ده.
- AI Gateway: متوسط 200-500 محادثة/شهر ≈ شبه مجاني على Lovable AI.
- Storage (PDFs + chat files + voice notes): يدخل في حدود Lovable Cloud المجانية لحد ~1GB.

**حاجات هنأجلها لـ v2:**
- مكالمات صوت/فيديو (طلبت تأجيلها).
- WhatsApp templates approval automation (هنعمل templates يدوي أول مرة).
- AI تحليل الصور اللي العميل يبعتها (ممكن نضيف بسهولة بعدين بـ Gemini Vision).

---

لما توافق على الخطة، أبدأ فوراً بـ Sprint 1 (الـ migrations + webhook + chat الأساسي). وقبل ما أبدأ كود الـ WhatsApp فعلياً هطلب منك الـ 5 secrets بتوع Meta.
