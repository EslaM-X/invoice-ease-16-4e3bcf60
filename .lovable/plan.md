# Team Chat — Ultra Upgrade Plan

## 1. "Message Info" popup (who saw / who received)
- Extend the message context menu ("المزيد") in `src/components/chat/message-bubble.tsx` with a new **"معلومات الرسالة"** action (own messages only).
- New dialog `src/components/chat/message-info-dialog.tsx`:
  - **Seen by** — join `chat_message_reads` with `profiles` → avatar, name, seen time.
  - **Delivered to** — room members who are online/were online after send time but haven't read yet (derive from `chat_presence.last_seen_at` ≥ message `created_at`).
  - **Not yet delivered** — remaining members (offline since before send).
  - Live counts at the top: `X شافها • Y وصلته • Z متصل الآن`.
  - Uses existing `useRoomPresence` for live online dot.

## 2. Force-enable notifications for everyone
- On app boot (in `src/routes/team-chat.tsx` + `src/hooks/use-chat-notifications.ts`):
  - Auto-request `Notification.permission` on first mount if `default`.
  - Ignore `user_notification_preferences.chat_muted` for internal team chat — always dispatch browser + push notifications when chat isn't in focus.
  - Web Push: auto-subscribe via existing `use-push-notifications` hook on first visit, no opt-in toggle for team chat.
  - Add a small "🔔 مفعّلة إجبارياً بواسطة الشركة" indicator in chat settings so users know it's mandatory.

## 3. Group members + admin roles
- Migration on `chat_room_members`: add `role text default 'member' check (role in ('admin','member'))`.
- Backfill: room creator → `admin`; **`e.hesham@steinheim-eg.com` → `admin` on every existing and future group room** (trigger on `chat_rooms` insert + one-off backfill).
- New "Members" sheet accessible from the chat header (click room name):
  - Grid of avatars w/ name, job title, online dot, "admin" gold badge.
  - Shows total, online count.
  - Admin actions: promote/demote, remove member (RPC `chat_set_member_role`, `chat_remove_member`).

## 4. Admin-controlled wallpaper for group chats
- New column `chat_rooms.wallpaper jsonb` (`{ type: 'preset'|'custom', preset?, path? }`).
- Wallpaper picker in `src/components/chat/wallpaper-picker.tsx` gains a **"خلفية للجروب كله"** tab (visible only if `role='admin'` in the active room). Writes to `chat_rooms.wallpaper` via new RPC restricted to admins.
- Precedence per user: user per-room override → room admin wallpaper → user default → preset.
- New **"إعادة ضبط الخلفية"** button (already exists for user overrides) also shown to admins to clear room wallpaper.

## 5. Wallpaper editor: before/after + blur + auto tint
- In `src/components/chat/image-cropper.tsx`:
  - Split view toggle: **قبل / بعد** compares original vs cropped+compressed.
  - **↺ تراجع** undoes last crop/rotate/zoom step (history stack).
  - Slider: **تمويه الخلفية (blur 0–20px)** applied via CSS filter, baked into exported JPEG.
  - Auto-tint: sample average color, add subtle bottom gradient so message bubbles stay readable on any image.
  - Zoom slider min lowered to **50%** so users can "zoom out" to fit the whole image with letterbox blur fill.

## 6. Search highlight — customizable
- New user pref `chat_highlight` (`{ enabled: bool, intensity: 'soft'|'normal'|'strong' }`) in `user_ui_preferences`.
- Toggle + intensity chips inside the search bar popover in `src/routes/team-chat.tsx`.
- `.chat-hl` in `src/styles.css` becomes three variants driven by a data attribute on the chat container.
- Also highlight matches inside formatted dates and simple Arabic/English synonyms (e.g. "فاتورة" ↔ "invoice") using a small local synonym map.

## 7. Avatars + message body polish
- Avatars in message list and sidebar: bump to **44px** (mobile) / **52px** (desktop), gold ring, subtle inner shadow, initials fallback with gradient per user hash.
- Message bubbles:
  - Bigger max-width on desktop (min 380 → 560px), better line-height (1.55), automatic paragraph breaks after 3 line-breaks.
  - Long messages (>600 chars) collapse with **"عرض المزيد"** expand.
  - Improved code/quote/link styling; smart RTL/LTR direction detection per line.
  - Softer gradient for own bubbles, glass-noir for others, both with gold hairline.

## 8. Emoji safety
- `.chat-emoji` font stack already prioritises Apple Color Emoji. Add fallback detection: if `Apple Color Emoji` unavailable, load Twemoji via `@emoji-mart` `set='twitter'` at runtime.
- When rendering message text, split into segments (text / emoji / url / code) so the emoji font only applies to emoji graphemes — URLs and inline code keep their monospace/latin styling untouched.

## 9. Responsive & cross-device polish
- Audit `team-chat.tsx` breakpoints: `<640`, `640–1024`, `1024–1440`, `>1440`.
- Mobile: full-screen chat pane, swipe-right returns to room list, safe-area padding for iOS notch, sticky composer above keyboard.
- Tablet: 40/60 split, header collapses room name to popup.
- Desktop ultrawide: cap chat column at 960px, center it, sidebar sticky.
- Test/verify with the Playwright viewport helper at 360, 768, 1280, 1920.

## Technical Notes
- **DB migrations** (single migration, with GRANTs + RLS):
  - `alter table chat_room_members add column role text ...`
  - `alter table chat_rooms add column wallpaper jsonb`
  - RPCs: `chat_set_member_role`, `chat_remove_member`, `chat_set_room_wallpaper` (admin-only, security definer).
  - Trigger: on `chat_rooms` insert of type `group`, auto-insert `e.hesham@steinheim-eg.com` as admin member.
- **New files**: `src/components/chat/message-info-dialog.tsx`, `src/components/chat/members-sheet.tsx`.
- **Edited files**: `message-bubble.tsx`, `wallpaper-picker.tsx`, `image-cropper.tsx`, `team-chat.tsx`, `use-chat-notifications.ts`, `styles.css`, `use-ui-prefs.ts`.
- No changes to invoice/business logic — chat-only.

## Out of scope
- Voice/video calls, message editing history, threaded replies (can follow later).
