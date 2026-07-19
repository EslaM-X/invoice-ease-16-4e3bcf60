## Changes

### 1. "Clear all" notifications actually removes them
In `src/components/task-notifications-center.tsx`:
- Change "مسح الكل" to hard-delete rows from `notifications` for the current user (filtered to task notifications) instead of just marking read.
- Update local state to empty the list immediately; realtime DELETE events keep other tabs/devices in sync.
- Keep "تعليم الكل مقروء" as a separate soft action.

### 2. Archive for completed tasks in the dashboard card
In `src/components/leadership-tasks-card.tsx`:
- Split each column (my-tasks / exec-coordination) into two views: **Active** (default) and **Archive** (completed only).
- Add a small "أرشيف" toggle button (with count badge) in each column header, styled in Noir & Gold. Clicking flips that column between active and archive lists.
- Active list filters out `status = 'done'`; archive shows only `status = 'done'`, sorted by `updated_at` desc, capped (e.g. 20).
- Realtime: existing `useRealtimeTable` on `tasks` already updates both views instantly when status flips to done.
- Clicking any archived task still opens `TaskDetailDialog` (read/edit as usual).

### 3. Tasks page defaults to "Assigned to me"
In `src/routes/tasks.tsx`:
- Set the initial filter/tab to "المهام المسندة لي" (`assignee_id = currentUser`) on first load for every user.
- If the page already uses URL search params for filters, seed the default so the URL reflects it; otherwise set the initial state value.
- Do not force it on every navigation — only when no explicit filter is present, so users can still switch tabs freely within the session.

### 4. Real-time guarantees
- Notifications center: already subscribed via `useRealtimeTable('notifications')` — DELETE events will propagate; ensure the handler removes items on DELETE (not only INSERT/UPDATE).
- Leadership card & tasks page: rely on existing `tasks` realtime subscription; no new channel needed.

## Out of scope
- No schema changes (no new `archived_at` column — "done" status is the archive signal).
- No changes to task creation, assignment, or notification dispatch logic.
