## Scope

Redesign four blocks on `/profits` shown in the screenshot into a fully Noir & Gold, luxury/editorial experience — same data, same interactions, richer surface:

1. Reconciliation alert banner ("تنبيه: يوجد فرق…")
2. Shipping/exclusions footnote line
3. "التحقق والمطابقة" collapsible panel
4. "اتجاه صافي الربح اليومي" trend chart card

No new features, no data logic changes — only visual craft.

## Direction

Signature language borrowed from the app's Noir & Gold identity:
- Dark ink card surfaces with subtle gold hairlines (`ring-1 ring-primary/15`), soft radial gold glow in the corner
- Serif display accents for section titles (uses the existing display font stack) with a thin gold rule underneath
- Semantic status color kept (emerald = ok, amber/rose = review), but softened into gradient washes rather than flat pastels
- Tabular monospaced digits everywhere, tighter tracking on labels
- Micro-badges become gold-outlined pills; icons sit in circular tinted haloes

## Block-by-block

### 1. Reconciliation alert banner

Turn the flat red/green strip into a **status ribbon card**:

- Left: circular halo icon (ShieldCheck for ok, AlertTriangle for review) with matching ring
- Center: two-line stack — bold title + fine caption (`التقارير · الأرباح · الفرق`) with tabular digits
- Right: three inline mini-stats laid out as a horizontal micro-table with vertical dividers (Reports / Profits / Variance), each with a whisper label above the number
- Background: `bg-gradient-to-l from-rose-500/[0.06] via-transparent to-rose-500/[0.03]` (or emerald variant), thin gold-tinted top border, soft inner shadow
- On mobile it collapses to stacked rows preserving the three mini-stats

### 2. Shipping footnote

Promote from muted paragraph to a **quiet meta strip**:

- Small `Info` icon in a circle, italicised label, key numbers rendered as inline monospaced chips (e.g. `52 بند`, `52 فاتورة`, `EGP 13,000.00`) so the eye can scan without reading
- Placed as a subtle divider band between KPIs and the verification panel

### 3. Verification & Reconciliation panel

Elevate the collapsible into a **ledger card**:

- Header row: gold hairline underline, small serif title, status pill on the far edge, chevron in a subtle circular button
- Expanded body reorganised into two "column-cards" with a vertical gold divider between them on desktop:
  - "مطابقة إجمالي البيع": each row uses a two-column layout with dotted leader line between label and number (classic ledger feel), totals row emphasised with a gold top rule
  - "مطابقة صافي الربح": same treatment; net profit line highlighted with an emerald left-border accent bar
- "سبب الاستبعادات" reformatted from bullet list into a 2×2 grid of tiny cause-cards, each with an icon, one-line title, and inline stat chip
- Card overall gets a faint diagonal noise/paper texture via a CSS gradient, plus a top-right gold glow

### 4. Daily net profit trend chart

Rework into a **hero chart card**:

- Header: serif title on left, right side gets an inline mini-KPI trio (Latest, Peak, Total) with tiny sparklike labels, then the segmented Profit-only/All toggle (redesigned as gold-inset segmented control), then the CSV button styled as a subtle ghost button with icon
- Chart canvas:
  - Replace flat `<Line>` with an area gradient (gold fade for profit, thin dashed lines for revenue/cost when "All")
  - Add horizontal reference line at zero
  - Grid becomes dotted, near-invisible
  - Tooltip restyled: dark card with gold hairline border, tabular digits, weekday + date
  - Empty state upgraded from plain text to a centered whisper illustration (icon + one line)
- Bottom of the card gets a small caption strip: date range shown as "من … إلى …" with tiny arrow between

## Technical notes

- All work lives in `src/routes/profits.tsx` between roughly lines 1414–1593
- Use only existing tokens (`primary`, `emerald-500`, `rose-500`, `amber-500`) and Tailwind utility layering — no new CSS variables required
- Chart tweaks stay within Recharts (`Area` from `recharts`, `ReferenceLine`, custom `Tooltip` content component). `recharts` is already installed and imported in this file
- Segmented control and pills reuse the existing patterns already used elsewhere on the page for consistency
- Zero data / query / calculation changes — same `totalsMatch`, `dailyTrend`, `shippingTotals` inputs
- Keep RTL correctness: dividers, chevrons, and axis orientation continue to swap via `lang === "ar"`

## Out of scope

- Product picker, cost book, KPIs, per-product table (already redesigned in prior turns)
- Any backend / RPC / query change
- Adding new metrics or filters
