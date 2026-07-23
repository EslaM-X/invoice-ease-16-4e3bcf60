import { createFileRoute } from "@tanstack/react-router";
import { WebhookReceiver } from "livekit-server-sdk";

// LiveKit webhook receiver — validates the signed JWT then syncs
// chat_calls / chat_call_participants + inserts call_log messages.
export const Route = createFileRoute("/api/public/livekit/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;
        if (!apiKey || !apiSecret) {
          return new Response("Missing LiveKit credentials", { status: 500 });
        }

        const authHeader = request.headers.get("Authorization") ?? "";
        const body = await request.text();
        let event: any;
        try {
          const receiver = new WebhookReceiver(apiKey, apiSecret);
          event = await receiver.receive(body, authHeader);
        } catch {
          return new Response("Invalid signature", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const roomName: string | undefined = event.room?.name;
        if (!roomName) return new Response("ok");

        const { data: call } = await supabaseAdmin
          .from("chat_calls")
          .select("id, status, started_at, connected_at, mode, room_id, initiator_id")
          .eq("livekit_room", roomName)
          .maybeSingle();
        if (!call) return new Response("ok");

        const now = new Date().toISOString();

        if (event.event === "participant_joined") {
          const uid = event.participant?.identity;
          if (uid) {
            await supabaseAdmin.from("chat_call_participants").upsert(
              { call_id: call.id, user_id: uid, join_status: "joined", joined_at: now },
              { onConflict: "call_id,user_id" }
            );
          }
          if (call.status === "ringing") {
            await supabaseAdmin
              .from("chat_calls")
              .update({ status: "active", connected_at: now })
              .eq("id", call.id);
          }
        } else if (event.event === "participant_left") {
          const uid = event.participant?.identity;
          if (uid) {
            await supabaseAdmin
              .from("chat_call_participants")
              .update({ join_status: "left", left_at: now, leave_reason: "webhook" })
              .eq("call_id", call.id)
              .eq("user_id", uid);
          }
        } else if (event.event === "room_finished") {
          if (["ringing", "active"].includes(call.status)) {
            const startedFrom = call.connected_at ?? call.started_at;
            const duration = Math.max(
              0,
              Math.floor((Date.now() - new Date(startedFrom).getTime()) / 1000)
            );
            const nextStatus = call.status === "ringing" ? "missed" : "ended";
            await supabaseAdmin
              .from("chat_calls")
              .update({ status: nextStatus, ended_at: now, duration_seconds: duration })
              .eq("id", call.id);

            const label = call.mode === "video" ? "📹 مكالمة فيديو" : "📞 مكالمة صوت";
            const m = Math.floor(duration / 60);
            const s = duration % 60;
            const suffix = nextStatus === "missed"
              ? "فائتة"
              : `المدة ${m}:${s.toString().padStart(2, "0")}`;
            await supabaseAdmin.from("chat_messages").insert({
              room_id: call.room_id,
              sender_id: call.initiator_id,
              body: `${label} — ${suffix}`,
              message_type: "call_log",
              call_id: call.id,
            });
          }
        }

        return new Response("ok");
      },
    },
  },
});
