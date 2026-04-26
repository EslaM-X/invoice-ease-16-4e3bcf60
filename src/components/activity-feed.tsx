import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/lib/realtime";
import { useI18n } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils-money";
import { useTeamProfiles } from "@/lib/team-profiles";
import { Plus, Pencil, Trash2, ShieldCheck, User } from "lucide-react";
import { Link } from "@tanstack/react-router";

type Row = {
  id: string;
  actor_email: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  details: any;
  created_at: string;
};

export function ActivityFeed({ limit = 8 }: { limit?: number }) {
  const { t, lang } = useI18n();
  const team = useTeamProfiles();
  const [rows, setRows] = useState<Row[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    setRows((data ?? []) as Row[]);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  // Stream new activity in real time — prepend for instant feel
  useRealtimeTable("audit_log", (payload) => {
    if (payload.eventType === "INSERT" && payload.new) {
      setRows((prev) => [payload.new as Row, ...prev].slice(0, limit));
    } else {
      load();
    }
  });

  const Icon = ({ a }: { a: string }) =>
    a === "created" ? <Plus className="h-3 w-3" /> :
    a === "updated" ? <Pencil className="h-3 w-3" /> :
    a === "deleted" ? <Trash2 className="h-3 w-3" /> :
    <ShieldCheck className="h-3 w-3" />;

  const accent = (a: string) =>
    a === "created" ? "bg-success/10 text-success" :
    a === "updated" ? "bg-primary/10 text-primary" :
    a === "deleted" ? "bg-destructive/10 text-destructive" :
    "bg-muted text-muted-foreground";

  const summary = (r: Row) => {
    const d = r.details ?? {};
    const after = d.after ?? d;
    if (r.entity_type === "invoices") return after?.invoice_number || d?.invoice_number || "—";
    if (r.entity_type === "products") return after?.name || "—";
    if (r.entity_type === "customers") return after?.name || "—";
    if (r.entity_type === "invoice_items") return after?.product_name || "—";
    return r.entity_type;
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">{t("company_activity")}</h3>
        <Link to="/audit-log" className="text-xs font-semibold text-primary hover:underline">
          {t("view")} →
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">{t("no_data")}</div>
      ) : (
        <div className="divide-y divide-border/60">
          {rows.map((r) => {
            const profile = r.actor_email ? team.byEmail(r.actor_email) : null;
            const who = profile?.display_name || r.actor_email?.split("@")[0] || "—";
            return (
              <div key={r.id} className="flex items-start gap-3 py-2.5">
                <div className="relative">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                  <span className={`absolute -bottom-0.5 -end-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-card ${accent(r.action)}`}>
                    <Icon a={r.action} />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    <span className="font-semibold">{who}</span>{" "}
                    <span className="text-muted-foreground">{r.action}</span>{" "}
                    <span className="text-muted-foreground">·</span>{" "}
                    <span className="text-muted-foreground">{r.entity_type}</span>{" "}
                    <span className="font-medium">{summary(r)}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">{fmtDate(r.created_at, lang)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
