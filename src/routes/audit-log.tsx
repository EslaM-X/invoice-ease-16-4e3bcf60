import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/lib/utils-money";
import { useRealtimeTable } from "@/lib/realtime";
import { ShieldCheck, Plus, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/audit-log")({ component: AuditLogPage });

type Row = {
  id: string;
  actor_email: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  details: any;
  created_at: string;
};

function AuditLogPage() {
  return <AppShell><AuditLog /></AppShell>;
}

function AuditLog() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [entity, setEntity] = useState<string>("all");
  const [action, setAction] = useState<string>("all");

  const load = async () => {
    let q = supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(300);
    if (entity !== "all") q = q.eq("entity_type", entity);
    if (action !== "all") q = q.eq("action", action);
    const { data } = await q;
    setRows((data ?? []) as Row[]);
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user, entity, action]);
  useRealtimeTable("audit_log", () => { load(); }, [entity, action]);

  const entities = ["all", "invoices", "products", "customers", "invoice_items"];
  const actions = ["all", "created", "updated", "deleted"];

  const ActionIcon = ({ a }: { a: string }) =>
    a === "created" ? <Plus className="h-3.5 w-3.5" /> :
    a === "updated" ? <Pencil className="h-3.5 w-3.5" /> :
    a === "deleted" ? <Trash2 className="h-3.5 w-3.5" /> :
    <ShieldCheck className="h-3.5 w-3.5" />;

  const actionClass = (a: string) =>
    a === "created" ? "bg-success/10 text-success" :
    a === "updated" ? "bg-primary/10 text-primary" :
    a === "deleted" ? "bg-destructive/10 text-destructive" :
    "bg-muted text-muted-foreground";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t("audit_log")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("audit_log_desc")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={entity} onChange={(e) => setEntity(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
            {entities.map((e) => <option key={e} value={e}>{e === "all" ? t("all") : e}</option>)}
          </select>
          <select value={action} onChange={(e) => setAction(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
            {actions.map((a) => <option key={a} value={a}>{a === "all" ? t("all") : a}</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
        {rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">{t("no_data")}</div>
        ) : (
          <div className="divide-y divide-border/60">
            {rows.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${actionClass(r.action)}`}>
                    <ActionIcon a={r.action} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      <span className="capitalize">{r.action}</span> · <span className="text-muted-foreground">{r.entity_type}</span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.actor_email ?? "—"} · {fmtDate(r.created_at, lang)}
                    </div>
                    {r.details && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-primary hover:underline">{t("details")}</summary>
                        <pre dir="ltr" className="mt-1 max-h-60 overflow-auto rounded-lg bg-muted p-2 text-[10px] leading-snug">
{JSON.stringify(r.details, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
