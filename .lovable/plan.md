# Full‑Width WhatsApp‑Style Team Chat

## Goal
`/team-chat` currently lives inside `AppShell`'s centered `max-w-7xl` main with generous padding, and the chat card itself is capped at `min(100dvh − 8rem)`. On a laptop that leaves a small window showing only 1–2 messages. Make the chat page fill the viewport edge‑to‑edge like WhatsApp Web: wide sidebar, tall message area, more messages visible, larger avatars, comfortable spacing on desktop while keeping mobile behavior intact.

## What changes

1. **Break out of `AppShell`'s centered main for this route only.**
   - In `src/routes/team-chat.tsx`, wrap the chat in a full‑bleed container that negates the parent `max-w-7xl` and padding on `md+` (e.g. a wrapper that uses `md:-mx-6 lg:-mx-8 md:-my-8` and removes horizontal padding), so the chat spans the full width between the sidebar/topbar and the screen edge.
   - Keep mobile untouched (padded, single column).

2. **Fill the available vertical space.**
   - Replace `height: min(calc(100dvh − 8rem), …)` with a taller target: on `md+` use `h-[calc(100dvh-4rem)]` (only the top nav is subtracted); on mobile keep the current safe value so the bottom tabbar isn't hidden.
   - Drop the outer `rounded-2xl border shadow-lg` on `md+` so the panel truly reaches the edges (keep rounded corners on mobile).

3. **Wider, WhatsApp‑style sidebar + roomier conversation pane.**
   - Sidebar: `md:w-80` → `md:w-[340px] lg:w-[380px] xl:w-[420px]`, with `shrink-0`.
   - Conversation pane: keep `flex-1 min-w-0` so it takes all remaining width.
   - Message list max content width: cap bubble column at `max-w-[820px] mx-auto` inside the scroll area on `lg+` so lines stay readable on ultrawide screens without shrinking the pane itself.

4. **Bigger, clearer avatars and header.**
   - Sidebar room avatars: keep 74px, add a bit more row padding (`p-3.5`) so they sit like WhatsApp rows.
   - Active chat header avatar: bump to 84px on `md+`, add a subtle 1px gold ring; header height a touch taller (`py-3.5`).
   - Message bubble sender avatar: 54 → 60px on `md+`; group bubble max width raised to `max-w-[68%] md:max-w-[62%] lg:max-w-[56%]` so bubbles feel airy.

5. **Composer + input polish to match WhatsApp density.**
   - Give the composer a slightly taller min‑height and 12px vertical padding; keep the send/mic buttons the same size.
   - Message list vertical rhythm: `space-y-1.5` → `space-y-2 md:space-y-2.5`, section padding `p-3 sm:p-4` → `p-4 md:p-6`.

6. **Preserve everything else.**
   - No changes to data flow, realtime, wallpapers, members sheet, notifications, search, or emoji.
   - RTL, mobile drawer behavior (`hidden md:flex` / `flex md:hidden`) untouched.

## Technical notes
- Only `src/routes/team-chat.tsx` needs edits — no `AppShell` change (this keeps every other page centered). The negative‑margin trick is a scoped opt‑out for this single route.
- Message bubble sizing lives in `src/components/chat/message-bubble.tsx`; adjust the two width/avatar tokens there.
- Verify with the preview at desktop (WhatsApp‑like edge‑to‑edge with 10+ visible messages), tablet, and mobile (unchanged single‑pane feel).

## Out of scope
- No new features (calls, threads, pinned messages, etc.).
- No design‑token or color changes; still Noir & Gold.
