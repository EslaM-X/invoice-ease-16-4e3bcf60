# Give the Team Chat much more breathing room

## Root cause
Two hard caps are squeezing the chat:
1. `AppShell` wraps every page in `<main class="mx-auto w-full max-w-7xl ...">` (max 1280px). The chat's negative margins (`md:-mx-8`) only cancel padding — they can't escape the 7xl cap. On a 1440p+ screen there's a big empty gutter on both sides.
2. Message bubbles in `src/components/chat/message-bubble.tsx` are capped at `lg:max-w-[56%]` — so even when the container widens, each message stays narrow.

## Changes (UI/layout only, no logic)

### 1. Let team-chat break out of the 7xl cap
In `src/routes/team-chat.tsx`, change the outer wrapper so on `md+` the chat spans the full viewport width (matching WhatsApp Web):
- Replace `md:-mx-8 lg:-mx-8` with a real breakout: `md:w-screen md:relative md:left-1/2 md:right-1/2 md:-ml-[50vw] md:-mr-[50vw]` (or an equivalent full-bleed pattern). Keep the mobile card look untouched.
- Result: sidebar + messages fill the entire browser width on desktop, not just 1280px.

### 2. Widen message bubbles
In `src/components/chat/message-bubble.tsx` line 149, replace:
`max-w-[85%] sm:max-w-[68%] md:max-w-[62%] lg:max-w-[56%]`
with a wider, pixel-capped scale so bubbles grow with the pane but stay readable:
`max-w-[88%] sm:max-w-[78%] md:max-w-[72%] lg:max-w-[68%] xl:max-w-[820px] 2xl:max-w-[960px]`.

### 3. Rebalance sidebar vs message pane
Keep the sidebar caps the same (`md:w-[340px] lg:w-[380px] xl:w-[420px]`) — since the outer container is now full-viewport, all the extra width flows into the message pane.

### 4. Density default nudge (optional, safe)
Leave the density preference untouched, but ensure the "Compact" mode's row padding stays tight so users who want even more messages on screen get them via the existing density switcher.

## Verification
- Load `/team-chat` on desktop: chat should touch both edges of the viewport (minus the app sidebar) like WhatsApp Web.
- Send a long message: bubble should now stretch noticeably wider on lg/xl/2xl screens.
- Mobile view unchanged (rounded card, single pane).
- Typecheck passes.
