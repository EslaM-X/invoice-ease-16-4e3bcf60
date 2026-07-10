// Daily cron: sends a notification to assignees for tasks that are overdue
// or coming due within 24 hours, and to the manager once a task passes its
// due date. Deduplication is handled by pinning notification meta.reminder_key.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/public/hooks/task-overdue-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.BACKUP_WEBHOOK_SECRET;
        const provided = request.headers.get("x-backup-secret");
        if (!secret || !provided || provided !== secret) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !key) {
          return new Response(JSON.stringify({ error: "server_env_missing" }), { status: 500 });
        }
        const admin = createClient(url, key, { auth: { persistSession: false } });


        const now = new Date();
        const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
        const nowIso = now.toISOString();

        const { data: tasks, error } = await admin
          .from("tasks")
          .select("id, title, assignee_id, assigned_by, due_date, status, priority")
          .not("due_date", "is", null)
          .lte("due_date", in24h)
          .in("status", ["pending", "in_progress"])
          .limit(500);
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

        const today = nowIso.slice(0, 10); // YYYY-MM-DD dedup window
        let dispatched = 0;
        for (const t of tasks ?? []) {
          const overdue = new Date(t.due_date as string) < now;
          const kind = overdue ? "task_overdue" : "task_due_soon";
          const key = `${kind}:${t.id}:${today}`;

          // Dedup by meta.reminder_key
          const { data: existing } = await admin
            .from("notifications")
            .select("id")
            .contains("meta", { reminder_key: key })
            .limit(1);
          if (existing && existing.length > 0) continue;

          const title = overdue ? `⏰ مهمة متأخرة: ${t.title}` : `🔔 مهمة قرب موعدها: ${t.title}`;
          const body = overdue
            ? `تجاوزت المهمة موعد الاستحقاق (${new Date(t.due_date as string).toLocaleString("ar-EG")})`
            : `المهمة مستحقة خلال 24 ساعة`;

          const targets = new Set<string>();
          if (t.assignee_id) targets.add(t.assignee_id);
          if (overdue && t.assigned_by) targets.add(t.assigned_by);

          for (const uid of targets) {
            await admin.from("notifications").insert({
              user_id: uid,
              type: kind,
              title,
              body,
              link: `/tasks?id=${t.id}`,
              meta: { task_id: t.id, priority: t.priority, reminder_key: key, overdue },
            });
            dispatched++;
          }
        }

        return Response.json({ ok: true, scanned: tasks?.length ?? 0, dispatched });
      },
    },
  },
});
