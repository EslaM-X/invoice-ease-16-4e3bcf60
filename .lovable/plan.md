# تطبيق تصميم Prestige Glass Noir على شارة الشحنة القادمة

## المكان
`src/components/closeable-invoices-card.tsx` — السطر 153-167 (الشارة اللي بتظهر تحت بطاقة "اقتراحات الإقفال الذكية" وبتعرض: `qty · ETA · PO code 🚚`).

## التنفيذ (Frontend فقط)

### 1. إعادة تصميم الشارة (Prestige Glass Noir)
- سطح `noir-surface` أسود زجاجي مع `backdrop-blur` وحواف `gold-hairline`.
- **فقاعة كمية ذهبية** يسار الشارة: دائرة صغيرة `bg-gradient-to-br from-[#e8c76a] to-[#c9a84c]` بأرقام سوداء عريضة `font-display`.
- **فاصل ذهبي رفيع** (`w-px h-4 bg-[#c9a84c]/30`) بين الأقسام لتقسيم بصري راقي.
- **قسم التاريخ**: أيقونة `Calendar` رمادية صغيرة + التاريخ بخط `tabular-nums` أبيض ناعم مع label صغير "ETA" بلون ذهبي متلاشي فوقه.
- **قسم كود PO**: كود بخط `font-mono` ذهبي (`text-[#c9a84c]`) داخل شريط `bg-[#c9a84c]/10` مع hairline.
- **أيقونة الشحن** (Truck/Plane/Ship) في دائرة ذهبية شفافة على اليمين مع micro-glow.
- استبدال ألوان `violet/sky/amber` القديمة بنظام Noir & Gold موحّد، مع الحفاظ على تمييز نوع الشحنة بلون accent صغير على أيقونة الشحن فقط (ذهبي/فيروزي/كهرماني).

### 2. حركات وتفاعل
- `noir-press` + `noir-ripple` + `focus-gold` على كل شارة.
- Hover: gold glow ناعم `hover:shadow-[0_0_20px_-4px_#c9a84c]/40` + رفعة `-translate-y-0.5`.
- انتقالات `motion-reduce:transition-none` لاحترام تفضيلات النظام.
- `tabIndex={0}` و `aria-label` وصفي للقارئ (مثلاً: "PO D2, ETA 4/27/2026, 2 invoices").

### 3. تحسينات مصاحبة
- زيادة gap بين الشارات (`gap-2.5`) وpadding داخلي أوسع (`px-3.5 py-2.5`).
- إضافة عنوان صغير فوق الشريط: "الشحنات المرتبطة" / "Linked shipments" بخط ذهبي uppercase tracking-wider.
- Scroll horizontally مع gradient fade على الأطراف للإشارة لوجود المزيد.

## تفاصيل تقنية
- ملف واحد فقط: `src/components/closeable-invoices-card.tsx`.
- بدون تغيير في بيانات `incomingSlots` أو منطق `shipIcon`/`shipTone` (يتم استبدال `shipTone` بنظام Noir موحّد).
- بدون تغييرات backend أو database.
- التزام كامل بـ `prefers-reduced-motion` و RTL.
