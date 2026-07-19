import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtDateTime } from "@/lib/utils-money";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bell, BellRing, CheckCheck, Trash2, Circle, AlertTriangle, Inbox,
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

type Tab = "all" | "urgent" | "normal" | "unread";

const TASK_TYPES = ["task_assigned", "task_urgent"] as const;

function isUrgent(n: Notif): boolean {
  if (n.type === "task_urgent") return true;
  const p = n?.meta?.priority;
  return p === "urgent" || p === "high";
}

export function TaskNotificationsCenter({
  variant = "panel",
  onOpenTask,
}: {
  /** "panel" — full standalone card (Tasks page). "compact" — tighter, for dashboard card. */
  variant?: "panel" | "compact";
  onOpenTask?: (taskId: string) => void;
}) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [items, setItems] = useState<Notif[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  const [loading, setLoading] = useState(true);
  // task_id -> { status, assignee_id } — used to (a) hide notifications for
  // tasks no longer assigned to the viewer and (b) stop the "still open" glow.
  const [taskInfo, setTaskInfo] = useState<Record<string, { status: string; assignee_id: string }>>({});

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .in("type", TASK_TYPES as unknown as string[])
      .order("created_at", { ascending: false })
      .limit(100);
    const raw = ((data as any) ?? []) as Notif[];

    const ids = Array.from(
      new Set(raw.map(n => n?.meta?.task_id).filter((x: any) => typeof x === "string"))
    ) as string[];
    const info: Record<string, { status: string; assignee_id: string }> = {};
    if (ids.length) {
      const { data: t } = await supabase
        .from("tasks" as any)
        .select("id,status,assignee_id")
        .in("id", ids);
      ((t as any[]) ?? []).forEach(row => {
        info[row.id] = { status: row.status, assignee_id: row.assignee_id };
      });
    }
    setTaskInfo(info);

    // Show ONLY notifications for tasks currently assigned to this user.
    // Notifications with no task_id are kept (legacy / non-task pushes).
    const mine = raw.filter(n => {
      const tid = n?.meta?.task_id as string | undefined;
      if (!tid) return true;
      const row = info[tid];
      if (!row) return false; // task deleted or reassigned → hide
      return row.assignee_id === user.id;
    });
    setItems(mine);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);
  useRealtimeTable("notifications", () => load());
  useRealtimeTable("tasks" as any, () => load());

  const isTaskOpen = (n: Notif) => {
    const id = n?.meta?.task_id as string | undefined;
    if (!id) return true;
    const row = taskInfo[id];
    if (!row) return true;
    return row.status !== "done" && row.status !== "cancelled";
  };

  const filtered = useMemo(() => {
    switch (tab) {
      case "urgent": return items.filter(isUrgent);
      case "normal": return items.filter(n => !isUrgent(n));
      case "unread": return items.filter(n => !n.read_at);
      default: return items;
    }
  }, [items, tab]);

  const unreadCount = items.filter(n => !n.read_at).length;
  const urgentUnread = items.filter(n => isUrgent(n) && !n.read_at).length;
  const urgentOpen = items.filter(n => isUrgent(n) && isTaskOpen(n)).length;

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
    if (!user || items.length === 0) return;
    if (!confirm(isAr ? "مسح كل إشعارات المهام؟" : "Clear all task notifications?")) return;
    const ids = items.map(n => n.id);
    setItems([]); // optimistic — realtime DELETE keeps other tabs in sync
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

  // 🎨 High-contrast noir surface with visible gold hairline
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
            <Badge className="bg-amber-400 text-black hover:bg-amber-400 tabular-nums font-bold">{unreadCount}</Badge>
          )}
          {urgentOpen > 0 && (
            <Badge className="bg-red-600 hover:bg-red-600 tabular-nums text-white font-bold animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.7)]">
              <AlertTriangle className="h-3 w-3 me-1" />
              {urgentOpen} {isAr ? "عاجل مفتوح" : "urgent open"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={markAllRead} disabled={unreadCount === 0} className="h-7 px-2 text-xs text-amber-200/90 hover:text-amber-100 hover:bg-amber-400/10">
            <CheckCheck className="h-3.5 w-3.5 me-1" />
            {isAr ? "تعليم الكل مقروء" : "Mark all read"}
          </Button>
          <Button size="sm" variant="ghost" onClick={clearAll} disabled={items.length === 0} className="h-7 px-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10">
            <Trash2 className="h-3.5 w-3.5 me-1" />
            {isAr ? "مسح الكل" : "Clear all"}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {([
          { k: "all",    ar: "الكل",     en: "All",    n: items.length },
          { k: "unread", ar: "غير مقروء", en: "Unread", n: unreadCount },
          { k: "urgent", ar: "عاجل",     en: "Urgent", n: items.filter(isUrgent).length },
          { k: "normal", ar: "عادي",     en: "Normal", n: items.filter(n => !isUrgent(n)).length },
        ] as { k: Tab; ar: string; en: string; n: number }[]).map(t => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold border transition-all ${
              tab === t.k
                ? "bg-amber-400 text-black border-amber-400 shadow-[0_2px_10px_rgba(251,191,36,0.35)]"
                : "bg-white/5 text-amber-100/80 hover:bg-white/10 hover:text-amber-100 border-amber-400/20"
            }`}
          >
            {isAr ? t.ar : t.en}
            <span className={`tabular-nums ${tab === t.k ? "opacity-90" : "opacity-70"}`}>{t.n}</span>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="max-h-96 overflow-y-auto -mx-1 px-1 space-y-2">
        {loading ? (
          <div className="py-8 text-center text-xs text-amber-100/60">{isAr ? "جارِ التحميل…" : "Loading…"}</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 flex flex-col items-center justify-center text-center gap-2 text-amber-100/50">
            <Inbox className="h-7 w-7 opacity-60" />
            <div className="text-xs">{isAr ? "لا توجد إشعارات هنا" : "No notifications here"}</div>
          </div>
        ) : filtered.map(n => {
          const urgent = isUrgent(n);
          const unread = !n.read_at;
          const stillOpen = isTaskOpen(n);
          // Glow if: urgent AND task not closed yet — regardless of read state.
          const glow = urgent && stillOpen;
          return (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={`w-full text-start rounded-xl border p-3 transition-all group ${
                glow
                  ? "bg-gradient-to-br from-red-950/60 to-red-900/30 border-red-500/60 hover:border-red-400 shadow-[0_0_16px_-4px_rgba(239,68,68,0.55)] animate-pulse-slow"
                  : unread
                    ? urgent
                      ? "bg-red-950/40 border-red-500/40 hover:bg-red-950/60"
                      : "bg-amber-500/10 border-amber-400/30 hover:bg-amber-500/15"
                    : "bg-white/[0.03] border-white/5 hover:bg-white/[0.06] opacity-75"
              }`}
              style={glow ? { animation: "urgentGlow 2s ease-in-out infinite" } : undefined}
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-1 shrink-0">
                  {unread
                    ? <Circle className={`h-2.5 w-2.5 fill-current ${urgent ? "text-red-400" : "text-amber-300"}`} />
                    : <Circle className="h-2.5 w-2.5 text-white/20" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-bold truncate ${
                    glow ? "text-red-200" : urgent ? "text-red-300" : "text-amber-50"
                  }`}>
                    {n.title}
                  </div>
                  {n.body && (
                    <div className="mt-1 text-[12px] text-amber-100/70 line-clamp-2 leading-relaxed">{n.body}</div>
                  )}
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

      {/* Local keyframes for a stronger urgent glow */}
      <style>{`
        @keyframes urgentGlow {
          0%, 100% { box-shadow: 0 0 12px -2px rgba(239,68,68,0.45), 0 0 0 1px rgba(239,68,68,0.35); }
          50%      { box-shadow: 0 0 26px -2px rgba(239,68,68,0.85), 0 0 0 1px rgba(239,68,68,0.65); }
        }
      `}</style>
    </section>
  );
}
