# Global draggable chat message popup

Add a floating, draggable in-app popup that appears anywhere in the app when a new team-chat message arrives, with an unread count badge and a high-quality avatar for the room (group avatar) or sender (DM). It replaces the current Sonner toast for chat messages so it doesn't cover other UI and the user can move it wherever they want.

## Files

### New: `src/components/chat/chat-popup-notifier.tsx`
Global overlay component, mounted once in `AppShell`.

Behavior:
- Subscribes to realtime chat inserts (reuses the same subscription pattern already in `use-chat-notifications.ts`); listens only for messages I didn't send in rooms I'm a member of.
- Keeps a small in-memory queue of the last 5 unseen messages, grouped by room.
- Renders a **floating card** (bottom-end by default) with:
  - Room avatar (group) or sender avatar (DM) using the existing `src/lib/avatar-url.ts` HD pipeline (`size=96`, DPR-aware, cache-bust) so quality matches the chat.
  - Room / sender name, last message preview (text / 🎙️ voice / 📷 image / 📎 file).
  - **Unread count badge** on the avatar (total unseen since popup was last opened/dismissed).
  - Small action row: "فتح المحادثة" (opens `/team-chat` and navigates to the specific room via query param `?room=<id>`), Minimize (→ collapses to a floating avatar bubble with just the badge), Close (dismisses until next message).
- **Draggable** with mouse + touch (pointer events). Position is clamped to the viewport and persisted to `localStorage` under `chat-popup-pos`. A tiny grip handle in the header indicates draggability. Uses `position: fixed` and a high `z-index` above dialogs' backdrops but below modal focus traps we own (e.g. `z-[80]`).
- Minimized state is also draggable and persisted (`chat-popup-minimized`).
- Auto-hides while on `/team-chat` (user already sees messages there).
- Respects RTL: default corner is bottom-start for RTL, bottom-end for LTR (but user drag overrides).

Rendering detail for the avatar (matches current chat quality):
- For `room.type === "group"`: use `room.avatar_url` through `hdAvatarUrl(url, { size: 96, dpr: window.devicePixelRatio, bust })`.
- For DMs: fetch the other member's `profiles.avatar_url` via a lightweight cached lookup, same HD pipeline.
- Fallback: gold-ringed initials tile (same styling as members-sheet avatars).

### Edit: `src/hooks/use-chat-notifications.ts`
- Add an optional callback / event emitter (`onIncoming`) so `ChatPopupNotifier` can subscribe without opening a second realtime channel. Simplest: expose a tiny module-level event bus (`chatEvents.emit("message", payload)`) that the hook publishes to and the popup listens on. Keeps a single subscription.
- Remove the Sonner `toast.message(...)` call for chat messages (the popup replaces it). Keep the browser `Notification` for when the tab is unfocused.

### Edit: `src/components/app-shell.tsx`
- Mount `<ChatPopupNotifier />` once inside the shell (after the main outlet) so it appears on every route. Hide when `pathname.startsWith("/team-chat")`.
- Keep the existing sidebar chat-unread badge (`chatUnread`) unchanged.

### Edit: `src/routes/team-chat.tsx`
- On mount, if URL has `?room=<id>`, auto-select that room (small addition; no logic changes to chat).

## Verification
- Send a chat message from another account while browsing a different page: popup appears bottom-corner with room/sender avatar (HD), name, preview, and count badge.
- Drag the popup — it moves smoothly and stays where dropped after reload.
- Minimize it — collapses to a small avatar bubble with badge; still draggable.
- Close it — disappears until the next incoming message.
- On `/team-chat`, popup is not shown.
- Group avatar and DM avatar render at the same crispness as the members sheet (no blur/pixelation).
- No layout shift on other pages; popup uses `position: fixed` and never blocks the AppShell header controls.
