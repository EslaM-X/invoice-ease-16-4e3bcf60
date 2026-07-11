## Goal
Display the signed-in user's profile avatar (`profiles.avatar_url`) inside the Noir & Gold dashboard hero header, positioned above the "فاتورة جديدة" button, without removing or shrinking any existing content.

## Design
- Luxury circular avatar (56–64px) with:
  - Double gold ring: outer `#c9a84c/60` hairline + inner black separator + soft ambient gold glow.
  - Subtle rotating conic-gradient gold aura on hover.
  - Live green status dot (bottom-right) matching the existing "مباشر" indicator.
  - Fallback: gold-tinted initials on noir surface when no `avatar_url`.
- Placement: inside the actions column of the hero (`src/routes/dashboard.tsx`), stacked ABOVE the button row — right-aligned in RTL so it sits directly over "فاتورة جديدة". A tiny gold hairline separator between avatar and buttons.
- Reuses existing shadcn `Avatar` primitive; wrapped in `noir-press` + `focus-gold` and links to `/settings` (profile edit) with `aria-label`.
- Fully respects `prefers-reduced-motion` (aura disabled).

## Data
- Fetch once on mount in `dashboard.tsx`: `supabase.from("profiles").select("avatar_url, display_name").eq("user_id", user.id).maybeSingle()`.
- Store in local state; no schema change needed.

## Files
- `src/routes/dashboard.tsx` — add avatar fetch + render block above the buttons row inside the hero card. No other markup touched; greeting, name, title, live badge, buttons, and low-stock alert remain identical.

## Non-goals
- No change to buttons, greeting, low-stock alert, KPI cards, or any numbers/data.
- No new tables, policies, or routes.
