import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { useTeamProfiles } from "@/lib/team-profiles";
import { fmtDateTime } from "@/lib/utils-money";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bell, BellRing, CheckCheck, Trash2, Circle, AlertTriangle, Inbox,
  Archive, UserCircle2, CheckCircle2, ExternalLink, Check, Filter,
} from "lucide-react";
import { toast } from "sonner";

type Notif = {
  id: string;
  created_at: string;
  user_id: string;
  type: string | null;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  meta: any;
};

type Priority = "urgent" | "high" | "normal" | "low";
type Tab = "all" | "urgent" | "unread" | "archive";

const TASK_TYPES = ["task_assigned", "task_urgent"] as const;

const PRIO_META: Record<Priority, { ar: string; en: string; cls: string; dot: string }> = {
  urgent: { ar: "عاجلة",  en: "Urgent", cls: "bg-red-500/20 text-red-200 ring-red-500/50",       dot: "bg-red-500" },
  high:   { ar: "عالية",  en: "High",   cls: "bg-orange-500/20 text-orange-200 ring-orange-500/50", dot: "bg-orange-500" },
  normal: { ar: "عادية",  en: "Normal", cls: "bg-sky-500/15 text-sky-200 ring-sky-500/40",       dot: "bg-sky-500" },
  low:    { ar: "منخفضة", en: "Low",    cls: "bg-slate-500/15 text-slate-200 ring-slate-500/40", dot: "bg-slate-400" },
};

function priorityOf(n: Notif): Priority {
  const p = n?.meta?.priority as Priority | undefined;
  if (p === "urgent" || p === "high" || p === "normal" || p === "low") return p;
  return n.type === "task_urgent" ? "urgent" : "normal";
}
function isUrgent(n: Notif): boolean {
  const p = priorityOf(n);
  return p === "urgent" || p === "high";
}

export function TaskNotificationsCenter({
  variant = "panel",
  onOpenTask,
}: {
  variant?: "panel" | "compact";
  onOpenTask?: (taskId: string) => void;
}) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const profiles = useTeamProfiles();
  const [items, setItems] = useState<Notif[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "new" | "urgent">("all");
  const [prioFilter, setPrioFilter] = useState<"all" | Priority>("all");
  const [loading, setLoading] = useState(true);
  // task_id -> { status, assignee_id, assigned_by }
  const [taskInfo, setTaskInfo] = useState<Record<string, { status: string; assignee_id: string; assigned_by: string }>>({});

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .in("type", TASK_TYPES as unknown as string[])
      .order("created_at", { ascending: false })
      .limit(200);
    const raw = ((data as any) ?? []) as Notif[];

    const ids = Array.from(
      new Set(raw.map(n => n?.meta?.task_id).filter((x: any) => typeof x === "string"))
    ) as string[];
    const info: Record<string, { status: string; assignee_id: string; assigned_by: string }> = {};
    if (ids.length) {
      const { data: t } = await supabase
        .from("tasks" as any)
        .select("id,status,assignee_id,assigned_by")
        .in("id", ids);
      ((t as any[]) ?? []).forEach(row => {
        info[row.id] = { status: row.status, assignee_id: row.assignee_id, assigned_by: row.assigned_by };
      });
    }
    setTaskInfo(info);

    // Show ONLY notifications for tasks currently assigned to this user.
    const mine = raw.filter(n => {
      const tid = n?.meta?.task_id as string | undefined;
      if (!tid) return true;
      const row = info[tid];
      if (!row) return false;
      return row.assignee_id === user.id;
    });
    setItems(mine);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);
  useRealtimeTable("notifications", () => load());
  useRealtimeTable("tasks" as any, () => load());

  const isTaskDone = (n: Notif) => {
    const id = n?.meta?.task_id as string | undefined;
    if (!id) return false;
    const row = taskInfo[id];
    if (!row) return false;
    return row.status === "done" || row.status === "cancelled";
  };
  const isTaskOpen = (n: Notif) => !isTaskDone(n);

  // Split active vs archived (done/cancelled tasks auto-archive).
  const active = useMemo(() => items.filter(n => !isTaskDone(n)), [items, taskInfo]);
  const archived = useMemo(() => items.filter(n => isTaskDone(n)), [items, taskInfo]);

  const filtered = useMemo(() => {
    if (tab === "archive") return archived;
    let base = active;
    if (tab === "urgent") base = base.filter(isUrgent);
    else if (tab === "unread") base = base.filter(n => !n.read_at);
    return base;
  }, [active, archived, tab]);

  const unreadCount = active.filter(n => !n.read_at).length;
  const urgentOpen = active.filter(n => isUrgent(n)).length;
  const archivedCount = archived.length;

  const markRead = async (id: string) => {
    setItems(cur => cur.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
    await supabase.from("notifications").update({ read_at: new Date().toISOString() } as any).eq("id", id);
  };
  const markAllRead = async () => {
    if (!user || unreadCount === 0) return;
    const now = new Date().toISOString();
    setItems(cur => cur.map(n => n.read_at ? n : { ...n, read_at: now }));
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: now } as any)
      .eq("user_id", user.id)
      .is("read_at", null)
      .in("type", TASK_TYPES as unknown as string[]);
    if (error) toast.error(error.message);
    else toast.success(isAr ? "تم تعليم الكل كمقروء" : "All marked as read");
  };
  const clearAll = async () => {
    if (!user || filtered.length === 0) return;
    const scope = tab === "archive"
      ? (isAr ? "مسح إشعارات الأرشيف؟" : "Clear archived notifications?")
      : (isAr ? "مسح إشعارات المهام الحالية؟" : "Clear current task notifications?");
    if (!confirm(scope)) return;
    const ids = filtered.map(n => n.id);
    const idSet = new Set(ids);
    setItems(cur => cur.filter(n => !idSet.has(n.id))); // optimistic → unread counter drops instantly
    const { error, count } = await supabase
      .from("notifications")
      .delete({ count: "exact" })
      .in("id", ids)
      .eq("user_id", user.id);
    if (error) { toast.error(error.message); load(); return; }
    if ((count ?? 0) === 0) {
      toast.error(isAr ? "تعذّر المسح — تحقق من الصلاحيات" : "Nothing was cleared — permission issue");
      load();
      return;
    }
    toast.success(isAr ? "تم المسح" : "Cleared");
  };


  const handleClick = async (n: Notif) => {
    if (!n.read_at) await markRead(n.id);
    const taskId = n?.meta?.task_id as string | undefined;
    if (taskId && onOpenTask) onOpenTask(taskId);
  };

  const wrapperCls = variant === "compact"
    ? "rounded-2xl border-2 border-amber-400/40 bg-gradient-to-b from-neutral-950 to-black p-4 shadow-[0_0_0_1px_rgba(251,191,36,0.15),0_20px_40px_-20px_rgba(251,191,36,0.35)]"
    : "rounded-2xl border-2 border-amber-400/30 bg-gradient-to-b from-neutral-950 to-black p-4 sm:p-5 shadow-[0_0_0_1px_rgba(251,191,36,0.12),0_24px_50px_-24px_rgba(251,191,36,0.35)]";

  const titleCls = variant === "compact"
    ? "text-base font-bold text-amber-50"
    : "text-lg font-bold text-amber-50";

  return (
    <section dir={isAr ? "rtl" : "ltr"} className={wrapperCls} aria-label={isAr ? "مركز إشعارات المهام" : "Task notifications"}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-amber-400/20">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`shrink-0 rounded-xl p-2 bg-amber-500/15 ring-1 ring-amber-400/40 ${urgentOpen > 0 ? "animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.4)]" : ""}`}>
            {unreadCount > 0
              ? <BellRing className="h-4 w-4 text-amber-300" />
              : <Bell className="h-4 w-4 text-amber-300/80" />}
          </div>
          <h3 className={titleCls}>{isAr ? "إشعارات المهام" : "Task notifications"}</h3>
          {unreadCount > 0 && (
            <Badge
              className="bg-amber-400 text-black hover:bg-amber-400 tabular-nums font-bold"
              aria-live="polite"
              aria-label={isAr ? `${unreadCount} غير مقروء` : `${unreadCount} unread`}
            >
              {unreadCount}
            </Badge>
          )}
          {urgentOpen > 0 && (
            <Badge className="bg-red-600 hover:bg-red-600 tabular-nums text-white font-bold animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.7)]">
              <AlertTriangle className="h-3 w-3 me-1" />
              {urgentOpen} {isAr ? "عاجل" : "urgent"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={markAllRead} disabled={unreadCount === 0} className="h-7 px-2 text-xs text-amber-200/90 hover:text-amber-100 hover:bg-amber-400/10">
            <CheckCheck className="h-3.5 w-3.5 me-1" />
            {isAr ? "تعليم الكل مقروء" : "Mark all read"}
          </Button>
          <Button size="sm" variant="ghost" onClick={clearAll} disabled={filtered.length === 0} className="h-7 px-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10">
            <Trash2 className="h-3.5 w-3.5 me-1" />
            {isAr ? "مسح الكل" : "Clear all"}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {([
          { k: "all",     ar: "الكل",     en: "All",     n: active.length,  icon: null },
          { k: "unread",  ar: "غير مقروء", en: "Unread",  n: unreadCount,    icon: null },
          { k: "urgent",  ar: "عاجل",     en: "Urgent",  n: urgentOpen,     icon: null },
          { k: "archive", ar: "الأرشيف",  en: "Archive", n: archivedCount, icon: Archive },
        ] as { k: Tab; ar: string; en: string; n: number; icon: any }[]).map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold border transition-all ${
                tab === t.k
                  ? "bg-amber-400 text-black border-amber-400 shadow-[0_2px_10px_rgba(251,191,36,0.35)]"
                  : "bg-white/5 text-amber-100/80 hover:bg-white/10 hover:text-amber-100 border-amber-400/20"
              }`}
            >
              {Icon && <Icon className="h-3 w-3" />}
              {isAr ? t.ar : t.en}
              <span className={`tabular-nums ${tab === t.k ? "opacity-90" : "opacity-70"}`}>{t.n}</span>
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="max-h-[28rem] overflow-y-auto -mx-1 px-1 space-y-2">
        {loading ? (
          <div className="py-8 text-center text-xs text-amber-100/60">{isAr ? "جارِ التحميل…" : "Loading…"}</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 flex flex-col items-center justify-center text-center gap-2 text-amber-100/50">
            {tab === "archive" ? <Archive className="h-7 w-7 opacity-60" /> : <Inbox className="h-7 w-7 opacity-60" />}
            <div className="text-xs">
              {tab === "archive"
                ? (isAr ? "لا يوجد شيء في الأرشيف بعد" : "Nothing archived yet")
                : (isAr ? "لا توجد إشعارات هنا" : "No notifications here")}
            </div>
          </div>
        ) : filtered.map(n => {
          const prio = priorityOf(n);
          const prioMeta = PRIO_META[prio];
          const urgent = isUrgent(n);
          const unread = !n.read_at;
          const done = isTaskDone(n);
          const stillOpen = !done;
          const glow = urgent && stillOpen;
          const isArchived = done;
          const assignedById = (n?.meta?.assigned_by as string | undefined) || taskInfo[n?.meta?.task_id]?.assigned_by;
          const assigner = assignedById ? profiles.byId(assignedById) : null;
          const assignerName = assigner?.display_name || assigner?.email || (isAr ? "غير معروف" : "Unknown");
          const assignerAvatar = assigner?.avatar_url || null;
          const typeLabel = urgent
            ? (isAr ? "مهمة عاجلة" : "Urgent task")
            : (isAr ? "مهمة جديدة" : "New task");
          return (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={`w-full text-start rounded-xl border p-3 transition-all group ${
                isArchived
                  ? "bg-white/[0.02] border-white/5 hover:bg-white/[0.05] opacity-70"
                  : glow
                    ? "bg-gradient-to-br from-red-950/60 to-red-900/30 border-red-500/60 hover:border-red-400 shadow-[0_0_16px_-4px_rgba(239,68,68,0.55)]"
                    : unread
                      ? urgent
                        ? "bg-red-950/40 border-red-500/40 hover:bg-red-950/60"
                        : "bg-amber-500/10 border-amber-400/30 hover:bg-amber-500/15"
                      : "bg-white/[0.03] border-white/5 hover:bg-white/[0.06] opacity-80"
              }`}
              style={glow ? { animation: "urgentGlow 2s ease-in-out infinite" } : undefined}
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-1 shrink-0">
                  {isArchived
                    ? <CheckCircle2 className="h-3 w-3 text-emerald-400/80" />
                    : unread
                      ? <Circle className={`h-2.5 w-2.5 fill-current ${urgent ? "text-red-400" : "text-amber-300"}`} />
                      : <Circle className="h-2.5 w-2.5 text-white/20" />}
                </span>
                <div className="min-w-0 flex-1">
                  {/* Type + Priority pills */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${
                      urgent ? "bg-red-500/15 text-red-200 ring-red-500/40" : "bg-amber-400/15 text-amber-200 ring-amber-400/40"
                    }`}>
                      {typeLabel}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${prioMeta.cls}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${prioMeta.dot}`} />
                      {isAr ? prioMeta.ar : prioMeta.en}
                    </span>
                    {isArchived && (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/40">
                        <Archive className="h-2.5 w-2.5" />
                        {isAr ? "أرشيف" : "Archived"}
                      </span>
                    )}
                  </div>

                  <div className={`text-sm font-bold truncate ${
                    isArchived ? "text-amber-50/80" : glow ? "text-red-200" : urgent ? "text-red-300" : "text-amber-50"
                  }`}>
                    {n.title}
                  </div>
                  {n.body && (
                    <div className="mt-1 text-[12px] text-amber-100/70 line-clamp-2 leading-relaxed">{n.body}</div>
                  )}

                  {/* Assigner row */}
                  <div className="mt-2 flex items-center gap-2">
                    {assignerAvatar ? (
                      <img
                        src={assignerAvatar}
                        alt=""
                        className="h-5 w-5 rounded-full object-cover ring-1 ring-amber-400/40"
                        loading="lazy"
                      />
                    ) : (
                      <UserCircle2 className="h-5 w-5 text-amber-300/70" />
                    )}
                    <span className="text-[11px] text-amber-100/80 truncate">
                      <span className="text-amber-100/50">{isAr ? "أسندها: " : "By "}</span>
                      <span className="font-semibold">{assignerName}</span>
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wide">
                    <span className="text-amber-100/50 tabular-nums">{fmtDateTime(n.created_at, lang)}</span>
                    {glow && (
                      <span className="rounded-full bg-red-500/20 text-red-300 px-2 py-0.5 font-bold ring-1 ring-red-500/40">
                        {isAr ? "لم تُغلق بعد" : "still open"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <style>{`
        @keyframes urgentGlow {
          0%, 100% { box-shadow: 0 0 12px -2px rgba(239,68,68,0.45), 0 0 0 1px rgba(239,68,68,0.35); }
          50%      { box-shadow: 0 0 26px -2px rgba(239,68,68,0.85), 0 0 0 1px rgba(239,68,68,0.65); }
        }
      `}</style>
    </section>
  );
}
