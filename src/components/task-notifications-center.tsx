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
  const [tab, setTab] = useState<Tab>("unread");
  const [loading, setLoading] = useState(true);

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
    setItems(((data as any) ?? []) as Notif[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);
  useRealtimeTable("notifications", () => load());

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
    setItems([]);
    const { error } = await supabase.from("notifications").delete().in("id", ids);
    if (error) { toast.error(error.message); load(); }
    else toast.success(isAr ? "تم المسح" : "Cleared");
  };

  const handleClick = async (n: Notif) => {
    if (!n.read_at) await markRead(n.id);
    const taskId = n?.meta?.task_id as string | undefined;
    if (taskId && onOpenTask) onOpenTask(taskId);
  };

  const wrapperCls = variant === "compact"
    ? "rounded-xl border border-amber-400/20 bg-black/40 p-3"
    : "rounded-2xl border bg-card p-3 sm:p-4";

  const titleCls = variant === "compact"
    ? "text-sm font-semibold text-amber-100"
    : "text-base font-semibold";

  return (
    <section dir={isAr ? "rtl" : "ltr"} className={wrapperCls} aria-label={isAr ? "مركز إشعارات المهام" : "Task notifications"}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`shrink-0 rounded-lg p-1.5 ${variant === "compact" ? "bg-amber-500/10 ring-1 ring-amber-400/30" : "bg-primary/10"}`}>
            {unreadCount > 0
              ? <BellRing className={`h-4 w-4 ${variant === "compact" ? "text-amber-300" : "text-primary"}`} />
              : <Bell className={`h-4 w-4 ${variant === "compact" ? "text-amber-300/70" : "text-muted-foreground"}`} />}
          </div>
          <h3 className={titleCls}>{isAr ? "إشعارات المهام" : "Task notifications"}</h3>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="tabular-nums">{unreadCount}</Badge>
          )}
          {urgentUnread > 0 && (
            <Badge className="bg-red-500 hover:bg-red-500 tabular-nums text-white">
              <AlertTriangle className="h-3 w-3 me-1" />
              {urgentUnread} {isAr ? "عاجل" : "urgent"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={markAllRead} disabled={unreadCount === 0} className="h-7 px-2 text-xs">
            <CheckCheck className="h-3.5 w-3.5 me-1" />
            {isAr ? "تعليم الكل مقروء" : "Mark all read"}
          </Button>
          <Button size="sm" variant="ghost" onClick={clearAll} disabled={items.length === 0} className="h-7 px-2 text-xs text-destructive hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5 me-1" />
            {isAr ? "مسح الكل" : "Clear all"}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {([
          { k: "unread", ar: "غير مقروء", en: "Unread", n: unreadCount },
          { k: "urgent", ar: "عاجل", en: "Urgent", n: items.filter(isUrgent).length },
          { k: "normal", ar: "عادي",  en: "Normal", n: items.filter(n => !isUrgent(n)).length },
          { k: "all",    ar: "الكل",  en: "All",    n: items.length },
        ] as { k: Tab; ar: string; en: string; n: number }[]).map(t => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
              tab === t.k
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/40 hover:bg-muted border-transparent"
            }`}
          >
            {isAr ? t.ar : t.en}
            <span className={`tabular-nums ${tab === t.k ? "opacity-90" : "opacity-60"}`}>{t.n}</span>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="max-h-80 overflow-y-auto -mx-1 px-1 space-y-1.5">
        {loading ? (
          <div className="py-8 text-center text-xs text-muted-foreground">{isAr ? "جارِ التحميل…" : "Loading…"}</div>
        ) : filtered.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center text-center gap-2 text-muted-foreground">
            <Inbox className="h-6 w-6 opacity-60" />
            <div className="text-xs">{isAr ? "لا توجد إشعارات هنا" : "No notifications here"}</div>
          </div>
        ) : filtered.map(n => {
          const urgent = isUrgent(n);
          const unread = !n.read_at;
          return (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={`w-full text-start rounded-lg border p-2.5 transition-colors group ${
                unread
                  ? urgent
                    ? "bg-red-500/5 border-red-500/30 hover:bg-red-500/10"
                    : "bg-primary/5 border-primary/20 hover:bg-primary/10"
                  : "bg-muted/20 border-transparent hover:bg-muted/40 opacity-80"
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-1 shrink-0">
                  {unread
                    ? <Circle className={`h-2.5 w-2.5 fill-current ${urgent ? "text-red-500" : "text-primary"}`} />
                    : <Circle className="h-2.5 w-2.5 text-muted-foreground/40" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-xs font-semibold truncate ${urgent ? "text-red-600 dark:text-red-400" : ""}`}>
                    {n.title}
                  </div>
                  {n.body && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{n.body}</div>
                  )}
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/80 tabular-nums">
                    {fmtDateTime(n.created_at, lang)}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
