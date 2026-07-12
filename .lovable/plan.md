
## Goal

1. Kill the perceived lag on `/dashboard` where KPI numbers stay at `0` / blank until the user scrolls down and back up.
2. Make the **Total Sales** card (and the other money KPIs) render huge numbers (up to billions of EGP) with zero clipping, zero truncation, and no loss of luxury look.

Scope is **frontend + presentation only** — no DB, RLS, or business‑logic changes.

---

## Part 1 — Instant, lag‑free dashboard

### What causes the lag today (from reading the code)

`src/routes/dashboard.tsx` and every child card (`CloseableInvoicesCard`, `PendingAccountsCard`, `DistributorApprovalsCard`, `IncomingShipmentsStrip`, `PoShipmentsTracker`, `SalesOverview`, `TopProductsInteractive`, `ActivityFeed`, plus `useSuggestionsLive`) all mount at once and each fire their own heavy queries + open their own realtime channels in parallel. Result:

- The main thread is blocked for a beat, so `stats` stays at its initial `0` values and the KPI grid paints as `0`.
- When queries finally resolve, React batches updates and paints — the user coincidentally has already scrolled by then, so it looks like “the numbers only appear after I scroll.”
- No skeleton state on the KPI grid, so `0` is shown as if it were real data (worst kind of lag — silent).

### Fixes (in `src/routes/dashboard.tsx` unless noted)

1. **Track a real loading state** on the dashboard.
   - Add `const [loaded, setLoaded] = useState(false)` and set it at the end of `load()` (in `finally`).
   - Pass `loading={!loaded}` to `NoirKpiCard` (it already supports a shimmer skeleton) and render skeleton bars for the `InventoryValueCard` values instead of literal `0` / empty text. No more silent “0 while loading.”

2. **Show cached data first, then refresh.**
   - Wrap the KPI query set in a tiny `sessionStorage` cache (key per user id) so a return visit paints instant last‑known numbers, then `load()` refreshes in the background (SWR pattern already used elsewhere via `cachedListFetch`). Only skeleton when there is truly no cache.

3. **Split the load into two waves so the top of the page paints first.**
   - Wave A (await, drives KPI grid + hero): invoices summary + customers count + products stock.
   - Wave B (fire‑and‑forget after paint via `requestIdleCallback` fallback to `setTimeout(0)`): defective items, settings row, latest USD rate. These only feed the second row of cards and can arrive a tick later.
   - `setStats` gets called twice (partial, then full) so the first row lights up almost immediately.

4. **Defer heavy child cards below the fold until they’re near the viewport.**
   - Introduce a small local helper `<LazyMount rootMargin="600px">{children}</LazyMount>` (IntersectionObserver, mounts once, SSR‑safe by mounting immediately when IO is missing).
   - Wrap the below‑the‑fold sections: `PoShipmentsTracker`, `SalesOverview`, the recent‑invoices + `TopProductsInteractive` row, and `ActivityFeed`.
   - Above the fold (hero, low‑stock alert, KPI grid, Closeable / Pending / Distributor cards, Incoming shipments) mounts eagerly so the user sees a complete top instantly.

5. **Coalesce realtime storms.**
   - The dashboard already uses `useBatchedRealtimeTables`. Bump its debounce for this page to `{ debounceMs: 800, maxWaitMs: 2500 }` so a burst of inserts doesn’t restart the whole load chain mid‑paint.
   - Ensure `scheduleRealtimeRefresh` never fires while a `load()` is already in‑flight (add an `inFlight` ref).

6. **Kill the initial layout thrash.**
   - Add `min-height` reservations to the KPI grid and each below‑the‑fold section (via a wrapper `div` with an explicit height class) so lazy mounts don’t cause the page to jump — that jump is part of why users think the page is “still loading” when they scroll.
   - Keep the existing `.stagger` animation but disable it on the very first paint when we already have cached data (add `data-first-paint` attribute swap) — prevents the KPI grid from animating in when it should feel instant.

Result: the KPI numbers appear within the first paint (from cache) or within the first Wave A tick (fresh), skeletons instead of `0`s while fetching, and the rest of the page streams in without blocking the top.

---

## Part 2 — Total Sales card that scales to billions

### What breaks today

`NoirKpiCard` renders the value as `font-display text-2xl sm:text-3xl` with `tabular-nums` inside a 2‑col grid on mobile (`grid-cols-2 lg:grid-cols-3`). Strings like `EGP 2,779,517.50` already push the width; `EGP 1,234,567,890.50` will overflow, clip, or wrap awkwardly next to the icon.

### Fixes

1. **Smart money formatter** — add `fmtMoneyAdaptive(amount, currency, lang)` in `src/lib/utils-money.ts`:
   - `< 1,000,000` → full number (`EGP 987,540.00`).
   - `≥ 1,000,000` → compact form with 2 significant decimals: `EGP 2.78M`, `EGP 1.23B`, localized suffixes in Arabic (`م`, `ب`).
   - Return `{ short, full }` so we can show `short` and expose `full` via `title` + `aria-label`.

2. **Upgrade `NoirKpiCard`** (`src/components/noir-kpi-card.tsx`) to accept an optional `fullValue?: string` and:
   - Render `value` in a `<span>` with `title={fullValue}` and `aria-label` using the full amount so screen readers + hover tooltip keep the exact figure.
   - Give the value container `min-w-0 truncate` protection *and* a fluid font size using `clamp()` (e.g. `clamp(1.25rem, 4.5vw, 1.875rem)` for mobile, tighter tracking for long strings) so the number itself scales down before it ever clips.
   - Move the icon slot to `self-start` and let the value row use `flex-1 min-w-0` so long amounts always get the full remaining width.

3. **Dashboard wiring**:
   - For the `total_sales` card, pass `value={short}` and `fullValue={full}` from `fmtMoneyAdaptive(stats.sales, "EGP", lang)`.
   - Same treatment for the two “Inventory at cost / at sale price” tiles in `InventoryValueCard` (they’ll hit the same billion‑scale problem).
   - Under the compact number, add a tiny second line “≈ EGP 2,779,517.50” in muted 10px tabular‑nums whenever we compacted — power users still see the exact figure without hovering, and the card stays luxurious.

4. **Guardrails** — add `break-words` + `overflow-hidden` on the value wrapper, and `overflow-hidden` on the card root, so even in a worst‑case (RTL + very long localized suffix) nothing spills outside the gold border.

Visual identity stays 100% Noir & Gold — same shimmer hairline, glow, tone chips, and typography. Only the size behavior changes.

---

## Files touched

- `src/routes/dashboard.tsx` — loading state, cached first paint, two‑wave load, `LazyMount` for below‑the‑fold, realtime debounce tuning, use of the new formatter.
- `src/components/noir-kpi-card.tsx` — `fullValue` prop, fluid clamp sizing, tooltip/aria, overflow guardrails.
- `src/lib/utils-money.ts` — new `fmtMoneyAdaptive` helper (pure add, non‑breaking).
- `src/components/lazy-mount.tsx` — new tiny SSR‑safe `IntersectionObserver` wrapper.

No changes to queries, RLS, tables, or any backend logic.

---

## How we’ll verify

- Reload `/dashboard` with a cold cache: KPI grid shows shimmering skeletons, then real numbers within one frame after Wave A resolves — never a literal `0`.
- Reload with a warm cache: numbers appear on first paint, background refresh updates silently.
- Scroll test: no more “numbers only after scrolling” — everything above the fold is done before the user can scroll.
- Force `stats.sales = 1_234_567_890.5` in devtools: card shows `EGP 1.23B` with `≈ EGP 1,234,567,890.50` beneath, tooltip = full value, no clipping in either LTR or RTL, at 320px, 375px, 768px, and 1440px widths.
