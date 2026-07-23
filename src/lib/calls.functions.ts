import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AccessToken } from "livekit-server-sdk";

function livekitUrl() {
  const url = process.env.LIVEKIT_URL;
  if (!url) throw new Error("LIVEKIT_URL is not configured");
  return url;
}

async function mintToken(identity: string, name: string, room: string) {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret) throw new Error("LiveKit API credentials missing");
  const at = new AccessToken(key, secret, {
    identity,
    name,
    ttl: 60 * 60 * 6,
  });
  at.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return await at.toJwt();
}

async function displayName(supabase: any, uid: string): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("display_name, full_name, email")
    .eq("id", uid)
    .maybeSingle();
  return data?.display_name || data?.full_name || data?.email || "User";
}

/** Start a new call in a room. Creates chat_calls + participant rows + a system chat message. */
export const startCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { room_id: string; mode: "audio" | "video" }) => {
    if (!d?.room_id || !["audio", "video"].includes(d?.mode)) {
      throw new Error("room_id and mode are required");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify caller is a member
    const { data: room, error: roomErr } = await supabase
      .from("chat_rooms")
      .select("id, type")
      .eq("id", data.room_id)
      .maybeSingle();
    if (roomErr || !room) throw new Error("Room not found");

    const scope = room.type === "direct" ? "dm" : "group";

    // Reuse an in-flight call if one is already ringing/active in the room
    const { data: existing } = await supabase
      .from("chat_calls")
      .select("id, livekit_room, mode, status, initiator_id")
      .eq("room_id", data.room_id)
      .in("status", ["ringing", "active"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const name = await displayName(supabase, userId);
      const token = await mintToken(userId, name, existing.livekit_room);
      // Upsert self-participant as joined-intent
      await supabase.from("chat_call_participants").upsert(
        { call_id: existing.id, user_id: userId, join_status: "joined", joined_at: new Date().toISOString() },
        { onConflict: "call_id,user_id" }
      );
      return {
        call_id: existing.id,
        livekit_room: existing.livekit_room,
        url: livekitUrl(),
        token,
        mode: existing.mode,
        reused: true,
      };
    }

    const livekitRoom = `chat_${data.room_id}_${Date.now().toString(36)}`;

    const { data: created, error: insertErr } = await supabase
      .from("chat_calls")
      .insert({
        room_id: data.room_id,
        initiator_id: userId,
        mode: data.mode,
        scope,
        status: "ringing",
        livekit_room: livekitRoom,
      })
      .select("id, livekit_room, mode")
      .single();
    if (insertErr || !created) throw new Error(insertErr?.message || "Failed to start call");

    // Fetch member list and insert invited participants
    const { data: members } = await supabase
      .from("chat_room_members")
      .select("user_id")
      .eq("room_id", data.room_id);
    const rows = (members ?? []).map((m: any) => ({
      call_id: created.id,
      user_id: m.user_id,
      join_status: m.user_id === userId ? "joined" : "invited",
      joined_at: m.user_id === userId ? new Date().toISOString() : null,
    }));
    if (rows.length) await supabase.from("chat_call_participants").insert(rows);

    // System chat message
    const label = data.mode === "video" ? "📹 مكالمة فيديو" : "📞 مكالمة صوت";
    await supabase.from("chat_messages").insert({
      room_id: data.room_id,
      sender_id: userId,
      body: `${label} — بدأت`,
      message_type: "call_log",
      call_id: created.id,
    });

    const name = await displayName(supabase, userId);
    const token = await mintToken(userId, name, created.livekit_room);

    return {
      call_id: created.id,
      livekit_room: created.livekit_room,
      url: livekitUrl(),
      token,
      mode: created.mode,
      reused: false,
    };
  });

/** Accept an incoming call — mint a token and mark self as joined. */
export const joinCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { call_id: string }) => {
    if (!d?.call_id) throw new Error("call_id is required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: call, error } = await supabase
      .from("chat_calls")
      .select("id, livekit_room, mode, status, room_id")
      .eq("id", data.call_id)
      .maybeSingle();
    if (error || !call) throw new Error("Call not found");
    if (!["ringing", "active"].includes(call.status)) {
      throw new Error("Call is no longer available");
    }

    // Promote status to active on first join
    if (call.status === "ringing") {
      await supabase
        .from("chat_calls")
        .update({ status: "active", connected_at: new Date().toISOString() })
        .eq("id", call.id);
    }

    await supabase.from("chat_call_participants").upsert(
      { call_id: call.id, user_id: userId, join_status: "joined", joined_at: new Date().toISOString() },
      { onConflict: "call_id,user_id" }
    );

    const name = await displayName(supabase, userId);
    const token = await mintToken(userId, name, call.livekit_room);
    return { url: livekitUrl(), token, livekit_room: call.livekit_room, mode: call.mode };
  });

/** Decline an incoming call. */
export const declineCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { call_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase.from("chat_call_participants").upsert(
      { call_id: data.call_id, user_id: userId, join_status: "declined", left_at: new Date().toISOString(), leave_reason: "declined" },
      { onConflict: "call_id,user_id" }
    );
    return { ok: true };
  });

/** Initiator cancels a ringing call before anyone joins. */
export const cancelCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { call_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: call } = await supabase
      .from("chat_calls")
      .select("id, initiator_id, status, room_id")
      .eq("id", data.call_id)
      .maybeSingle();
    if (!call) return { ok: true };
    if (call.initiator_id !== userId) throw new Error("Only the initiator can cancel");
    if (call.status !== "ringing") return { ok: true };

    await supabase
      .from("chat_calls")
      .update({ status: "cancelled", ended_at: new Date().toISOString() })
      .eq("id", call.id);

    await supabase.from("chat_messages").insert({
      room_id: call.room_id,
      sender_id: userId,
      body: "📞 المكالمة اتلغت",
      message_type: "call_log",
      call_id: call.id,
    });
    return { ok: true };
  });

/** Leave / end the call — the last to leave finalises status + duration. */
export const leaveCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { call_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const now = new Date().toISOString();
    await supabase
      .from("chat_call_participants")
      .update({ join_status: "left", left_at: now, leave_reason: "user_left" })
      .eq("call_id", data.call_id)
      .eq("user_id", userId);

    const { data: call } = await supabase
      .from("chat_calls")
      .select("id, status, started_at, connected_at, room_id, mode")
      .eq("id", data.call_id)
      .maybeSingle();
    if (!call) return { ok: true };

    const { count } = await supabase
      .from("chat_call_participants")
      .select("id", { count: "exact", head: true })
      .eq("call_id", data.call_id)
      .eq("join_status", "joined");

    if ((count ?? 0) === 0 && ["ringing", "active"].includes(call.status)) {
      const startedFrom = call.connected_at ?? call.started_at;
      const duration = Math.max(0, Math.floor((Date.now() - new Date(startedFrom).getTime()) / 1000));
      const nextStatus = call.status === "ringing" ? "missed" : "ended";
      await supabase
        .from("chat_calls")
        .update({ status: nextStatus, ended_at: now, duration_seconds: duration })
        .eq("id", call.id);

      const label = call.mode === "video" ? "📹 مكالمة فيديو" : "📞 مكالمة صوت";
      const suffix = nextStatus === "missed" ? "فائتة" : `المدة ${formatDur(duration)}`;
      await supabase.from("chat_messages").insert({
        room_id: call.room_id,
        sender_id: userId,
        body: `${label} — ${suffix}`,
        message_type: "call_log",
        call_id: call.id,
      });
    }
    return { ok: true };
  });

/** List recent calls for a room. */
export const listRoomCalls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { room_id: string; limit?: number }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows } = await supabase
      .from("chat_calls")
      .select("id, mode, status, initiator_id, started_at, ended_at, duration_seconds")
      .eq("room_id", data.room_id)
      .order("started_at", { ascending: false })
      .limit(Math.min(data.limit ?? 30, 100));
    return { calls: rows ?? [] };
  });

function formatDur(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
