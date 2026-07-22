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
      .select("room_id, last_read_at")
      .eq("user_id", userId);
    if (memErr) throw new Error(memErr.message);
    const roomIds = (memberships ?? []).map((m: any) => m.room_id);
    if (roomIds.length === 0) return { rooms: [] };

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
          .select("user_id, display_name, avatar_url, email, job_title, job_title_color")
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
              job_title: p?.job_title ?? null,
              job_title_color: p?.job_title_color ?? null,
              is_me: m.user_id === userId,
            };
          });

        let display_name: string | null = r.name ?? null;
        let avatar_url: string | null = null;
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
      .select("user_id, display_name, avatar_url, email, job_title, job_title_color")
      .in("user_id", ids);
    const pMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
    return {
      members: (data ?? []).map((m: any) => ({
        user_id: m.user_id,
        email: m.email,
        display_name: pMap.get(m.user_id)?.display_name ?? m.email,
        avatar_url: pMap.get(m.user_id)?.avatar_url ?? null,
        job_title: pMap.get(m.user_id)?.job_title ?? null,
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
          .select("user_id, display_name, avatar_url, job_title, job_title_color")
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

    const enriched = msgs.map((m: any) => {
      const p = pMap.get(m.sender_id);
      const reply = m.reply_to_id ? replyMap.get(m.reply_to_id) : null;
      const replySender = reply ? pMap.get(reply.sender_id) : null;
      return {
        ...m,
        sender_display_name: p?.display_name ?? m.sender_email ?? "Member",
        sender_avatar_url: p?.avatar_url ?? null,
        sender_job_title: p?.job_title ?? null,
        sender_job_title_color: p?.job_title_color ?? null,
        reactions: rMap.get(m.id) ?? [],
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
