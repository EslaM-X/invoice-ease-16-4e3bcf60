import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { BookOpen, ShieldCheck, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/mcp-docs")({
  component: () => <AppShell><McpDocsPage /></AppShell>,
});

type ToolDoc = {
  name: string;
  title: string;
  kind: "read" | "write";
  description: string;
  input: string;
  output: string;
  errors: string[];
};

const TOOLS: ToolDoc[] = [
  {
    name: "whoami",
    title: "Who am I",
    kind: "read",
    description:
      "Returns the connected user's id and email from the verified OAuth token. Useful as a connectivity smoke test.",
    input: `{}`,
    output: `{
  "user_id": "b1c2...-uuid",
  "email":   "you@steinheim-eg.com"
}`,
    errors: ["Not authenticated — reconnect the MCP client and re-run OAuth."],
  },
  {
    name: "list_my_tasks",
    title: "List my tasks",
    kind: "read",
    description:
      "Lists tasks whose assignee is the signed-in user, newest first. Optional status filter and page size.",
    input: `{
  "status": "pending" | "in_progress" | "done" | "cancelled",  // optional
  "limit":  1..100                                              // optional, default 20
}`,
    output: `{
  "tasks": [
    { "id": "...", "title": "...", "status": "pending", "priority": "high",
      "due_date": "2026-07-10T09:00:00Z", "created_at": "...",
      "assignee_id": "...", "assigned_by": "..." }
  ]
}`,
    errors: [
      "Not authenticated — sign in and reconnect.",
      "Postgres error message with `code` field is returned when the query fails (rare — RLS never leaks other users' rows).",
    ],
  },
  {
    name: "update_task_status",
    title: "Update task status",
    kind: "write",
    description:
      "Changes a task's status. Automatically stamps started_at when moving to in_progress and completed_at when moving to done or cancelled.",
    input: `{
  "task_id": "uuid",
  "status":  "pending" | "in_progress" | "done" | "cancelled"
}`,
    output: `{
  "task": { "id": "...", "title": "...", "status": "in_progress",
            "started_at": "...", "completed_at": null }
}`,
    errors: [
      "Task not found or you do not have permission to update it — you must be the assignee or a task manager.",
      "Postgres error with `code` — validation or constraint failure.",
    ],
  },
  {
    name: "add_task_comment",
    title: "Add task comment",
    kind: "write",
    description:
      "Posts a comment on a task. Appears in the Tasks UI immediately via realtime.",
    input: `{
  "task_id": "uuid",
  "body":    "string (1..4000 chars)"
}`,
    output: `{
  "comment": { "id": "...", "task_id": "...", "author_id": "...",
               "body": "...", "created_at": "..." }
}`,
    errors: [
      "Empty body — validation fails before the DB call.",
      "Task not found or RLS blocks access.",
    ],
  },
  {
    name: "close_task",
    title: "Close task",
    kind: "write",
    description:
      "Marks a task as done and stamps completed_at. Idempotent — safe to call more than once. Optionally posts a resolution note as a comment. Does NOT modify inventory or reservations (inventory is driven by delivery receipts and PO receipts).",
    input: `{
  "task_id":         "uuid",
  "resolution_note": "string (1..4000 chars, optional)"
}`,
    output: `{
  "task":       { "id": "...", "status": "done", "completed_at": "..." },
  "comment_id": "uuid-or-null"
}`,
    errors: [
      "Task not found or you do not have permission to close it.",
      "Task closed but resolution note failed — returned as `comment_error` (task is still closed).",
    ],
  },
];

function McpDocsPage() {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <header className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2 text-primary">
          <BookOpen className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isAr ? "توثيق أدوات MCP" : "MCP Tools Documentation"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isAr
              ? "أدوات Steinheim Suite المتاحة عبر Model Context Protocol. كل نداء يعمل بهوية المستخدم الموقّع (Supabase RLS)."
              : "Tools exposed by Steinheim Suite over the Model Context Protocol. Every call runs as the signed-in user (Supabase RLS applies)."}
          </p>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            {isAr ? "الاتصال والاعتماد" : "Connection & auth"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            {isAr ? "نقطة النهاية:" : "Endpoint:"}{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">/mcp</code> ·{" "}
            {isAr ? "OAuth 2.1 مع Supabase Auth" : "OAuth 2.1 against Supabase Auth"}
          </p>
          <p>
            {isAr
              ? "شاشة الموافقة تظهر عند أول ربط: وافق لإنشاء token يعمل بحدود صلاحياتك."
              : "Consent screen appears on first connection: approve to mint a token bounded by your app permissions."}
          </p>
        </CardContent>
      </Card>

      {TOOLS.map((t) => (
        <Card key={t.name}>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <code className="rounded bg-muted px-1.5 py-0.5 text-sm">{t.name}</code>
              <span className="font-normal text-muted-foreground">— {t.title}</span>
              <Badge variant={t.kind === "read" ? "secondary" : "default"} className="text-[10px]">
                {t.kind === "read" ? (isAr ? "قراءة" : "READ") : (isAr ? "كتابة" : "WRITE")}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">{t.description}</p>

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {isAr ? "المدخلات" : "Input"}
              </h3>
              <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs" dir="ltr">
                <code>{t.input}</code>
              </pre>
            </section>

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {isAr ? "المخرجات (structuredContent)" : "Output (structuredContent)"}
              </h3>
              <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs" dir="ltr">
                <code>{t.output}</code>
              </pre>
            </section>

            <section>
              <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {isAr ? "معالجة الأخطاء" : "Errors"}
              </h3>
              <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                {t.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                {isAr
                  ? "كل فشل يرجع بـ isError: true ورسالة قابلة للقراءة، مع تسجيل منظّم (JSON سطر واحد) في سجلات الخادم."
                  : "Every failure returns isError: true with a human-readable message and is logged as one-line JSON on the server."}
              </p>
            </section>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
