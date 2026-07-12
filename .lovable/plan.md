## Force Latin suffixes (K/M/B/T) in all money cards

**Problem:** In Arabic, `fmtMoneyAdaptive` uses `Intl.NumberFormat("ar-EG", { notation: "compact" })` which outputs Arabic letters (م for million, ألف for thousand, مليار for billion). User wants Latin `M/K/B/T` always.

**Change:** In `src/lib/utils-money.ts` (`fmtMoneyAdaptive`), stop delegating the compact suffix to `Intl` for Arabic. Always format the number with Latin suffixes:
- ≥ 1e12 → `X.XXT`
- ≥ 1e9 → `X.XXB`
- ≥ 1e6 → `X.XXM`
- ≥ 1e3 (only if we currently compact at this threshold) → `X.XXK`
- otherwise → full number

Keep locale for the currency symbol/prefix ("EGP") and the digit rendering of the mantissa (respect the existing `ltr-nums` / tabular behavior). Only the suffix is forced to Latin.

The `fullValue` (used in tooltips and sub-line) keeps the normal locale-formatted full amount — no change there.

**Files:**
- `src/lib/utils-money.ts` — patch `fmtMoneyAdaptive`.

No other files need edits; the dashboard/KPI cards already consume the returned `short` string.