import { AccessToken, RoomServiceClient, TokenVerifier } from "livekit-server-sdk";

type CallMode = "audio" | "video";

type LiveKitConfig = {
  clientUrl: string;
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
};

function requiredEnv(name: "LIVEKIT_URL" | "LIVEKIT_API_KEY" | "LIVEKIT_API_SECRET", arabicName: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${arabicName} غير مضبوط في الخادم`);
  return value;
}

function normalizeLiveKitClientUrl(rawUrl: string) {
  const cleaned = rawUrl.trim().replace(/\/+$/, "");
  if (cleaned.startsWith("wss://") || cleaned.startsWith("ws://")) return cleaned;
  if (cleaned.startsWith("https://")) return `wss://${cleaned.slice("https://".length)}`;
  if (cleaned.startsWith("http://")) return `ws://${cleaned.slice("http://".length)}`;
  throw new Error("رابط LiveKit غير صحيح — يجب أن يبدأ بـ wss:// أو https://");
}

function liveKitApiUrl(clientUrl: string) {
  if (clientUrl.startsWith("wss://")) return `https://${clientUrl.slice("wss://".length)}`;
  if (clientUrl.startsWith("ws://")) return `http://${clientUrl.slice("ws://".length)}`;
  throw new Error("رابط LiveKit غير صحيح");
}

function liveKitConfig(): LiveKitConfig {
  const clientUrl = normalizeLiveKitClientUrl(requiredEnv("LIVEKIT_URL", "LIVEKIT_URL"));
  return {
    clientUrl,
    apiUrl: liveKitApiUrl(clientUrl),
    apiKey: requiredEnv("LIVEKIT_API_KEY", "مفتاح LiveKit"),
    apiSecret: requiredEnv("LIVEKIT_API_SECRET", "سر LiveKit"),
  };
}

function isAlreadyExistsError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return /already\s+exists|exists|409|ALREADY_EXISTS/i.test(text);
}

function normalizeLiveKitServiceError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  if (/401|unauthorized|invalid\s+token|api\s*key|signature/i.test(text)) {
    return new Error(
      "إعدادات LiveKit غير متطابقة: رابط LiveKit أو API Key/Secret غير صحيح. حدّث إعدادات المكالمات ثم جرّب مرة أخرى."
    );
  }
  if (/fetch|network|timeout|ECONN|ENOTFOUND|ETIMEDOUT/i.test(text)) {
    return new Error("تعذّر الوصول إلى خادم LiveKit الآن. تحقق من الاتصال أو رابط LiveKit ثم أعد المحاولة.");
  }
  return new Error(`تعذّر تجهيز غرفة المكالمة: ${text}`);
}

async function ensureLiveKitRoom(room: string) {
  const config = liveKitConfig();
  const client = new RoomServiceClient(config.apiUrl, config.apiKey, config.apiSecret, {
    requestTimeout: 8_000,
  });

  try {
    const rooms = await client.listRooms([room]);
    if (!rooms.some((r: any) => r?.name === room)) {
      try {
        await client.createRoom({
          name: room,
          emptyTimeout: 10 * 60,
          departureTimeout: 2 * 60,
          maxParticipants: 100,
        });
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
      }
    }
  } catch (error) {
    throw normalizeLiveKitServiceError(error);
  }

  return config;
}

async function participantProfile(supabase: any, uid: string): Promise<{ name: string; metadata?: string }> {
  const { data } = await supabase
    .from("profiles")
    .select("display_name, email, avatar_url")
    .eq("user_id", uid)
    .maybeSingle();

  const name = String(data?.display_name || data?.email || "User").trim().slice(0, 120) || "User";
  const avatarUrl = typeof data?.avatar_url === "string" ? data.avatar_url.trim() : "";
  return {
    name,
    metadata: avatarUrl ? JSON.stringify({ avatar_url: avatarUrl }) : undefined,
  };
}

async function mintToken(supabase: any, identity: string, room: string) {
  const config = await ensureLiveKitRoom(room);
  const profile = await participantProfile(supabase, identity);
  const tokenBuilder = new AccessToken(config.apiKey, config.apiSecret, {
    identity,
    name: profile.name,
    metadata: profile.metadata,
    ttl: "6h",
  });

  tokenBuilder.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: true,
    canSubscribeMetrics: true,
  });

  const token = await tokenBuilder.toJwt();

  try {
    await new TokenVerifier(config.apiKey, config.apiSecret).verify(token, 30);
  } catch {
    throw new Error("فشل إنشاء توكن مكالمة صالح. تحقق من إعدادات LiveKit ثم أعد المحاولة.");
  }

  return { token, url: config.clientUrl };
}

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

function callLogLabel(mode: CallMode) {
  return mode === "video" ? "📹 مكالمة فيديو" : "📞 مكالمة صوت";
}

export async function startCallImpl({ data, context }: any) {
  const { supabase, userId } = context;

  const { data: room, error: roomErr } = await supabase
    .from("chat_rooms")
    .select("id, type, name")
    .eq("id", data.room_id)
    .maybeSingle();
  if (roomErr || !room) throw new Error("الغرفة غير موجودة");

  await assertRoomMember(supabase, userId, data.room_id);

  const { data: existing } = await supabase
    .from("chat_calls")
    .select("id, livekit_room, mode, status, initiator_id")
    .eq("room_id", data.room_id)
    .in("status", ["ringing", "active"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const minted = await mintToken(supabase, userId, existing.livekit_room);
    const { error: upsertErr } = await supabase.from("chat_call_participants").upsert(
      { call_id: existing.id, user_id: userId, join_status: "joined", joined_at: new Date().toISOString() },
      { onConflict: "call_id,user_id" }
    );
    if (upsertErr) throw new Error("تعذّر تحديث حالة مشاركتك في المكالمة");
    return {
      call_id: existing.id,
      livekit_room: existing.livekit_room,
      url: minted.url,
      token: minted.token,
      mode: existing.mode,
      reused: true,
    };
  }

  const livekitRoom = `chat_${data.room_id}_${Date.now().toString(36)}`;
  const minted = await mintToken(supabase, userId, livekitRoom);

  const { data: created, error: insertErr } = await supabase
    .from("chat_calls")
    .insert({
      room_id: data.room_id,
      initiator_id: userId,
      mode: data.mode,
      scope: room.type === "direct" ? "dm" : "group",
      status: "ringing",
      livekit_room: livekitRoom,
    })
    .select("id, livekit_room, mode")
    .single();
  if (insertErr || !created) throw new Error(insertErr?.message || "فشل بدء المكالمة");

  const { data: members, error: membersErr } = await supabase
    .from("chat_room_members")
    .select("user_id")
    .eq("room_id", data.room_id);
  if (membersErr) throw new Error("تعذّر تحميل أعضاء الغرفة للمكالمة");

  const rows = (members ?? []).map((m: any) => ({
    call_id: created.id,
    user_id: m.user_id,
    join_status: m.user_id === userId ? "joined" : "invited",
    joined_at: m.user_id === userId ? new Date().toISOString() : null,
  }));
  if (rows.length) {
    const { error } = await supabase.from("chat_call_participants").insert(rows);
    if (error) throw new Error("تعذّر دعوة أعضاء الغرفة للمكالمة");
  }

  const inviteeIds = (members ?? [])
    .map((m: any) => String(m.user_id || ""))
    .filter((id: string) => id && id !== userId);
  if (inviteeIds.length) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const caller = await participantProfile(supabase, userId);
      const callTitle = data.mode === "video" ? "📹 مكالمة فيديو واردة" : "📞 مكالمة صوت واردة";
      const roomName = typeof room.name === "string" && room.name.trim() ? room.name.trim() : null;
      await (supabaseAdmin as any).from("notifications").insert(
        inviteeIds.map((user_id: string) => ({
          user_id,
          type: "incoming_call",
          title: callTitle,
          body: roomName ? `${caller.name} · ${roomName}` : caller.name,
          link: `/team-chat?room=${data.room_id}&call=${created.id}`,
          meta: {
            kind: "incoming_call",
            call_id: created.id,
            room_id: data.room_id,
            mode: data.mode,
            initiator_id: userId,
            room_name: roomName,
          },
        }))
      );
    } catch (error) {
      console.error("[calls] failed to dispatch incoming call notifications", error);
    }
  }

  await supabase.from("chat_messages").insert({
    room_id: data.room_id,
    sender_id: userId,
    body: `${callLogLabel(data.mode)} — بدأت`,
    message_type: "call_log",
    call_id: created.id,
  });

  return {
    call_id: created.id,
    livekit_room: created.livekit_room,
    url: minted.url,
    token: minted.token,
    mode: created.mode,
    reused: false,
  };
}

export async function joinCallImpl({ data, context }: any) {
  const { supabase, userId } = context;
  const { data: call, error } = await supabase
    .from("chat_calls")
    .select("id, livekit_room, mode, status, room_id")
    .eq("id", data.call_id)
    .maybeSingle();
  if (error || !call) throw new Error("المكالمة غير موجودة");
  if (!["ringing", "active"].includes(call.status)) throw new Error("المكالمة انتهت بالفعل");

  await assertRoomMember(supabase, userId, call.room_id);

  const minted = await mintToken(supabase, userId, call.livekit_room);

  if (call.status === "ringing") {
    const { error: updateErr } = await supabase
      .from("chat_calls")
      .update({ status: "active", connected_at: new Date().toISOString() })
      .eq("id", call.id);
    if (updateErr) throw new Error("تعذّر تحديث حالة المكالمة");
  }

  const { error: upsertErr } = await supabase.from("chat_call_participants").upsert(
    { call_id: call.id, user_id: userId, join_status: "joined", joined_at: new Date().toISOString() },
    { onConflict: "call_id,user_id" }
  );
  if (upsertErr) throw new Error("تعذّر الانضمام للمكالمة");

  return { url: minted.url, token: minted.token, livekit_room: call.livekit_room, mode: call.mode };
}

export async function refreshCallTokenImpl({ data, context }: any) {
  const { supabase, userId } = context;
  const { data: call, error } = await supabase
    .from("chat_calls")
    .select("id, livekit_room, mode, status, room_id")
    .eq("id", data.call_id)
    .maybeSingle();
  if (error || !call) throw new Error("المكالمة غير موجودة");
  if (!["ringing", "active"].includes(call.status)) throw new Error("المكالمة انتهت بالفعل");
  await assertRoomMember(supabase, userId, call.room_id);
  const minted = await mintToken(supabase, userId, call.livekit_room);
  return { url: minted.url, token: minted.token, livekit_room: call.livekit_room, mode: call.mode };
}

export async function declineCallImpl({ data, context }: any) {
  const { supabase, userId } = context;
  const { data: call } = await supabase
    .from("chat_calls")
    .select("id, room_id")
    .eq("id", data.call_id)
    .maybeSingle();
  if (!call) throw new Error("المكالمة غير موجودة");
  await assertRoomMember(supabase, userId, call.room_id);

  const { error } = await supabase.from("chat_call_participants").upsert(
    { call_id: data.call_id, user_id: userId, join_status: "declined", left_at: new Date().toISOString(), leave_reason: "declined" },
    { onConflict: "call_id,user_id" }
  );
  if (error) throw new Error("تعذّر رفض المكالمة");
  return { ok: true };
}

export async function cancelCallImpl({ data, context }: any) {
  const { supabase, userId } = context;
  const { data: call } = await supabase
    .from("chat_calls")
    .select("id, initiator_id, status, room_id")
    .eq("id", data.call_id)
    .maybeSingle();
  if (!call) return { ok: true };
  if (call.initiator_id !== userId) throw new Error("فقط صاحب المكالمة يمكنه إلغاؤها");
  if (call.status !== "ringing") return { ok: true };

  const { error: updateErr } = await supabase
    .from("chat_calls")
    .update({ status: "cancelled", ended_at: new Date().toISOString() })
    .eq("id", call.id);
  if (updateErr) throw new Error("تعذّر إلغاء المكالمة");

  await supabase.from("chat_messages").insert({
    room_id: call.room_id,
    sender_id: userId,
    body: "📞 المكالمة اتلغت",
    message_type: "call_log",
    call_id: call.id,
  });
  return { ok: true };
}

export async function leaveCallImpl({ data, context }: any) {
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

    const suffix = nextStatus === "missed" ? "فائتة" : `المدة ${formatDur(duration)}`;
    await supabase.from("chat_messages").insert({
      room_id: call.room_id,
      sender_id: userId,
      body: `${callLogLabel(call.mode)} — ${suffix}`,
      message_type: "call_log",
      call_id: call.id,
    });
  }
  return { ok: true };
}

export async function listRoomCallsImpl({ data, context }: any) {
  const { supabase, userId } = context;
  await assertRoomMember(supabase, userId, data.room_id);
  const { data: rows } = await supabase
    .from("chat_calls")
    .select("id, mode, status, initiator_id, started_at, ended_at, duration_seconds")
    .eq("room_id", data.room_id)
    .order("started_at", { ascending: false })
    .limit(Math.min(data.limit ?? 30, 100));
  return { calls: rows ?? [] };
}

export async function listMyCallHistoryImpl({ data, context }: any) {
  const { supabase, userId } = context;
  const limit = Math.min(data.limit ?? 100, 300);

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
}

function formatDur(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}