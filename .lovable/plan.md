# Chat: date separators + smart typing + mobile Telegram-like polish

Three additions on top of the existing `src/routes/team-chat.tsx` chat, all responsive and mobile-first.

## 1) WhatsApp-style date separators inside the message list

Add a sticky, centered date chip that appears before the first message of each day, computed from `message.created_at` in the user's local timezone.

Labels (bilingual, RTL-aware):
- Today → "اليوم" / "Today"
- Yesterday → "أمس" / "Yesterday"
- Within last 7 days → weekday name (e.g. "الاثنين" / "Monday")
- Older → localized full date (e.g. "12 يوليو 2026")

Rendering rules:
- Injected as virtual rows inside the existing virtualized list so scroll offsets, history-prepend preservation, and search jump-to-index keep working.
- The chip that corresponds to the topmost visible day sticks to the top of the viewport as you scroll (WhatsApp behavior), then swaps as the day changes.
- Style matches the current Noir & Gold surface (soft dark pill, gold hairline, subtle blur), sized down on mobile.

## 2) Smart "typing…" indicator

Replaces the current "X, Y typing…" text with a live, animated indicator both in the header and above the composer.

Behavior:
- 1 typer → "أحمد يكتب الآن…" / "Ahmed is typing…"
- 2 typers → "أحمد ومحمد يكتبان الآن…" / "Ahmed and Mohamed are typing…"
- 3 typers → "أحمد ومحمد و+1 يكتبون الآن…" / "Ahmed, Mohamed and 1 more are typing…"
- 4+ typers → "عدة أعضاء يكتبون الآن…" / "Several people are typing…"

Visuals:
- Three bouncing dots animation next to the text, disabled automatically under `prefers-reduced-motion`.
- Small round avatars of up to the first 3 typers stack next to the indicator in DMs/rooms.
- In the rooms sidebar, the current row keeps its existing "typing…" hint but upgraded with the animated dots.
- All wording flips correctly in RTL and uses proper Arabic dual/plural forms.

Data source: the existing `useRoomPresence` `typingUserIds` — no schema change.

## 3) Telegram-like mobile experience (phones only)

Applied only under `md` breakpoint; desktop stays as it is today.

Navigation model:
- Single active pane: on mobile the sidebar and the chat never show side-by-side.
- Room list is the default view. Tapping a room slides the chat pane in from the inline-end side (RTL-aware) with a short, smooth transition; a back arrow in the chat header slides back to the list.
- Uses the browser history stack so the phone back gesture returns to the list instead of leaving the page.

Layout & density on phones:
- Full-viewport chat surface (`100dvh`), safe-area padding for notch/home indicator.
- Denser header (avatar 40px, single-line title with truncation, subtitle shows online/last seen or the smart typing text).
- Message bubbles use up to ~78% width, tighter vertical spacing, larger tap targets (44px min).
- Composer pinned to the bottom above the on-screen keyboard, auto-grow up to ~5 lines, mic + attach + emoji as icon-only round buttons.
- Floating "jump to latest" pill sits just above the composer when scrolled up, with unread count.
- Sticky day chip and the smart typing indicator both remain visible and legible on small screens.
- Popup notifier is auto-hidden on phones inside `/team-chat` (it already exists elsewhere in the app), to avoid covering the chat.

## Responsiveness & QA

- Verified across 360, 390, 414, 768, 1024, 1280, 1440, 1920 widths in both LTR and RTL using the existing overflow-guard test hook.
- Reduced-motion honored for slide transitions, typing dots, and sticky-chip swaps.
- No changes to database, RLS, or server functions.

## Technical notes

- Files touched: `src/routes/team-chat.tsx`, `src/components/chat/message-bubble.tsx` (spacing tokens only), new `src/components/chat/day-separator.tsx`, new `src/components/chat/typing-indicator.tsx`, small additions to `src/styles.css` for the sticky chip and bounce animation with reduced-motion guard.
- Virtualizer: day separators become their own row type; `getVirtualItems()` renders either a message row or a separator row based on a precomputed `rows` array `(kind: "msg" | "day", ...)`.
- Sticky chip: an absolutely positioned top overlay reads the top-most visible row's day from the virtualizer's `range` and updates on scroll (throttled via `requestAnimationFrame`).
- Mobile pane switch: a `view: "list" | "chat"` state on `< md`, wired to `history.pushState`/`popstate` so the hardware back button returns to the list; on `md+` both panes render as today.
- No new dependencies; date formatting uses `Intl.DateTimeFormat` with the current locale (`ar` / `en`).
