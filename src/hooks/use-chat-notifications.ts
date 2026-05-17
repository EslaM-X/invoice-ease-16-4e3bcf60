import { useEffect, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

/**
 * Global team-chat realtime listener.
 * - Toast + browser notification when a new message arrives in a room I'm a member of
 *   and (the message isn't mine) and (I'm not currently viewing that room on /team-chat).
 * - Polls + maintains a total unread count across all rooms for the sidebar badge.
 */
export function useChatNotifications() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const location = useLocation();
  const onChatPage = location.pathname.startsWith("/team-chat");
  const onChatPageRef = useRef(onChatPage);
  onChatPageRef.current = onChatPage;

  const [unreadTotal, setUnreadTotal] = useState(0);
  const myRoomIdsRef = useRef<Set<string>>(new Set());

  // Request browser permission once
  useEffect(() => {
    if (!user) return;
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try { Notification.requestPermission().catch(() => {}); } catch {}
    }
  }, [user]);

  // Recompute total unread on demand
  const refreshUnread = async () => {
    if (!user) return;
    const { data: mems } = await supabase
      .from("chat_room_members")
      .select("room_id,last_read_at")
      .eq("user_id", user.id);
    if (!mems || mems.length === 0) {
      myRoomIdsRef.current = new Set();
      setUnreadTotal(0);
      return;
    }
    myRoomIdsRef.current = new Set(mems.map((m: any) => m.room_id));
    let total = 0;
    await Promise.all(
      mems.map(async (m: any) => {
        const { count } = await supabase
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("room_id", m.room_id)
          .is("deleted_at", null)
          .gt("created_at", m.last_read_at ?? "1970-01-01")
          .neq("sender_id", user.id);
        total += count ?? 0;
      }),
    );
    setUnreadTotal(total);
  };

  // Initial + periodic refresh (in case we miss realtime events)
  useEffect(() => {
    if (!user) return;
    refreshUnread();
    const id = setInterval(refreshUnread, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Global realtime subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("global-chat-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        async (payload) => {
          const m: any = payload.new;
          if (!m || m.sender_id === user.id) return;
          // Only react if we're a member of this room (RLS gives us only those anyway,
          // but the global channel could include others if RLS leaks — double-check).
          if (!myRoomIdsRef.current.has(m.room_id)) {
            // Could be a brand-new room we just got added to — refresh memberships.
            await refreshUnread();
            if (!myRoomIdsRef.current.has(m.room_id)) return;
          }
          // Update badge
          refreshUnread();
          // Skip toast/notification if user is actively on chat page (they'll see it)
          if (onChatPageRef.current) return;

          const senderLabel = m.sender_email ?? (ar ? "زميل" : "Teammate");
          const previewText =
            m.message_type === "text"
              ? (m.body ?? "").slice(0, 140)
              : m.message_type === "voice"
                ? (ar ? "🎙️ ملاحظة صوتية" : "🎙️ Voice note")
                : m.message_type === "image"
                  ? (ar ? "📷 صورة" : "📷 Image")
                  : (ar ? "📎 ملف" : "📎 File");

          toast.message(ar ? `رسالة من ${senderLabel}` : `Message from ${senderLabel}`, {
            description: previewText,
            action: {
              label: ar ? "فتح" : "Open",
              onClick: () => { window.location.href = "/team-chat"; },
            },
          });

          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              const n = new Notification(
                ar ? `رسالة من ${senderLabel}` : `Message from ${senderLabel}`,
                { body: previewText, tag: `chat-${m.room_id}` },
              );
              n.onclick = () => {
                window.focus();
                window.location.href = "/team-chat";
                n.close();
              };
            } catch {}
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, ar]);

  // Also refresh on route change (e.g. after marking as read on team-chat page)
  useEffect(() => {
    if (!user) return;
    refreshUnread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, user?.id]);

  return { unreadTotal };
}
