import { useEffect, useState } from "react";
import { Bell, Check, Loader2 } from "lucide-react";
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
    setItems((data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (user) load();
  }, [user]);

  useRealtimeTable("notifications", (p) => {
    if (p.eventType === "INSERT") {
      const n = p.new as Notification;
      setItems((prev) => [n, ...prev].slice(0, 30));
      toast(`${TYPE_EMOJI[n.type] ?? "🔔"} ${n.title}`, {
        description: n.body ?? undefined,
      });
    } else {
      load();
    }
  });

  const unread = items.filter((i) => !i.read_at).length;

  const markAllRead = async () => {
    const ids = items.filter((i) => !i.read_at).map((i) => i.id);
    if (ids.length === 0) return;
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids);
    load();
  };

  const toggleRead = async (n: Notification, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await supabase
      .from("notifications")
      .update({ read_at: n.read_at ? null : new Date().toISOString() })
      .eq("id", n.id);
    setItems((prev) => prev.map((it) => it.id === n.id ? { ...it, read_at: n.read_at ? null : new Date().toISOString() } : it));
  };

  if (!user) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full tap-scale"
          aria-label="notifications"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-[0_0_0_2px_hsl(var(--background)),0_4px_10px_-2px_rgb(244,63,94,.6)] ring-1 ring-white/30 bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-500 animate-pulse">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
          <div className="text-sm font-semibold">الإشعارات</div>
          {unread > 0 && (
            <Button size="sm" variant="ghost" onClick={markAllRead} className="h-7 gap-1 text-xs">
              <Check className="h-3 w-3" /> قرأت الكل
            </Button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
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
                  <div className="text-xl">{TYPE_EMOJI[n.type] ?? "🔔"}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{n.title}</div>
                    {n.body && (
                      <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>
                    )}
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {new Date(n.created_at).toLocaleString("ar-EG")}
                    </div>
                  </div>
                  {!n.read_at && (
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  )}
                  <button
                    onClick={(e) => toggleRead(n, e)}
                    className="ms-1 self-start rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                    title={n.read_at ? "اجعلها غير مقروءة" : "اجعلها مقروءة"}
                  >
                    {n.read_at ? "○" : "●"}
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
