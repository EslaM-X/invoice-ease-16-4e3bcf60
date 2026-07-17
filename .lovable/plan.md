## Goal
Add a distinctive, luxury "My Tasks from Leadership" (مهامي من القيادة) card to the dashboard, visible **only** for:
- `esraa@steinheim-eg.com`
- `f.hesham@steinheim-eg.com`

Card is split in two halves showing tasks assigned by:
- **Left/Right half A** — CEO: `k.elsharbatly@steinheim-eg.com` (المدير التنفيذي · CEO)
- **Half B** — E. Hesham: `e.hesham@steinheim-eg.com` (proposed title: **مدير العمليات — COO** — this is the standard global abbreviation for Chief Operating Officer and is stronger than "BOM" which usually means Bill of Materials in manufacturing software; recommend **COO**)

Placement on `/dashboard`: directly **before** the "Smart Closure Suggestions" card and the "Open invoices / Partial delivery" strip.

## What the card shows

Header (always visible even with zero tasks):
- Two circular gold-ringed avatars (real profile photo from `profiles.avatar_url`, fallback initials) for CEO + COO, name + role chip under each.
- Live indicator when a new task lands (subtle glow pulse for ~10s on the half that received it).

Filters (top bar of the card):
- **Priority**: الكل · عاجلة · عالية · عادية · منخفضة
- **Status**: الكل · قيد الانتظار · قيد التنفيذ · منجزة

Body — two columns (stacked on mobile), each showing all tasks assigned by that leader to the current user (no cap — scroll inside the card so 20+ tasks stay usable):
- Title, description, priority chip (color-coded), status chip, due date (with overdue amber/red), created at.
- Assigner mini-avatar + role label on each task.
- Click a task → opens the existing task detail view on `/tasks`.

Empty half: shows the assigner's avatar + role + "لا مهام حالياً" in muted gold — card stays present, not hidden.

New-task highlight: when `tasks_notify` realtime event arrives for the current user from that assigner, the half briefly "lights up" (gold glow + soft ring animation) to grab attention.

## Visual style
Noir & Gold, matches existing `noir-surface` + `gold-hairline` tokens. Distinctive from other dashboard cards via:
- Dual-portrait header with concentric gold rings
- Vertical gold hairline divider between the two halves
- Priority chips use existing task palette; overdue rows get amber left-border
- Subtle gold shimmer on the card frame so it reads as "special"

## Access & data

New file `src/components/leadership-tasks-card.tsx`:
- Visibility gate: `useEffectiveUser().email` in the allowlist `["esraa@steinheim-eg.com", "f.hesham@steinheim-eg.com"]`. Respects impersonation — matches how other gates in the app work.
- Data: query `tasks` where `assignee_id = me` and `assigned_by IN (ceo_id, coo_id)`; resolve the two leader UUIDs from `profiles` by email once on mount.
- Live updates via `useRealtimeTable("tasks", …)` with `uniqueRealtimeTopic` (per the project's realtime rules).
- Titles/roles pulled from `profiles.display_name` / a small local role map (CEO / COO); avatars from `profiles.avatar_url` via existing `team-profiles` cache.

Dashboard wiring in `src/routes/dashboard.tsx`:
- Render `<LeadershipTasksCard />` immediately before the Smart Closure Suggestions / open-invoices strip.
- Component self-hides for anyone outside the two allowed accounts, so it doesn't need a new UI-prefs entry.

## Title recommendation
Use **COO** (Chief Operating Officer, "مدير العمليات") instead of BOM. BOM in operations software almost always means "Bill of Materials" and would be confusing. COO is the internationally recognized #2-after-CEO title.

## Out of scope
- No changes to task creation flow, RLS, or the `/tasks` page.
- No new tables or migrations.
- No changes to other users' dashboards.

## Files
- New: `src/components/leadership-tasks-card.tsx`
- Edit: `src/routes/dashboard.tsx` (single import + one JSX insertion)
