## Telegram-class Chat Overhaul

Rebuild the Internal Team Chat to feel like a modern messenger (Telegram/WhatsApp), with a luxury "Studio" look, precise real-time signals, and app-wide notifications.

### 1. Read receipts (sent / delivered / seen)
- New table `chat_message_reads (message_id, user_id, room_id, read_at)` with RLS scoped to room members.
- Auto-mark messages as `read` when their bubble becomes visible using an IntersectionObserver in the message list.
- Bubble icons (gold double-check when seen, silver single-check when delivered, clock when queued). Long-press / hover shows the list of members who saw the message with time.

### 2. In-chat search
- Search box in the room header (already present) becomes functional: server function `searchRoomMessages(roomId, q)` running `ilike` with a highlighted snippet.
- Result list shows sender, snippet, time; clicking a result scrolls to the message and briefly highlights it (yellow-gold pulse).
- Scope strictly limited to the currently open room (RLS + explicit `.eq('room_id', roomId)`).

### 3. Optimistic UI + offline queue
- `useChatOutbox` hook stores pending messages in `localStorage` keyed by room. Every send goes through the outbox first (renders instantly with a "clock" icon), then flushes to the server.
- Exponential backoff retry (2s → 4s → 8s → 30s cap), triggered on `online` event, on window focus, and every 15s while online.
- On success, replace the local temp message with the persisted one; on permanent failure, show "Retry" / "Delete" on the bubble.

### 4. Voice notes
- Reuse the existing `voice-recorder.tsx` component; add upload to a private Supabase Storage bucket `chat-voice-notes` (RLS: only room members read).
- Messages of type `voice` store `{ storage_path, duration_ms, waveform_peaks[] }` in `chat_messages.metadata`.
- In-bubble player with waveform, playback speed (1×/1.5×/2×), and auto-advance to the next unheard voice note.

### 5. Push notifications
- Register a service worker (`public/sw.js`) that handles `push` events; user opt-in via a bell button in chat header.
- Store subscriptions in existing `push_subscriptions` table; keep only rows matching the current `endpoint`.
- New server function `sendChatPush(messageId)` triggered by database trigger via `pg_net` → `/api/public/chat/push` route, using VAPID keys stored in secrets.
- Respect user preference (`user_notification_preferences.chat_push_enabled`) and skip notifications if the recipient's presence shows the room already open.

### 6. Studio-grade UI overhaul
- Larger user avatars (56px in list, 40px in bubble), gold ring + subtle glow, animated presence dot (green pulse for online, amber for idle, grey for offline).
- Fix hover toolbar: replace the current white-bg pill with a `glass-noir` toolbar (`bg-black/70 backdrop-blur border-white/10 text-platinum`) that keeps the message readable.
- Message bubbles: refined spacing, tail on first bubble in a streak only, sender name colored by role (CEO/COO/CFO tokens), grouped consecutive messages, timestamps float on hover.
- Room list becomes a "Studio Sidebar" with unread badges, last-message preview, typing indicator inline, and pinned rooms at the top.
- Smooth `framer-motion` transitions for send, receive, and delete.

### 7. Group room settings
- "Group Info" dialog (opened by tapping the room title) for group rooms:
  - Set / change room avatar (uploaded to `chat-room-avatars` bucket, admin only).
  - Rename room, edit description.
  - Member list with role badges, promote/demote to admin, remove member.
  - Leave room button.
- New columns on `chat_rooms`: `avatar_url`, `description`; new column on `chat_room_members`: `is_admin`.

### 8. Chat wallpapers (per user, per room)
- `user_ui_preferences` gains `chat_wallpaper` JSON: `{ default: string, perRoom: Record<roomId, string> }`.
- Wallpaper picker inside the group/room settings sheet with 8 luxury presets (Noir marble, Gold satin, Midnight silk, etc.) plus solid colors.
- Applied as a fixed background layer behind the message list, respecting light/dark themes.

### 9. Global "message popup" (app-wide toast)
- `ChatPopoverProvider` mounted in `__root.tsx` subscribes once to all rooms the user belongs to.
- When a new message arrives and the target room is NOT currently visible, a floating card appears bottom-right (bottom-left in RTL) with:
  - Sender avatar, name, role badge, room name, snippet, timestamp.
  - Click → navigate to `/team-chat?room=<id>` and scroll to message.
  - Dismiss (×) or "Mute for 1h" per notification.
  - Auto-dismiss after 6s, stacks up to 3, extras collapse into "+N more".
- Deduped by message id; suppressed while the tab is hidden (push handles that path instead).

### 10. Robustness
- Wrap all realtime channels in `useEffect` with cleanup, unique topics per user+room to avoid cross-tab collisions.
- Convert every server function to `.functions.ts` (client-safe) with `requireSupabaseAuth`, verifying room membership on every read/write.
- Add loading skeletons and error toasts everywhere; never leave the composer/toolbar in an indeterminate state.

---

### Technical outline

Database (single migration):
```text
chat_message_reads (message_id, user_id, room_id, read_at)
chat_rooms +avatar_url +description
chat_room_members +is_admin
user_ui_preferences.chat_wallpaper (jsonb)
user_notification_preferences.chat_push_enabled (bool)
storage buckets: chat-voice-notes (private), chat-room-avatars (public read)
RLS + GRANTs + policies scoped via is_room_member(room_id) security-definer helper
trigger notify_chat_message_push -> pg_net POST to /api/public/chat/push
```

Files to add:
```text
src/lib/chat-reads.functions.ts
src/lib/chat-search.functions.ts
src/lib/chat-push.functions.ts
src/lib/use-chat-outbox.ts
src/lib/use-chat-popover.tsx  (provider + hook)
src/components/chat/read-receipt-icon.tsx
src/components/chat/message-search.tsx
src/components/chat/group-settings-dialog.tsx
src/components/chat/wallpaper-picker.tsx
src/components/chat/global-message-popover.tsx
public/sw.js
src/routes/api/public/chat/push.ts
```

Files to edit:
```text
src/routes/team-chat.tsx           (studio sidebar, virtualized message list, search, wallpaper)
src/components/chat/message-bubble.tsx (read receipts, glass-noir toolbar, grouping)
src/components/chat/composer.tsx   (outbox integration, voice + attach polish)
src/routes/__root.tsx              (mount ChatPopoverProvider)
src/lib/chat.functions.ts          (add membership checks, mark-as-read, upload voice, push subscribe)
```

### Rollout order
1. Migration (tables, columns, storage buckets, RLS, trigger).
2. Read receipts + optimistic outbox + search (core messenger parity).
3. Voice notes upload/playback polish.
4. Studio UI pass (bubbles, sidebar, avatars, hover toolbar fix, wallpapers).
5. Group settings dialog.
6. Global popover provider + push notifications (service worker + VAPID).
7. Final QA: multi-user smoke test via Playwright (two sessions), verify receipts, popovers, offline queue.

I'll ask for the VAPID public/private keys (or generate them and store via `add_secret`) when we reach step 6 — the rest needs no additional input.
