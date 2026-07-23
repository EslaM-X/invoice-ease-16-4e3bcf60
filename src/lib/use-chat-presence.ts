import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { uniqueRealtimeTopic } from "@/lib/realtime";

export type PresenceRow = {
  user_id: string;
  status: string;
  last_seen_at: string | null;
  typing_room_id: string | null;
  typing_at: string | null;
};

const ONLINE_WINDOW_MS = 90_000;
const TYPING_WINDOW_MS = 5_000;

export function useRoomPresence(userIds: string[], activeRoomId: string | null, myUserId: string | undefined) {
  const [rows, setRows] = useState<Record<string, PresenceRow>>({});
  const [now, setNow] = useState(Date.now());
  const idsKey = useMemo(() => [...userIds].sort().join(","), [userIds]);
  const idsRef = useRef(userIds);
  idsRef.current = userIds;

  // Ticker so "typing" and "online" states expire live
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1500);
    return () => window.clearInterval(t);
  }, []);

  // Initial fetch + realtime subscription
  useEffect(() => {
    if (userIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("chat_presence")
        .select("user_id, status, last_seen_at, typing_room_id, typing_at")
        .in("user_id", userIds);
      if (cancelled) return;
      const next: Record<string, PresenceRow> = {};
      for (const r of data ?? []) next[r.user_id] = r as PresenceRow;
      setRows(next);
    })();

    const ch = supabase
      .channel(uniqueRealtimeTopic("chat-presence"))
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_presence" }, (payload: any) => {
        const row = (payload.new ?? payload.old) as PresenceRow | undefined;
        if (!row) return;
        if (!idsRef.current.includes(row.user_id)) return;
        setRows((prev) => ({ ...prev, [row.user_id]: row }));
      })
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [idsKey]);

  const isOnline = (uid: string) => {
    const r = rows[uid];
    if (!r) return false;
    if (r.status === "offline") return false;
    if (!r.last_seen_at) return false;
    return now - new Date(r.last_seen_at).getTime() < ONLINE_WINDOW_MS;
  };
  const lastSeen = (uid: string) => rows[uid]?.last_seen_at ?? null;
  const statusOf = (uid: string): "online" | "away" | "offline" => {
    const r = rows[uid];
    if (!r || !r.last_seen_at) return "offline";
    const fresh = now - new Date(r.last_seen_at).getTime() < ONLINE_WINDOW_MS;
    if (!fresh) return "offline";
    if (r.status === "away") return "away";
    if (r.status === "offline") return "offline";
    return "online";
  };

  const typingUserIds = useMemo(() => {
    if (!activeRoomId) return [];
    return Object.values(rows)
      .filter(
        (r) =>
          r.user_id !== myUserId &&
          r.typing_room_id === activeRoomId &&
          r.typing_at &&
          now - new Date(r.typing_at).getTime() < TYPING_WINDOW_MS
      )
      .map((r) => r.user_id);
  }, [rows, activeRoomId, myUserId, now]);

  return { isOnline, lastSeen, statusOf, typingUserIds };

}
