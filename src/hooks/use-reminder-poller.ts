import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

/**
 * Polls x_notifications for due reminders, shows a toast, and broadcasts
 * a `x:assistant:open` event so the X bot can pop up if the user wants to chat.
 * Also subscribes to realtime inserts so newly created reminders appear immediately.
 */
export function useReminderPoller() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const lastTickRef = useRef(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const checkDue = async () => {
      if (cancelled) return;
      const now = new Date().toISOString();
      const { data } = await supabase
        .from("x_notifications")
        .select("id,title,body,kind,scheduled_for,event_id")
        .lte("scheduled_for", now)
        .is("delivered_at", null)
        .order("scheduled_for")
        .limit(10);
      if (!data || data.length === 0) return;
      for (const n of data) {
        const due = new Date(n.scheduled_for).getTime();
        const diffMin = Math.round((due - Date.now()) / 60000);
        const headline =
          n.kind === "start"
            ? ar ? `الميعاد دلوقتي: ${n.title}` : `Now: ${n.title}`
            : ar
              ? `تذكير قبل ${Math.abs(diffMin)} دقيقة: ${n.title}`
              : `Reminder · ${n.title}`;
        toast(headline, {
          description: n.body || undefined,
          duration: 8000,
          action: {
            label: ar ? "افتح X" : "Open X",
            onClick: () => window.dispatchEvent(new CustomEvent("x:assistant:open", { detail: { reminder: n } })),
          },
        });
        // Browser notification (best effort)
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try { new Notification(headline, { body: n.body || undefined, tag: n.id }); } catch {}
        }
        await supabase
          .from("x_notifications")
          .update({ delivered_at: new Date().toISOString() })
          .eq("id", n.id);
      }
    };

    // Ask for browser notification perm on first use (silent if already decided)
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    checkDue();
    const interval = window.setInterval(checkDue, 30_000);

    // Realtime: when a new notification lands, re-check immediately
    const ch = supabase
      .channel("x-notifications-watch")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "x_notifications", filter: `user_id=eq.${user.id}` }, () => {
        if (Date.now() - lastTickRef.current > 1000) {
          lastTickRef.current = Date.now();
          checkDue();
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      supabase.removeChannel(ch);
    };
  }, [user, ar]);
}
