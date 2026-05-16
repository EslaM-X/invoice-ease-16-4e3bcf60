
# خطة: X — المساعد الفاخر المتكامل

هدف واحد: نحوّل X من فقاعة شات بسيطة لمساعد يحس إنه **منتج رائد** — شكل أوركسترالي، صوت طبيعي، عربي/إنجليزي بسلاسة، وروح بشرية فيها هزار خفيف.

---

## 1. الهوية البصرية الجديدة (تتناغم مع Steinheim الأسود/الذهبي)

نسيب الـ gradient البنفسجي/الفوشي الحالي (مش متناسق مع هوية التطبيق) ونروح لـ:

- **كرة X العائمة (Orb)**: كرة سوداء عميقة بحلقة ذهبية متحركة (conic-gradient يدور ببطء)، نبض ناعم عند الـ idle، توهج ذهبي عند الـ hover. حجم 64px على الديسكتوب، 56px على الموبايل. تنجذب لحافة الشاشة مع safe-area.
- **لما يتكلم**: الحلقة تنبض مع الـ amplitude للصوت (audio-reactive ring باستخدام `getOutputByteFrequencyData`).
- **شيت المحادثة**: 
  - موبايل: fullscreen مع drag-handle علوي بنمط iOS sheet.
  - ديسكتوب: side-panel 420px بـ glass blur وحدود ذهبية رفيعة.
  - خلفية: gradient أسود → فحمي مع noise texture خفيف.
  - هيدر فيه: اسم X بخط Serif، badge صغير (Online / Thinking / Listening / Speaking)، وأيقونات (محادثة جديدة، سجل، إعدادات الصوت، لغة).

## 2. الذكاء — Tool Calling كامل

نعرّف tools للـ AI (Lovable AI Gateway, `google/gemini-3-pro-preview`):

| Tool | الوصف | يحتاج تأكيد؟ |
|---|---|---|
| `create_invoice` | إنشاء فاتورة جديدة | ✅ Dialog |
| `add_product` / `update_product` / `delete_product` | إدارة منتجات | ✅ Dialog |
| `add_customer` / `update_customer` | إدارة عملاء | ✅ Dialog |
| `create_purchase_order` | أمر شراء | ✅ Dialog |
| `search_anything` | بحث عام (منتج/عميل/فاتورة) | ❌ |
| `get_sales_summary` / `get_stock_status` / `get_profits` | تقارير | ❌ |
| `navigate_to(path)` | تنقّل سريع | ❌ |
| `explain_screen` | شرح صفحة | ❌ |

كل عملية كتابة تحترم RLS وصلاحية المستخدم (admin أو موظف). الـ destructive (حذف) تتطلب biometric/PIN لو متفعّل.

في الـ UI: لما X يقترح عملية، تظهر **بطاقة تأكيد فاخرة** جوّه الشات (مش modal خارجي) — فيها ملخص العملية + زرّيْن «نفّذ» / «ألغِ»، مع animation انزلاق.

## 3. الصوت — محادثة كاملة + TTS مرن

نستخدم **ElevenLabs Conversational Agents (WebRTC)** للمحادثة الحقيقية (interruption + VAD + latency منخفض):

- زر **ميكروفون** كبير في الشيت → يفتح session صوتي.
- موجة صوتية حية (waveform) أسفل الشاشة لما يتكلم — رد فعل بصري على صوت X.
- الـ Agent مُعدّ على ElevenLabs بـ:
  - Voice عربي (أنثى/ذكر — هنختار سوا)
  - System prompt يطابق الشخصية (ودود، محترف، فيه هزار خفيف)
  - Client tools متربطة بنفس الـ tool-calling pipeline
- Fallback نصي شغّال طول الوقت.
- زر تبديل: 🎤 صوت ↔ 💬 نص.

نحتاج: **`ELEVENLABS_API_KEY`** + **`ELEVENLABS_AGENT_ID`** (هنطلبهم لما نوصل).

## 4. ثنائية اللغة الذكية

- X يكتشف لغة الرسالة تلقائياً ويرد بنفسها (مش يعتمد على اللغة المختارة في التطبيق فقط).
- يقدر يخلط (code-switching) لو المستخدم خلط.
- في الصوت: نختار agent multilingual في ElevenLabs (يدعم العربي والإنجليزي في نفس الـ session).
- System prompt يحتوي تعليمات صريحة: «رد بنفس لغة المستخدم. لو سأل بالعربي رد بالعربي، لو إنجليزي رد إنجليزي.»

## 5. الشخصية + الهزار

System prompt جديد:
- **النبرة**: واثق، محترم، ودود، **بيرمي نكتة خفيفة من وقت للتاني** (مش مبالغ فيها)، يستخدم emoji باعتدال.
- **الذاكرة**: يستدعي اسم المستخدم، يفتكر تفضيلاته من `x_user_profile`.
- **الاستباقية**: لو لاحظ مخزون قارب على النفاد وانت بتسأل عن منتج تاني، يقول «بالمناسبة، X خلص تقريباً 👀».
- **التحليل**: بعد كل محادثة، server function يحدّث `x_user_profile` (tone preference, common tasks, business priorities) → يتدمج في system prompt للمحادثة الجاية.

## 6. تفاصيل UX إضافية

- **Quick Actions** في الشاشة الفاضية: 6 بطاقات أنيقة (مبيعات اليوم / إنشاء فاتورة / أقل مخزون / آخر عميل / فتح التقارير / محادثة صوتية).
- **Streaming markdown** مع syntax highlighting للأرقام والعملات.
- **Haptic feedback** على الموبايل (Vibration API) عند الإرسال/الاستلام.
- **Keyboard shortcut**: `⌘K` يفتح X من أي مكان.
- **Mini mode**: لما تقفل الشيت أثناء محادثة صوتية، الكرة تفضل تنبض في الزاوية وتفضل المحادثة شغالة.

---

## التغييرات التقنية (للمراجعة)

```text
src/components/x-assistant.tsx          → إعادة تصميم كامل + تقسيم
  ├── x-orb.tsx                         (الكرة العائمة + audio-reactive)
  ├── x-sheet.tsx                       (الشيت + هيدر + tabs)
  ├── x-voice-panel.tsx                 (محادثة ElevenLabs WebRTC)
  ├── x-tool-confirm-card.tsx           (بطاقة تأكيد العمليات)
  └── x-quick-actions.tsx               (اقتراحات سريعة)

src/lib/x-tools.ts                      → تعريف الـ tools + executors
src/lib/x-assistant.functions.ts        → تحديث system prompt + tool loop + bilingual
src/routes/api/x-chat.ts                → دعم tool_calls + iterations
src/routes/api/x-voice-token.ts         → جديد: يستخرج conversation token من ElevenLabs

DB migration:
  - x_user_profile: إضافة personality_summary, language_preference, humor_level
  - x_tool_audit: جدول لتسجيل كل عملية نفذها X (للتدقيق)
```

---

## الأسرار المطلوبة (لما توافق)

سأطلب منك:
1. `ELEVENLABS_API_KEY` (من elevenlabs.io → Profile → API Keys)
2. `ELEVENLABS_AGENT_ID` (من Agent اللي عملته)

---

## الترتيب المقترح للتنفيذ

1. **إعادة التصميم البصري** (الكرة + الشيت + الهوية الذهبية) — أسرع win بصري.
2. **Tool calling** (read-only tools أولاً: search, navigate, summaries).
3. **Tool calling** (write tools: create/update/delete + بطاقة التأكيد).
4. **محادثة صوتية ElevenLabs** (نطلب الـ secrets هنا).
5. **تحليل الشخصية + الهزار + الذاكرة الطويلة**.

كل مرحلة قابلة للاختبار لوحدها.

**أبدأ بالخطوة 1 (التصميم البصري الجديد) أول حاجة؟**
