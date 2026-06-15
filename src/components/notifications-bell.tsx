import { useEffect, useMemo, useState } from "react";
import { BellRing, Check, CheckCheck, Loader2, RotateCcw, Inbox } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useRealtimeTable } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { useIsExecutive, EXEC_ONLY_NOTIFICATION_TYPES } from "@/lib/use-executive";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const TYPE_EMOJI: Record<string, string> = {
  invoice_created: "🧾",
  invoice_updated: "✏️",
  call_logged: "📞",
  low_stock: "⚠️",
  backup: "💾",
};

export function NotificationsBell() {
  const { user } = useAuth();
  const isExecutive = useIsExecutive();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const filterForRole = (rows: Notification[]) =>
    isExecutive ? rows : rows.filter((n) => !EXEC_ONLY_NOTIFICATION_TYPES.has(n.type));

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("notifications")
      .select("id, type, title, body, link, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    setItems(filterForRole(((data as any) ?? []) as Notification[]));
    setLoading(false);
  };

  useEffect(() => {
    if (user) load();
  }, [user]);

  useRealtimeTable("notifications", (p) => {
    if (p.eventType === "INSERT") {
      const n = p.new as Notification;
      if (!isExecutive && EXEC_ONLY_NOTIFICATION_TYPES.has(n.type)) return;
      setItems((prev) => [n, ...prev].slice(0, 30));
      toast(`${TYPE_EMOJI[n.type] ?? "🔔"} ${n.title}`, {
        description: n.body ?? undefined,
      });
    } else {
      load();
    }
  });

  const unread = useMemo(() => items.filter((i) => !i.read_at).length, [items]);
  const allRead = items.length > 0 && unread === 0;

  const markAllRead = async () => {
    const ids = items.filter((i) => !i.read_at).map((i) => i.id);
    if (ids.length === 0) return;
    const nowIso = new Date().toISOString();
    setItems((prev) => prev.map((it) => it.read_at ? it : { ...it, read_at: nowIso }));
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: nowIso })
      .in("id", ids);
    if (error) { toast.error(error.message); load(); }
  };

  const markAllUnread = async () => {
    const ids = items.filter((i) => i.read_at).map((i) => i.id);
    if (ids.length === 0) return;
    setItems((prev) => prev.map((it) => ({ ...it, read_at: null })));
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: null })
      .in("id", ids);
    if (error) { toast.error(error.message); load(); }
  };

  const toggleRead = async (n: Notification, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = n.read_at ? null : new Date().toISOString();
    setItems((prev) => prev.map((it) => it.id === n.id ? { ...it, read_at: next } : it));
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: next })
      .eq("id", n.id);
    if (error) { toast.error(error.message); load(); }
  };

  if (!user) return null;

  const hasUnread = unread > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`relative rounded-full tap-scale transition-colors ${
            hasUnread ? "text-amber-600 dark:text-amber-400" : ""
          }`}
          aria-label="notifications"
          title="الإشعارات"
        >
          <BellRing className={`h-4 w-4 ${hasUnread ? "animate-[wiggle_1.5s_ease-in-out_infinite] drop-shadow-[0_0_6px_rgba(245,158,11,0.6)]" : ""}`} />
          {hasUnread && (
            <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-[0_0_0_2px_hsl(var(--background)),0_4px_10px_-2px_rgba(245,158,11,.7)] ring-1 ring-white/30 bg-gradient-to-br from-amber-400 via-orange-500 to-amber-600 animate-pulse">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0" sideOffset={8}>
        <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-gradient-to-r from-amber-500/10 via-transparent to-transparent px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm font-bold">
            <BellRing className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            الإشعارات
            {hasUnread && (
              <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {unread}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {hasUnread && (
              <Button size="sm" variant="ghost" onClick={markAllRead} className="h-7 gap-1 text-[11px]">
                <CheckCheck className="h-3 w-3" /> قرأت الكل
              </Button>
            )}
            {allRead && (
              <Button size="sm" variant="ghost" onClick={markAllUnread} className="h-7 gap-1 text-[11px]" title="ارجاع الكل غير مقروء">
                <RotateCcw className="h-3 w-3" /> ارجاع الكل
              </Button>
            )}
          </div>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <Inbox className="h-8 w-8 opacity-40" />
              لا توجد إشعارات
            </div>
          ) : (
            items.map((n) => {
              const inner = (
                <div
                  className={`flex gap-3 border-b border-border/40 px-4 py-3 transition hover:bg-muted/40 ${
                    !n.read_at ? "bg-amber-500/5" : ""
                  }`}
                >
                  <div className="text-xl leading-none">{TYPE_EMOJI[n.type] ?? "🔔"}</div>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm ${!n.read_at ? "font-bold" : "font-medium"}`}>{n.title}</div>
                    {n.body && (
                      <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>
                    )}
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {new Date(n.created_at).toLocaleString("ar-EG")}
                    </div>
                  </div>
                  {!n.read_at && (
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,.7)]" />
                  )}
                  <button
                    onClick={(e) => toggleRead(n, e)}
                    className="ms-1 self-start rounded p-1 text-muted-foreground transition hover:bg-amber-500/10 hover:text-amber-600"
                    title={n.read_at ? "اجعلها غير مقروءة" : "اجعلها مقروءة"}
                  >
                    {n.read_at ? <RotateCcw className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                  </button>
                </div>
              );
              return n.link ? (
                <Link key={n.id} to={n.link as any} onClick={() => setOpen(false)}>
                  {inner}
                </Link>
              ) : (
                <div key={n.id}>{inner}</div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
