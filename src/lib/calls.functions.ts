import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AccessToken } from "livekit-server-sdk";

function livekitUrl() {
  const url = process.env.LIVEKIT_URL;
  if (!url) throw new Error("LIVEKIT_URL غير مضبوط في الخادم");
  return url;
}

async function mintToken(identity: string, name: string, room: string) {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret) throw new Error("مفاتيح LiveKit غير موجودة على الخادم");
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
    .select("display_name, email")
    .eq("user_id", uid)
    .maybeSingle();
  return data?.display_name || data?.email || "User";
}

/**
 * Verify that `uid` is a member of `roomId`. Throws a clear Arabic error otherwise.
 * Uses the authenticated Supabase client — RLS on chat_room_members applies.
 */
async function assertRoomMember(supabase: any, uid: string, roomId: string) {
  const { data, error } = await supabase
    .from("chat_room_members")
    .select("user_id")
    .eq("room_id", roomId)
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw new Error("تعذّر التحقق من صلاحيات الغرفة");
  if (!data) throw new Error("غير مسموح: أنت لست عضوًا في هذه الغرفة");
}

/** Start a new call in a room. Creates chat_calls + participant rows + a system chat message. */
export const startCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { room_id: string; mode: "audio" | "video" }) => {
    if (!d?.room_id || !["audio", "video"].includes(d?.mode)) {
      throw new Error("room_id ونمط المكالمة مطلوبان");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify room exists
    const { data: room, error: roomErr } = await supabase
      .from("chat_rooms")
      .select("id, type")
      .eq("id", data.room_id)
      .maybeSingle();
    if (roomErr || !room) throw new Error("الغرفة غير موجودة");

    // Explicit membership check with clear message
    await assertRoomMember(supabase, userId, data.room_id);

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
    if (insertErr || !created) throw new Error(insertErr?.message || "فشل بدء المكالمة");

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
    if (!d?.call_id) throw new Error("call_id مطلوب");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: call, error } = await supabase
      .from("chat_calls")
      .select("id, livekit_room, mode, status, room_id")
      .eq("id", data.call_id)
      .maybeSingle();
    if (error || !call) throw new Error("المكالمة غير موجودة");
    if (!["ringing", "active"].includes(call.status)) {
      throw new Error("المكالمة انتهت بالفعل");
    }

    // Must be a member of the room to join
    await assertRoomMember(supabase, userId, call.room_id);

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
    const { data: call } = await supabase
      .from("chat_calls")
      .select("id, room_id")
      .eq("id", data.call_id)
      .maybeSingle();
    if (!call) throw new Error("المكالمة غير موجودة");
    await assertRoomMember(supabase, userId, call.room_id);

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
    if (call.initiator_id !== userId) throw new Error("فقط صاحب المكالمة يمكنه إلغاؤها");
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

    const { data: precheck } = await supabase
      .from("chat_calls")
      .select("id, room_id")
      .eq("id", data.call_id)
      .maybeSingle();
    if (!precheck) throw new Error("المكالمة غير موجودة");
    await assertRoomMember(supabase, userId, precheck.room_id);

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
    const { supabase, userId } = context;
    await assertRoomMember(supabase, userId, data.room_id);
    const { data: rows } = await supabase
      .from("chat_calls")
      .select("id, mode, status, initiator_id, started_at, ended_at, duration_seconds")
      .eq("room_id", data.room_id)
      .order("started_at", { ascending: false })
      .limit(Math.min(data.limit ?? 30, 100));
    return { calls: rows ?? [] };
  });

/**
 * List every call across every room the current user is a member of,
 * with per-participant details. For the Call History page.
 */
export const listMyCallHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number } | undefined) => d ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const limit = Math.min(data.limit ?? 100, 300);

    // Rooms I belong to
    const { data: myRooms } = await supabase
      .from("chat_room_members")
      .select("room_id")
      .eq("user_id", userId);
    const roomIds = (myRooms ?? []).map((r: any) => r.room_id);
    if (!roomIds.length) return { calls: [] };

    const { data: calls } = await supabase
      .from("chat_calls")
      .select("id, room_id, mode, status, initiator_id, started_at, ended_at, connected_at, duration_seconds")
      .in("room_id", roomIds)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (!calls?.length) return { calls: [] };

    const callIds = calls.map((c: any) => c.id);
    const [{ data: participants }, { data: rooms }] = await Promise.all([
      supabase
        .from("chat_call_participants")
        .select("call_id, user_id, join_status, joined_at, left_at, leave_reason")
        .in("call_id", callIds),
      supabase
        .from("chat_rooms")
        .select("id, name, type")
        .in("id", roomIds),
    ]);

    const uids = Array.from(
      new Set<string>([
        ...calls.map((c: any) => c.initiator_id),
        ...((participants ?? []).map((p: any) => p.user_id)),
      ])
    );
    const { data: profs } = await supabase
      .from("profiles")
      .select("user_id, display_name, email, avatar_url")
      .in("user_id", uids);
    const profileByUid = new Map<string, any>((profs ?? []).map((p: any) => [p.user_id, p]));
    const roomById = new Map<string, any>((rooms ?? []).map((r: any) => [r.id, r]));
    const partsByCall = new Map<string, any[]>();
    for (const p of participants ?? []) {
      const arr = partsByCall.get(p.call_id) ?? [];
      arr.push({ ...p, profile: profileByUid.get(p.user_id) ?? null });
      partsByCall.set(p.call_id, arr);
    }

    return {
      calls: calls.map((c: any) => ({
        ...c,
        initiator: profileByUid.get(c.initiator_id) ?? null,
        room: roomById.get(c.room_id) ?? null,
        participants: partsByCall.get(c.id) ?? [],
        me_participated: (partsByCall.get(c.id) ?? []).some(
          (p: any) => p.user_id === userId && p.join_status === "joined"
        ),
      })),
    };
  });

function formatDur(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
