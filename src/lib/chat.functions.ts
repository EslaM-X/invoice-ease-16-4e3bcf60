// Internal team chat - server functions
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listChatRooms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // Rooms the current user is a member of
    const { data: memberships, error: memErr } = await supabase
      .from("chat_room_members")
      .select("room_id, last_read_at, role")
      .eq("user_id", userId);
    if (memErr) throw new Error(memErr.message);
    const roomIds = (memberships ?? []).map((m: any) => m.room_id);
    if (roomIds.length === 0) return { rooms: [] };
    const myRoleByRoom: Record<string, string> = {};
    for (const m of memberships ?? []) myRoleByRoom[m.room_id] = m.role ?? "member";

    const { data: rooms, error } = await supabase
      .from("chat_rooms")
      .select("*")
      .in("id", roomIds)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (error) throw new Error(error.message);

    // Pull all members of these rooms (so we can label direct rooms with the
    // other party's name + avatar, and show group member previews).
    const { data: allMembers } = await supabase
      .from("chat_room_members")
      .select("room_id, user_id, user_email")
      .in("room_id", roomIds);

    const otherUserIds = new Set<string>();
    for (const m of allMembers ?? []) {
      if (m.user_id !== userId) otherUserIds.add(m.user_id);
    }
    const { data: profiles } = otherUserIds.size
      ? await supabase
          .from("profiles")
          .select("user_id, display_name, avatar_url, email, job_title, job_title_color, hide_job_title")
          .in("user_id", Array.from(otherUserIds))
      : { data: [] as any[] };
    const pMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));

    // Unread counts
    const lastRead: Record<string, string> = {};
    for (const m of memberships ?? []) lastRead[m.room_id] = m.last_read_at;

    const withUnread = await Promise.all(
      (rooms ?? []).map(async (r: any) => {
        const { count } = await supabase
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("room_id", r.id)
          .is("deleted_at", null)
          .gt("created_at", lastRead[r.id] ?? "1970-01-01")
          .neq("sender_id", userId);

        const roomMembers = (allMembers ?? [])
          .filter((m: any) => m.room_id === r.id)
          .map((m: any) => {
            const p = pMap.get(m.user_id);
            return {
              user_id: m.user_id,
              email: m.user_email ?? p?.email ?? null,
              display_name: p?.display_name ?? m.user_email ?? "Member",
              avatar_url: p?.avatar_url ?? null,
              job_title: p?.hide_job_title ? null : (p?.job_title ?? null),
              job_title_color: p?.job_title_color ?? null,
              is_me: m.user_id === userId,
            };
          });

        let display_name: string | null = r.name ?? null;
        let avatar_url: string | null = r.avatar_url ?? null;
        if (r.type === "direct" && !display_name) {
          const other = roomMembers.find((m: any) => !m.is_me);
          if (other) {
            display_name = other.display_name;
            avatar_url = other.avatar_url;
          }
        }

        return {
          ...r,
          unread_count: count ?? 0,
          members: roomMembers,
          display_name,
          avatar_url,
          my_role: myRoleByRoom[r.id] ?? "member",
        };
      })
    );
    return { rooms: withUnread };
  });

export const listCompanyMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("company_members")
      .select("user_id, email");
    if (error) throw new Error(error.message);
    // Hydrate profiles for display_name + avatar + job_title
    const ids = (data ?? []).map((m: any) => m.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name, avatar_url, email, job_title, job_title_color, hide_job_title")
      .in("user_id", ids);
    const pMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
    return {
      members: (data ?? []).map((m: any) => ({
        user_id: m.user_id,
        email: m.email,
        display_name: pMap.get(m.user_id)?.display_name ?? m.email,
        avatar_url: pMap.get(m.user_id)?.avatar_url ?? null,
        job_title: pMap.get(m.user_id)?.hide_job_title ? null : (pMap.get(m.user_id)?.job_title ?? null),
        job_title_color: pMap.get(m.user_id)?.job_title_color ?? null,
      })),
    };
  });

export const createChatRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        type: z.enum(["direct", "group"]),
        name: z.string().max(80).optional(),
        member_ids: z.array(z.string().uuid()).min(1).max(50),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const myEmail = (claims as any)?.email ?? null;

    // For direct rooms, reuse existing 1-on-1 room
    if (data.type === "direct" && data.member_ids.length === 1) {
      const other = data.member_ids[0];
      const { data: mine } = await supabase
        .from("chat_room_members")
        .select("room_id")
        .eq("user_id", userId);
      const { data: theirs } = await supabase
        .from("chat_room_members")
        .select("room_id")
        .eq("user_id", other);
      const mineSet = new Set((mine ?? []).map((m: any) => m.room_id));
      const overlap = (theirs ?? [])
        .map((t: any) => t.room_id)
        .filter((id: string) => mineSet.has(id));
      if (overlap.length > 0) {
        const { data: r } = await supabase
          .from("chat_rooms")
          .select("*")
          .eq("type", "direct")
          .in("id", overlap)
          .maybeSingle();
        if (r) return { room: r };
      }
    }

    const { data: room, error } = await supabase
      .from("chat_rooms")
      .insert({
        type: data.type,
        name: data.name ?? null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    const allMembers = Array.from(new Set([userId, ...data.member_ids]));
    const { error: memErr } = await supabase.from("chat_room_members").insert(
      allMembers.map((uid) => ({
        room_id: room.id,
        user_id: uid,
        user_email: uid === userId ? myEmail : null,
        role: uid === userId ? "owner" : "member",
      }))
    );
    if (memErr) throw new Error(memErr.message);
    return { room };
  });

export const listChatMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        room_id: z.string().uuid(),
        limit: z.number().min(1).max(200).optional(),
        before_created_at: z.string().optional(),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q = supabase
      .from("chat_messages")
      .select("*")
      .eq("room_id", data.room_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (data.before_created_at) q = q.lt("created_at", data.before_created_at);
    const { data: msgsDesc, error } = await q;
    if (error) throw new Error(error.message);
    const msgs = (msgsDesc ?? []).slice().reverse();

    // Hydrate sender profile
    const senderIds = Array.from(new Set(msgs.map((m: any) => m.sender_id)));
    const { data: profiles } = senderIds.length
      ? await supabase
          .from("profiles")
          .select("user_id, display_name, avatar_url, job_title, job_title_color, hide_job_title")
          .in("user_id", senderIds)
      : { data: [] as any[] };
    const pMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));

    // Hydrate reactions
    const msgIds = msgs.map((m: any) => m.id);
    const { data: reactions } = msgIds.length
      ? await supabase
          .from("chat_reactions")
          .select("message_id, user_id, emoji")
          .in("message_id", msgIds)
      : { data: [] as any[] };
    const rMap = new Map<string, Array<{ emoji: string; user_id: string }>>();
    for (const r of reactions ?? []) {
      const arr = rMap.get(r.message_id) ?? [];
      arr.push({ emoji: r.emoji, user_id: r.user_id });
      rMap.set(r.message_id, arr);
    }

    // Hydrate reply-to snapshots
    const replyIds = Array.from(
      new Set(msgs.map((m: any) => m.reply_to_id).filter(Boolean))
    ) as string[];
    const { data: replyRows } = replyIds.length
      ? await supabase
          .from("chat_messages")
          .select("id, sender_id, body, message_type, voice_note_url")
          .in("id", replyIds)
      : { data: [] as any[] };
    const replyMap = new Map((replyRows ?? []).map((r: any) => [r.id, r]));

    // Hydrate read receipts
    const { data: readRows } = msgIds.length
      ? await supabase
          .from("chat_message_reads")
          .select("message_id, user_id")
          .in("message_id", msgIds)
      : { data: [] as any[] };
    const readMap = new Map<string, string[]>();
    for (const r of readRows ?? []) {
      const arr = readMap.get(r.message_id) ?? [];
      arr.push(r.user_id);
      readMap.set(r.message_id, arr);
    }

    const enriched = msgs.map((m: any) => {
      const p = pMap.get(m.sender_id);
      const reply = m.reply_to_id ? replyMap.get(m.reply_to_id) : null;
      const replySender = reply ? pMap.get(reply.sender_id) : null;
      const readers = (readMap.get(m.id) ?? []).filter((uid) => uid !== m.sender_id);
      return {
        ...m,
        sender_display_name: p?.display_name ?? m.sender_email ?? "Member",
        sender_avatar_url: p?.avatar_url ?? null,
        sender_job_title: p?.hide_job_title ? null : (p?.job_title ?? null),
        sender_job_title_color: p?.job_title_color ?? null,
        reactions: rMap.get(m.id) ?? [],
        read_by_user_ids: readers,
        read_by_count: readers.length,
        reply_to: reply
          ? {
              id: reply.id,
              body: reply.body,
              message_type: reply.message_type,
              voice_note_url: reply.voice_note_url,
              sender_display_name: replySender?.display_name ?? "Member",
            }
          : null,
      };
    });
    return { messages: enriched };
  });

// Mark a batch of messages as read for the current user
export const markMessagesRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        room_id: z.string().uuid(),
        message_ids: z.array(z.string().uuid()).min(1).max(200),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const rows = data.message_ids.map((mid) => ({
      message_id: mid,
      user_id: userId,
      room_id: data.room_id,
    }));
    const { error } = await supabase
      .from("chat_message_reads")
      .upsert(rows, { onConflict: "message_id,user_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { ok: true, count: rows.length };
  });

// Get / set current user's chat wallpaper preference.
// Shape: { default: {type,preset?,path?}, rooms: { [room_id]: {type,preset?,path?} } }
export const getChatWallpaper = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("user_ui_preferences")
      .select("chat_wallpaper")
      .eq("user_id", userId)
      .maybeSingle();
    const raw = (data?.chat_wallpaper as any) ?? null;
    if (raw && typeof raw === "object" && !("default" in raw) && "preset" in raw) {
      return { wallpaper: { default: { type: "preset", preset: raw.preset }, rooms: {} } };
    }
    return {
      wallpaper: raw ?? { default: { type: "preset", preset: "noir" }, rooms: {} },
    };
  });

export const setChatWallpaper = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        scope: z.enum(["default", "room"]),
        room_id: z.string().uuid().optional().nullable(),
        action: z.enum(["preset", "custom", "clear"]),
        preset: z.string().min(1).max(40).optional(),
        path: z.string().min(1).max(500).optional(),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("user_ui_preferences")
      .select("chat_wallpaper")
      .eq("user_id", userId)
      .maybeSingle();
    let current: any = existing?.chat_wallpaper ?? null;
    if (!current || typeof current !== "object" || !("default" in current)) {
      const legacyPreset = current && current.preset ? current.preset : "noir";
      current = { default: { type: "preset", preset: legacyPreset }, rooms: {} };
    }
    if (!current.rooms || typeof current.rooms !== "object") current.rooms = {};

    const value =
      data.action === "preset"
        ? { type: "preset", preset: data.preset ?? "noir" }
        : data.action === "custom"
        ? { type: "custom", path: data.path ?? "" }
        : null;

    if (data.scope === "default") {
      if (value) current.default = value;
    } else {
      if (!data.room_id) throw new Error("room_id required for room scope");
      if (data.action === "clear") {
        delete current.rooms[data.room_id];
      } else if (value) {
        current.rooms[data.room_id] = value;
      }
    }

    const { error } = await supabase
      .from("user_ui_preferences")
      .upsert(
        { user_id: userId, chat_wallpaper: current },
        { onConflict: "user_id" }
      );
    if (error) throw new Error(error.message);
    return { ok: true, wallpaper: current };
  });

// Chat message density preference (comfortable | cozy | compact)
export const getChatDensity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("user_ui_preferences")
      .select("chat_density")
      .eq("user_id", userId)
      .maybeSingle();
    const raw = (data as any)?.chat_density ?? "cozy";
    const density = ["comfortable", "cozy", "compact"].includes(raw) ? raw : "cozy";
    return { density };
  });

export const setChatDensity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ density: z.enum(["comfortable", "cozy", "compact"]) }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_ui_preferences")
      .upsert(
        { user_id: userId, chat_density: data.density } as any,
        { onConflict: "user_id" }
      );
    if (error) throw new Error(error.message);
    return { ok: true, density: data.density };
  });

// Chat layout preference (width + focus mode + sidebar collapsed) — synced per user across devices.
const ChatWidthEnum = z.enum(["default", "wide", "full"]);
const ChatLayoutSchema = z.object({
  width: ChatWidthEnum.optional(),
  focus: z.boolean().optional(),
  sidebar_collapsed: z.boolean().optional(),
});

export const getChatLayout = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("user_ui_preferences")
      .select("chat_layout")
      .eq("user_id", userId)
      .maybeSingle();
    const raw = (data as any)?.chat_layout ?? {};
    const parsed = ChatLayoutSchema.safeParse(raw);
    const layout = parsed.success ? parsed.data : {};
    return {
      layout: {
        width: layout.width ?? "wide",
        focus: layout.focus ?? false,
        sidebar_collapsed: layout.sidebar_collapsed ?? false,
      },
    };
  });

export const setChatLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ChatLayoutSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("user_ui_preferences")
      .select("chat_layout")
      .eq("user_id", userId)
      .maybeSingle();
    const current = ((row as any)?.chat_layout ?? {}) as Record<string, unknown>;
    const merged = { ...current, ...data };
    const { error } = await supabase
      .from("user_ui_preferences")
      .upsert(
        { user_id: userId, chat_layout: merged } as any,
        { onConflict: "user_id" }
      );
    if (error) throw new Error(error.message);
    return { ok: true, layout: merged };
  });

// ---------- Per-conversation scroll position (cross-device sync) ----------

export const getChatRoomScroll = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("user_ui_preferences")
      .select("chat_room_scroll")
      .eq("user_id", userId)
      .maybeSingle();
    const raw = (data as any)?.chat_room_scroll ?? {};
    // Shape: { [roomId]: { top: number, h: number, ts: string } }
    return { scroll: (raw ?? {}) as Record<string, { top: number; h?: number; ts?: string }> };
  });

const RoomScrollSchema = z.object({
  room_id: z.string().uuid(),
  top: z.number().finite().min(0),
  h: z.number().finite().min(0).optional(),
});

export const setChatRoomScroll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => RoomScrollSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("user_ui_preferences")
      .select("chat_room_scroll")
      .eq("user_id", userId)
      .maybeSingle();
    const current = ((row as any)?.chat_room_scroll ?? {}) as Record<string, unknown>;
    // Keep last ~200 rooms to prevent unbounded growth
    const entries = Object.entries(current);
    let base: Record<string, unknown> = current;
    if (entries.length > 200) {
      base = Object.fromEntries(
        entries
          .sort((a, b) => String((b[1] as any)?.ts ?? "").localeCompare(String((a[1] as any)?.ts ?? "")))
          .slice(0, 199)
      );
    }
    const merged = {
      ...base,
      [data.room_id]: { top: Math.round(data.top), h: data.h ? Math.round(data.h) : undefined, ts: new Date().toISOString() },
    };
    const { error } = await supabase
      .from("user_ui_preferences")
      .upsert(
        { user_id: userId, chat_room_scroll: merged } as any,
        { onConflict: "user_id" }
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });



// Update current user's chat display profile (job title + color).
export const updateChatProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        job_title: z.string().trim().max(60).optional().nullable(),
        job_title_color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional()
          .nullable(),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("profiles")
      .update({
        job_title: data.job_title?.trim() || null,
        job_title_color: data.job_title_color || null,
      })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyChatProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("profiles")
      .select("job_title, job_title_color")
      .eq("user_id", userId)
      .maybeSingle();
    return {
      job_title: data?.job_title ?? null,
      job_title_color: data?.job_title_color ?? null,
    };
  });

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        room_id: z.string().uuid(),
        body: z.string().max(4000).optional(),
        message_type: z.enum(["text", "image", "file", "voice"]).default("text"),
        attachments: z
          .array(
            z.object({
              url: z.string(),
              mime: z.string().optional(),
              name: z.string().optional(),
              size: z.number().optional(),
            })
          )
          .optional(),
        voice_note_url: z.string().optional(),
        voice_duration_seconds: z.number().optional(),
        reply_to_id: z.string().uuid().optional(),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const { data: msg, error } = await supabase
      .from("chat_messages")
      .insert({
        room_id: data.room_id,
        sender_id: userId,
        sender_email: (claims as any)?.email ?? null,
        body: data.body ?? null,
        message_type: data.message_type,
        attachments: data.attachments ?? [],
        voice_note_url: data.voice_note_url ?? null,
        voice_duration_seconds: data.voice_duration_seconds ?? null,
        reply_to_id: data.reply_to_id ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    // ---- Mentions → notifications ------------------------------------------
    // Parse @[Name](uuid|all) tokens from the body. For `all`, target every
    // room member (except the sender). Fire-and-forget: never fail the send.
    try {
      const body = data.body ?? "";
      if (body && body.includes("@[")) {
        const re = /@\[([^\]]{1,80})\]\(([a-zA-Z0-9-]{1,64})\)/g;
        const targets = new Set<string>();
        let hasAll = false;
        for (const m of body.matchAll(re)) {
          if (m[2] === "all") hasAll = true;
          else if (m[2] !== userId) targets.add(m[2]);
        }
        if (hasAll) {
          const { data: mem } = await supabase
            .from("chat_room_members")
            .select("user_id")
            .eq("room_id", data.room_id);
          for (const r of mem ?? []) {
            if ((r as any).user_id && (r as any).user_id !== userId) targets.add((r as any).user_id);
          }
        }
        if (targets.size > 0) {
          const senderName =
            ((claims as any)?.user_metadata?.display_name as string | undefined) ||
            ((claims as any)?.email as string | undefined) ||
            "Someone";
          const preview = body
            .replace(re, (_a, name) => `@${name}`)
            .slice(0, 140);
          const rows = [...targets].map((uid) => ({
            user_id: uid,
            type: "chat_mention",
            title: `${senderName} mentioned you`,
            body: preview,
            meta: {
              room_id: data.room_id,
              message_id: (msg as any).id,
              sender_id: userId,
              all: hasAll,
            } as any,
          }));
          await supabase.from("notifications").insert(rows as any);
        }
      }
    } catch {
      // Notification dispatch failures must not block the message write.
    }

    return { message: msg };
  });

export const deleteChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ message_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("chat_messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.message_id)
      .eq("sender_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markRoomRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ room_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("chat_room_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("room_id", data.room_id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updatePresence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ status: z.enum(["online", "away", "offline"]) }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    await supabase.from("chat_presence").upsert({
      user_id: userId,
      user_email: (claims as any)?.email ?? null,
      status: data.status,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return { ok: true };
  });

export const toggleReaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ message_id: z.string().uuid(), emoji: z.string().min(1).max(16) }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("chat_reactions")
      .select("id")
      .eq("message_id", data.message_id)
      .eq("user_id", userId)
      .eq("emoji", data.emoji)
      .maybeSingle();
    if (existing) {
      await supabase.from("chat_reactions").delete().eq("id", existing.id);
      return { toggled: "removed" as const };
    }
    const { error } = await supabase.from("chat_reactions").insert({
      message_id: data.message_id,
      user_id: userId,
      emoji: data.emoji,
    });
    if (error) throw new Error(error.message);
    return { toggled: "added" as const };
  });

export const setTypingState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ room_id: z.string().uuid().nullable() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    await supabase.from("chat_presence").upsert({
      user_id: userId,
      user_email: (claims as any)?.email ?? null,
      status: "online",
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      typing_room_id: data.room_id,
      typing_at: data.room_id ? new Date().toISOString() : null,
    });
    return { ok: true };
  });

export const listRoomPresence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ user_ids: z.array(z.string().uuid()) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (data.user_ids.length === 0) return { presence: [] };
    const { data: rows } = await supabase
      .from("chat_presence")
      .select("user_id, status, last_seen_at, typing_room_id, typing_at")
      .in("user_id", data.user_ids);
    return { presence: rows ?? [] };
  });

// -------- Group admin + wallpaper + info --------

/** Full member list for a room with roles and profile hydration. */
export const listRoomMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ room_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: room } = await supabase
      .from("chat_rooms")
      .select("id, created_by, name, type")
      .eq("id", data.room_id)
      .maybeSingle();
    const { data: mems, error } = await supabase
      .from("chat_room_members")
      .select("user_id, user_email, role, joined_at")
      .eq("room_id", data.room_id);
    if (error) throw new Error(error.message);
    const ids = (mems ?? []).map((m: any) => m.user_id);
    const { data: profiles } = ids.length
      ? await supabase
          .from("profiles")
          .select("user_id, display_name, avatar_url, email, job_title, job_title_color, hide_job_title")
          .in("user_id", ids)
      : { data: [] as any[] };
    const pMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
    const creatorId = room?.created_by ?? null;
    return {
      created_by: creatorId,
      room_type: room?.type ?? null,
      members: (mems ?? []).map((m: any) => {
        const p = pMap.get(m.user_id);
        return {
          user_id: m.user_id,
          email: p?.email ?? m.user_email ?? null,
          display_name: p?.display_name ?? m.user_email ?? "Member",
          avatar_url: p?.avatar_url ?? null,
          job_title: p?.hide_job_title ? null : (p?.job_title ?? null),
          job_title_color: p?.job_title_color ?? null,
          role: m.role ?? "member",
          joined_at: m.joined_at ?? null,
          is_me: m.user_id === userId,
          is_creator: creatorId != null && m.user_id === creatorId,
        };
      }),
    };
  });

/** List company members who are NOT yet in the given room, for the "Add member" picker. */
export const listAddableUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ room_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: mems } = await supabase
      .from("chat_room_members")
      .select("user_id")
      .eq("room_id", data.room_id);
    const existing = new Set((mems ?? []).map((m: any) => m.user_id));
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("user_id, display_name, email, avatar_url, job_title, job_title_color, hide_job_title")
      .order("display_name", { ascending: true });
    if (error) throw new Error(error.message);
    return {
      users: (profiles ?? [])
        .filter((p: any) => !existing.has(p.user_id))
        .map((p: any) => ({
          user_id: p.user_id,
          display_name: p.display_name ?? p.email ?? "Member",
          email: p.email ?? null,
          avatar_url: p.avatar_url ?? null,
          job_title: p.hide_job_title ? null : (p.job_title ?? null),
          job_title_color: p.job_title_color ?? null,
        })),
    };
  });

/** Add one or more users to a room (creator/admin only, enforced by RLS). */
export const addRoomMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      room_id: z.string().uuid(),
      user_ids: z.array(z.string().uuid()).min(1),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, email")
      .in("user_id", data.user_ids);
    const emailMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p.email ?? null]));
    const rows = data.user_ids.map((uid) => ({
      room_id: data.room_id,
      user_id: uid,
      user_email: emailMap.get(uid) ?? null,
      role: "member",
    }));
    const { error } = await supabase
      .from("chat_room_members")
      .upsert(rows, { onConflict: "room_id,user_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { ok: true, added: rows.length };
  });

/** Info about who saw / can see a specific message. */
export const getMessageInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ message_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: msg, error } = await supabase
      .from("chat_messages")
      .select("id, room_id, sender_id, created_at")
      .eq("id", data.message_id)
      .maybeSingle();
    if (error || !msg) throw new Error(error?.message ?? "not_found");

    const { data: mems } = await supabase
      .from("chat_room_members")
      .select("user_id")
      .eq("room_id", msg.room_id);
    const memberIds = (mems ?? []).map((m: any) => m.user_id).filter((u: string) => u !== msg.sender_id);

    // Prefer `read_at`; fall back to `created_at` on older schemas where the column is missing.
    let readsRows: Array<{ user_id: string; read_at: string | null }> = [];
    {
      const r1 = await supabase
        .from("chat_message_reads")
        .select("user_id, read_at")
        .eq("message_id", data.message_id);
      if (!r1.error) {
        readsRows = (r1.data ?? []).map((r: any) => ({ user_id: r.user_id, read_at: r.read_at ?? null }));
      } else {
        const r2 = await supabase
          .from("chat_message_reads")
          .select("user_id, created_at")
          .eq("message_id", data.message_id);
        readsRows = (r2.data ?? []).map((r: any) => ({ user_id: r.user_id, read_at: r.created_at ?? null }));
      }
    }
    const seenMap = new Map(readsRows.map((r) => [r.user_id, r.read_at]));

    const { data: presence } = memberIds.length
      ? await supabase
          .from("chat_presence")
          .select("user_id, status, last_seen_at")
          .in("user_id", memberIds)
      : { data: [] as any[] };
    const pMap = new Map((presence ?? []).map((p: any) => [p.user_id, p]));

    const { data: profiles } = memberIds.length
      ? await supabase
          .from("profiles")
          .select("user_id, display_name, avatar_url, email")
          .in("user_id", memberIds)
      : { data: [] as any[] };
    const prMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));

    const sentAt = new Date(msg.created_at).getTime();
    const rows = memberIds.map((uid: string) => {
      const seenAt = seenMap.get(uid) ?? null;
      const pres = pMap.get(uid);
      const lastSeen = pres?.last_seen_at ? new Date(pres.last_seen_at).getTime() : 0;
      const onlineNow = pres?.status !== "offline" && lastSeen && Date.now() - lastSeen < 90_000;
      const delivered = !!seenAt || lastSeen >= sentAt;
      const pr = prMap.get(uid);
      return {
        user_id: uid,
        display_name: pr?.display_name ?? pr?.email ?? "Member",
        avatar_url: pr?.avatar_url ?? null,
        seen_at: seenAt,
        delivered,
        online_now: !!onlineNow,
      };
    });

    const seenTimes = readsRows.map((r) => r.read_at).filter(Boolean) as string[];
    const lastReadAt = seenTimes.length
      ? seenTimes.reduce((a, b) => (a > b ? a : b))
      : null;

    return {
      sent_at: msg.created_at,
      last_read_at: lastReadAt,
      seen: rows.filter((r) => r.seen_at).sort((a, b) => (b.seen_at! < a.seen_at! ? -1 : 1)),
      delivered: rows.filter((r) => !r.seen_at && r.delivered),
      pending: rows.filter((r) => !r.delivered),
      online_count: rows.filter((r) => r.online_now).length,
      total_recipients: rows.length,
    };
  });

/** Get the room-level (admin-set) wallpaper. */
export const getRoomWallpaper = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ room_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: r } = await supabase
      .from("chat_rooms")
      .select("wallpaper")
      .eq("id", data.room_id)
      .maybeSingle();
    return { wallpaper: (r?.wallpaper as any) ?? null };
  });

export const setRoomWallpaper = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      room_id: z.string().uuid(),
      wallpaper: z.any().nullable(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("chat_set_room_wallpaper", {
      _room_id: data.room_id,
      _wallpaper: data.wallpaper,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      room_id: z.string().uuid(),
      target_user: z.string().uuid(),
      role: z.enum(["admin", "member"]),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("chat_set_member_role", {
      _room_id: data.room_id,
      _target_user: data.target_user,
      _role: data.role,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      room_id: z.string().uuid(),
      target_user: z.string().uuid(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("chat_remove_member", {
      _room_id: data.room_id,
      _target_user: data.target_user,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Update the group chat's name and/or avatar. Admin or creator only (enforced by RPC). */
export const updateRoomProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      room_id: z.string().uuid(),
      name: z.string().max(80).nullable().optional(),
      avatar_url: z.string().url().nullable().optional(),
      clear_avatar: z.boolean().optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("chat_update_room_profile", {
      _room_id: data.room_id,
      _name: data.name ?? null,
      _avatar_url: data.avatar_url ?? null,
      _clear_avatar: data.clear_avatar ?? false,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
