# خطة التنفيذ — على مراحل

نظراً لحجم العمل، سأقسم على **3 مراحل**. كل مرحلة قابلة للاختبار قبل الانتقال للي بعدها.

---

## المرحلة 1 — أساس التصميم بنمط iOS + التجاوب الكامل (أولاً)

**الهدف**: واجهة تحس إنها iOS فاخرة (iOS 18 style) — زجاجية، ناعمة، متجاوبة لكل المقاسات من 320px لحد 4K، مع الحفاظ على الهوية الحالية والألوان.

تعديلات:
- **`src/styles.css`**: إضافة tokens جديدة (glass blur, soft shadows, spring easing, safe-area insets, larger touch targets ≥44px)، تحسين typography scale، dynamic type.
- **`src/components/app-shell.tsx`**: تحويل الـ navigation للتاب-بار سفلي على الموبايل بنمط iOS (translucent + blur)، وsidebar مدمج على الديسكتوب.
- **`src/components/luxury-splash.tsx`** + **`page-transition.tsx`**: انتقالات spring بنمط iOS.
- صفحة **`dashboard.tsx`**: إعادة تنظيم الكروت بـ stacked cards على الموبايل، grid على الديسكتوب، haptic feedback عند اللمس، pull-to-refresh.
- كروت بـ rounded-3xl، blur backgrounds، subtle gradients مع نفس الألوان الحالية.

**الناتج**: تطبيق يحس iOS-native على الموبايل، فاخر على الديسكتوب، متجاوب على كل المقاسات.

---

## المرحلة 2 — هيكل المساعد X (Foundation)

**الهدف**: تأسيس بنية المساعد قبل ما نضيف الصلاحيات الكاملة.

تعديلات:
- **DB migrations**: 
  - `x_conversations` (محادثات بـ user_id + title + created_at)
  - `x_messages` (role, content, tool_calls, conversation_id)
  - `x_user_profile` (يحلل شخصية المستخدم — preferences, tone, common queries)
- **Server function `chatWithX`** (`src/lib/x-assistant.functions.ts`):
  - يستخدم Lovable AI Gateway مع `google/gemini-3-pro-preview` (متوسع وقوي زي Gemini)
  - Streaming via async generator
  - System prompt يعرف كل قسم بالتطبيق (Invoices, Inventory, Customers, POs, Reports...)
  - يحفظ المحادثات تلقائي
- **زر عائم (FAB) "X"** في `app-shell` — أيقونة دائرية فاخرة مع gradient.
- **شيت محادثة** بنمط iOS Messages — fullscreen على الموبايل، side-panel على الديسكتوب.
- صلاحيات قراءة فقط في البداية: يقدر يستفسر عن المبيعات/الفواتير/المخزون.

**الناتج**: تقدر تفتح X وتسأله "كم مبيعات اليوم؟" أو "اشرحلي صفحة الفواتير" ويرد بـ streaming.

---

## المرحلة 3 — صلاحيات تنفيذ + صوت + تحليل شخصية

**الهدف**: X يبقى مساعد كامل زي Gemini.

تعديلات:
- **Tool calling**: تعريف tools للـ AI:
  - `create_invoice`, `add_product`, `add_customer`, `update_*`, `delete_*` (مع dialog تأكيد قبل التنفيذ)
  - `search_anything`, `navigate_to`, `explain_screen`
- **محادثة صوتية كاملة**: 
  - استخدام **ElevenLabs Conversational Agents** (WebRTC) — أسرع وأطبيعي للمحادثة الكاملة
  - زر mic في شيت X يفتح conversation session
  - Voice activity detection + interruption support
  - يحتاج `ELEVENLABS_API_KEY` كـ secret
- **تحليل الشخصية**: 
  - بعد كل محادثة، server function يحدث `x_user_profile` (tone preference, frequently asked topics, business priorities)
  - System prompt في كل request يشمل ملخص الشخصية → ردود متجاوبة معاك شخصياً
- **ذاكرة طويلة المدى**: Embeddings للمحادثات القديمة + semantic search للسياق

**الناتج**: X مساعد ذكي حقيقي — صوتي، نصي، منفذ للمهام، عارف شخصيتك ومتطورها معاك.

---

## ملاحظات تقنية

- Lovable AI (مجاني محدود) كافي للمرحلة 2. ElevenLabs مدفوع — هطلب الـ API key وقت المرحلة 3.
- كل المهام التنفيذية (المرحلة 3) هتحترم RLS الموجودة وصلاحيات المستخدم — admin يقدر يحذف، عادي لأ.
- التصميم الجديد مش هيغير الألوان/اللوجو/الهوية، بس هيرفع مستوى الـ polish.

---

**أبدأ بالمرحلة 1 دلوقتي؟** وبعد ما تختبرها وتوافق، نعدي للمرحلة 2.