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
      .order("last_message_at", { ascending: false });
    if (error) throw new Error(error.message);

    // Unread counts
    const lastRead: Record<string, string> = {};
    for (const m of memberships ?? []) lastRead[m.room_id] = m.last_read_at;

    const withUnread = await Promise.all(
      (rooms ?? []).map(async (r: any) => {
        const { count } = await supabase
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("room_id", r.id)
          .gt("created_at", lastRead[r.id] ?? "1970-01-01")
          .neq("sender_id", userId);
        return { ...r, unread_count: count ?? 0 };
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
    // Hydrate profiles for display_name + avatar
    const ids = (data ?? []).map((m: any) => m.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name, avatar_url, email")
      .in("user_id", ids);
    const pMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
    return {
      members: (data ?? []).map((m: any) => ({
        user_id: m.user_id,
        email: m.email,
        display_name: pMap.get(m.user_id)?.display_name ?? m.email,
        avatar_url: pMap.get(m.user_id)?.avatar_url ?? null,
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
      .object({ room_id: z.string().uuid(), limit: z.number().min(1).max(200).optional() })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: msgs, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("room_id", data.room_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(data.limit ?? 100);
    if (error) throw new Error(error.message);
    return { messages: msgs ?? [] };
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
