import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { uniqueRealtimeTopic } from "@/lib/realtime";
import type { IncomingCall } from "./IncomingCallDialog";

/**
 * Listens for new chat_calls inserted where the current user is an invited
 * participant, and surfaces them as an incoming call. Only rings for calls
 * still in "ringing" status where the user has not already answered.
 */
export function useIncomingCall(myUserId: string | undefined, activeInCallId: string | null) {
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);

  useEffect(() => {
    if (!myUserId) return;

    const handleInsert = async (payload: any) => {
      const row = payload.new;
      if (!row?.call_id) return;
      // Only for me and only if invited
      if (row.user_id !== myUserId) return;
      if (row.join_status !== "invited") return;
      if (activeInCallId === row.call_id) return;

      // Fetch the call + initiator info
      const { data: call } = await supabase
        .from("chat_calls")
        .select("id, room_id, mode, status, initiator_id")
        .eq("id", row.call_id)
        .maybeSingle();
      if (!call || call.status !== "ringing") return;
      if (call.initiator_id === myUserId) return;

      const [{ data: prof }, { data: room }] = await Promise.all([
        supabase
          .from("profiles")
          .select("display_name, full_name, email, avatar_url")
          .eq("id", call.initiator_id)
          .maybeSingle(),
        supabase
          .from("chat_rooms")
          .select("name, type")
          .eq("id", call.room_id)
          .maybeSingle(),
      ]);

      setIncoming({
        call_id: call.id,
        room_id: call.room_id,
        mode: call.mode,
        initiator_id: call.initiator_id,
        initiator_name: prof?.display_name || prof?.full_name || prof?.email || null,
        initiator_avatar: prof?.avatar_url || null,
        room_name: room?.type === "group" ? room?.name : null,
      });
    };

    const ch = supabase
      .channel(uniqueRealtimeTopic("chat-call-invites"))
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_call_participants", filter: `user_id=eq.${myUserId}` },
        handleInsert
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_calls" },
        (payload: any) => {
          const row = payload.new;
          if (!row) return;
          // Auto-dismiss if the call ended before we answered
          setIncoming((prev) => {
            if (!prev || prev.call_id !== row.id) return prev;
            if (["ended", "cancelled", "missed", "declined", "failed"].includes(row.status)) return null;
            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [myUserId, activeInCallId]);

  return { incoming, dismiss: () => setIncoming(null) };
}
