## الهدف
تحويل كارتَي "لا توجد ... بانتظار الموافقة" من كارتات بيضاء عامة إلى لوحات Noir & Gold فاخرة متسقة مع باقي التطبيق — اتجاه **Noir Panels** الذي اخترته.

## الملفات المعدَّلة
- `src/components/pending-accounts-card.tsx` — استبدال فرع `rows.length === 0`.
- `src/components/distributor-approvals-card.tsx` — استبدال فرع `rows.length === 0`.

## البنية البصرية (لكلا الكارتين)
- **الحاوية**: `noir-surface` بحواف `rounded-xl`، خط ذهبي بحدود `border-[hsl(var(--gold))]/20`، وظل داخلي فاخر.
- **هالة ذهبية خارجية**: طبقة `absolute -inset-0.5 blur` بلون ذهبي خفيف تشتعل عند hover.
- **شريط تدرّج ذهبي** يمين الكارت (RTL) بعمق ناعم `from-gold/5 to-transparent`.
- **ميدالية أيقونة 56px**: دائرة noir بحد ذهبي + `blur` هالة خلفية + أيقونة ذهبية:
  - كارت الحسابات → `BadgeCheck` (lucide).
  - كارت فواتير الموزعين → `ReceiptText` (lucide).
- **العنوان**: `text-foreground` بحجم `text-base sm:text-lg` — يحافظ على نص الـ Arabic كما هو (لا توجد طلبات حسابات بانتظار الموافقة / لا توجد فواتير موزّعين بانتظار الموافقة).
- **السطر الفرعي**: نقطة ذهبية نابضة `1px` + النص الحالي عن الـ realtime.
- **شارة الحالة** (مخفية على الموبايل، `hidden md:inline-flex`): كبسولة صغيرة بحد ذهبي شفاف ونص uppercase tracking-widest — "Realtime Sync" للحسابات و "Verified" للموزعين، مع نسخة عربية عبر `isAr` (مزامنة فورية / موثّق).

## Motion & A11y
- انتقالات `duration-500` على الهالة والحد.
- النقطة النابضة تستخدم `animate-pulse` — يحترمها `prefers-reduced-motion` تلقائيًا في Tailwind config الحالي (بدون keyframes مخصصة).
- ألوان ذهبية من متغيرات `--gold` الموجودة في `styles.css` (لا ألوان مبرمجة hex في JSX — نستخدم `hsl(var(--gold))` وopacity utilities).

## Guardrails
- ارتفاع الكارت ~88–96px — يظل صف حالة مضغوطًا لا hero.
- بدون تغيير في المنطق أو الاستعلامات أو النصوص العربية الأصلية.
- الكارتان متطابقان بصريًا (variant واحد بأيقونة مختلفة) للحفاظ على الاتساق.
