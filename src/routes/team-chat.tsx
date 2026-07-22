import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Plus, Users, MessageSquare, ArrowLeft, ArrowRight, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { uniqueRealtimeTopic } from "@/lib/realtime";
import {
  listChatRooms, listChatMessages, sendChatMessage, markRoomRead,
  listCompanyMembers, createChatRoom, deleteChatMessage,
  toggleReaction, setTypingState, updatePresence,
  markMessagesRead, getChatWallpaper, setChatWallpaper,
} from "@/lib/chat.functions";
import { toast } from "sonner";
import { Composer } from "@/components/chat/composer";
import { MessageBubble, type ChatMsg } from "@/components/chat/message-bubble";
import { useRoomPresence } from "@/lib/use-chat-presence";
import { WallpaperPicker, WALLPAPER_STYLES, type WallpaperPreset } from "@/components/chat/wallpaper-picker";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/team-chat")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: TeamChatPage,
});

function TeamChatPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const rtl = lang === "ar";
  const qc = useQueryClient();
  const fetchRooms = useServerFn(listChatRooms);
  const fetchMessages = useServerFn(listChatMessages);
  const sendMessage = useServerFn(sendChatMessage);
  const markRead = useServerFn(markRoomRead);
  const fetchMembers = useServerFn(listCompanyMembers);
  const createRoom = useServerFn(createChatRoom);
  const deleteMsg = useServerFn(deleteChatMessage);
  const reactFn = useServerFn(toggleReaction);
  const typingFn = useServerFn(setTypingState);
  const presenceFn = useServerFn(updatePresence);
  const markReadsFn = useServerFn(markMessagesRead);
  const getWallpaperFn = useServerFn(getChatWallpaper);
  const setWallpaperFn = useServerFn(setChatWallpaper);

  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMsg | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [wallpaper, setWallpaper] = useState<WallpaperPreset>("noir");
  const [pendingMessages, setPendingMessages] = useState<ChatMsg[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [voiceUrls, setVoiceUrls] = useState<Record<string, string>>({});
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});

  // Load wallpaper preference once
  useEffect(() => {
    getWallpaperFn().then((r: any) => {
      const p = (r?.wallpaper?.preset ?? "noir") as WallpaperPreset;
      if (p in WALLPAPER_STYLES) setWallpaper(p);
    }).catch(() => {});
  }, [getWallpaperFn]);

  const changeWallpaper = useCallback(async (p: WallpaperPreset) => {
    setWallpaper(p);
    try { await setWallpaperFn({ data: { preset: p } }); } catch (err: any) { toast.error(err?.message ?? "Failed"); }
  }, [setWallpaperFn]);


  const roomsQ = useQuery({
    queryKey: ["chat-rooms"],
    queryFn: () => fetchRooms(),
    refetchInterval: 20000,
  });

  const messagesQ = useQuery({
    queryKey: ["chat-messages", activeRoomId],
    queryFn: () =>
      activeRoomId ? fetchMessages({ data: { room_id: activeRoomId, limit: 100 } }) : Promise.resolve({ messages: [] }),
    enabled: !!activeRoomId,
  });

  const membersQ = useQuery({
    queryKey: ["company-members"],
    queryFn: () => fetchMembers(),
    enabled: newOpen,
  });

  const rooms = roomsQ.data?.rooms ?? [];
  const activeRoom = useMemo(() => rooms.find((r: any) => r.id === activeRoomId), [rooms, activeRoomId]);
  const filteredRooms = useMemo(() => {
    if (!searchTerm.trim()) return rooms;
    const s = searchTerm.trim().toLowerCase();
    return rooms.filter((r: any) => (r.display_name ?? "").toLowerCase().includes(s));
  }, [rooms, searchTerm]);

  // Presence for all room members
  const allMemberIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of rooms) for (const m of r.members ?? []) set.add(m.user_id);
    return Array.from(set);
  }, [rooms]);
  const { isOnline, lastSeen, typingUserIds } = useRoomPresence(allMemberIds, activeRoomId, user?.id);

  // Heartbeat presence
  useEffect(() => {
    if (!user?.id) return;
    presenceFn({ data: { status: "online" } });
    const beat = window.setInterval(() => { presenceFn({ data: { status: "online" } }); }, 25000);
    const onVis = () => { presenceFn({ data: { status: document.hidden ? "away" : "online" } }); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("beforeunload", () => { presenceFn({ data: { status: "offline" } }); });
    return () => {
      window.clearInterval(beat);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [user?.id, presenceFn]);

  // Realtime per room
  useEffect(() => {
    if (!activeRoomId) return;
    const ch = supabase
      .channel(uniqueRealtimeTopic(`chat-room-${activeRoomId}`))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages", filter: `room_id=eq.${activeRoomId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] });
          qc.invalidateQueries({ queryKey: ["chat-rooms"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_reactions" },
        () => qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] })
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_message_reads", filter: `room_id=eq.${activeRoomId}` },
        () => qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] })
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeRoomId, qc]);

  // Global rooms refresh
  useEffect(() => {
    const ch = supabase
      .channel(uniqueRealtimeTopic("chat-rooms-global"))
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_rooms" }, () => {
        qc.invalidateQueries({ queryKey: ["chat-rooms"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_room_members" }, () => {
        qc.invalidateQueries({ queryKey: ["chat-rooms"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  useEffect(() => {
    if (activeRoomId) {
      markRead({ data: { room_id: activeRoomId } }).then(() =>
        qc.invalidateQueries({ queryKey: ["chat-rooms"] })
      );
    }
  }, [activeRoomId, markRead, qc]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messagesQ.data?.messages?.length, typingUserIds.length]);

  // Sign voice + attachment URLs
  useEffect(() => {
    const msgs = messagesQ.data?.messages ?? [];
    const missingVoice = msgs.filter((m: any) => m.voice_note_url && !voiceUrls[m.voice_note_url]);
    const missingAtt: string[] = [];
    for (const m of msgs) {
      for (const a of m.attachments ?? []) {
        if (a.url && !attachmentUrls[a.url]) missingAtt.push(a.url);
      }
    }
    if (missingVoice.length === 0 && missingAtt.length === 0) return;
    (async () => {
      const vUpdates: Record<string, string> = {};
      await Promise.all(
        missingVoice.map(async (m: any) => {
          const { data } = await supabase.storage.from("chat-voice-notes").createSignedUrl(m.voice_note_url, 3600);
          if (data?.signedUrl) vUpdates[m.voice_note_url] = data.signedUrl;
        })
      );
      const aUpdates: Record<string, string> = {};
      await Promise.all(
        missingAtt.map(async (path) => {
          const { data } = await supabase.storage.from("chat-attachments").createSignedUrl(path, 3600);
          if (data?.signedUrl) aUpdates[path] = data.signedUrl;
        })
      );
      if (Object.keys(vUpdates).length) setVoiceUrls((p) => ({ ...p, ...vUpdates }));
      if (Object.keys(aUpdates).length) setAttachmentUrls((p) => ({ ...p, ...aUpdates }));
    })();
  }, [messagesQ.data?.messages, voiceUrls, attachmentUrls]);

  const onSendText = useCallback(async (body: string, replyId: string | null) => {
    if (!activeRoomId || !user?.id) return;
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: ChatMsg = {
      id: tempId,
      sender_id: user.id,
      body,
      message_type: "text",
      created_at: new Date().toISOString(),
      sender_display_name: (user.user_metadata as any)?.display_name ?? user.email ?? "You",
      sender_avatar_url: (user.user_metadata as any)?.avatar_url ?? null,
      __pending: true,
    };
    setPendingMessages((prev) => [...prev, optimistic]);
    try {
      await sendMessage({ data: { room_id: activeRoomId, body, message_type: "text", reply_to_id: replyId ?? undefined } });
      qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] });
      qc.invalidateQueries({ queryKey: ["chat-rooms"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed");
    } finally {
      setPendingMessages((prev) => prev.filter((m) => m.id !== tempId));
    }
  }, [activeRoomId, sendMessage, qc, user]);

  const onSendVoice = useCallback(async (blob: Blob, durationSeconds: number) => {
    if (!activeRoomId) return;
    const ext = blob.type.includes("mp4") ? "m4a" : "webm";
    const path = `${activeRoomId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("chat-voice-notes")
      .upload(path, blob, { contentType: blob.type, upsert: false });
    if (upErr) throw new Error(upErr.message);
    await sendMessage({
      data: {
        room_id: activeRoomId,
        message_type: "voice",
        voice_note_url: path,
        voice_duration_seconds: Math.max(1, Math.round(durationSeconds)),
      },
    });
    qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] });
    qc.invalidateQueries({ queryKey: ["chat-rooms"] });
  }, [activeRoomId, sendMessage, qc]);

  const onSendImage = useCallback(async (path: string, name: string, mime: string, size: number, replyId: string | null) => {
    if (!activeRoomId) return;
    await sendMessage({
      data: {
        room_id: activeRoomId,
        message_type: "image",
        attachments: [{ url: path, name, mime, size }],
        reply_to_id: replyId ?? undefined,
      },
    });
    qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] });
    qc.invalidateQueries({ queryKey: ["chat-rooms"] });
  }, [activeRoomId, sendMessage, qc]);

  const onTypingChange = useCallback((typing: boolean) => {
    if (!activeRoomId) return;
    typingFn({ data: { room_id: typing ? activeRoomId : null } });
  }, [activeRoomId, typingFn]);

  const onToggleReaction = useCallback(async (m: ChatMsg, emoji: string) => {
    try {
      await reactFn({ data: { message_id: m.id, emoji } });
      qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed");
    }
  }, [reactFn, qc, activeRoomId]);

  const onDelete = useCallback(async (m: ChatMsg) => {
    if (!confirm(rtl ? "حذف الرسالة؟" : "Delete this message?")) return;
    try {
      await deleteMsg({ data: { message_id: m.id } });
      qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed");
    }
  }, [deleteMsg, qc, activeRoomId, rtl]);

  const serverMessages: ChatMsg[] = messagesQ.data?.messages ?? [];
  const messages: ChatMsg[] = useMemo(() => {
    if (pendingMessages.length === 0) return serverMessages;
    // Drop optimistic entries whose body already appears in the last server messages
    const recentServerBodies = new Set(
      serverMessages.slice(-10)
        .filter((m) => m.sender_id === user?.id && m.message_type === "text")
        .map((m) => (m.body ?? "").trim())
    );
    const stillPending = pendingMessages.filter(
      (m) => !recentServerBodies.has((m.body ?? "").trim())
    );
    return [...serverMessages, ...stillPending];
  }, [serverMessages, pendingMessages, user?.id]);

  // Mark visible messages as read (excluding own)
  useEffect(() => {
    if (!activeRoomId || !user?.id) return;
    const unreadIds = serverMessages
      .filter((m) =>
        m.sender_id !== user.id &&
        !(m.read_by_user_ids ?? []).includes(user.id) &&
        !m.__pending &&
        !m.id.startsWith("pending-")
      )
      .map((m) => m.id);
    if (unreadIds.length === 0) return;
    markReadsFn({ data: { room_id: activeRoomId, message_ids: unreadIds } }).catch(() => {});
  }, [serverMessages, activeRoomId, user?.id, markReadsFn]);

  // Typing display names
  const typingNames = useMemo(() => {
    if (!activeRoom) return [];
    return (activeRoom.members ?? [])
      .filter((m: any) => typingUserIds.includes(m.user_id))
      .map((m: any) => (m.display_name ?? m.email ?? "?").split(" ")[0]);
  }, [activeRoom, typingUserIds]);

  return (
    <AppShell>
      <div
        className="flex rounded-2xl border bg-card overflow-hidden shadow-lg"
        style={{ height: "min(calc(100dvh - 8rem), calc(100vh - 8rem))" }}
        dir={rtl ? "rtl" : "ltr"}
      >
        {/* Sidebar */}
        <div
          className={cn(
            "w-full md:w-80 md:shrink-0 md:border-e flex-col",
            activeRoomId ? "hidden md:flex" : "flex"
          )}
        >
          <div className="p-3 border-b flex items-center justify-between bg-gradient-to-b from-card to-card/70 backdrop-blur">
            <h2 className="font-bold text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              {rtl ? "الشات الداخلي" : "Team Chat"}
            </h2>
            <NewChatDialog
              open={newOpen}
              onOpenChange={setNewOpen}
              members={membersQ.data?.members ?? []}
              currentUserId={user?.id ?? ""}
              onCreate={async (payload) => {
                try {
                  const { room } = await createRoom({ data: payload });
                  setNewOpen(false);
                  setActiveRoomId(room.id);
                  qc.invalidateQueries({ queryKey: ["chat-rooms"] });
                } catch (err: any) {
                  toast.error(err.message ?? "Failed");
                }
              }}
              rtl={rtl}
            />
          </div>
          <div className="p-2 border-b">
            <div className="relative">
              <Search className={cn("h-4 w-4 absolute top-1/2 -translate-y-1/2 text-muted-foreground", rtl ? "right-3" : "left-3")} />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={rtl ? "بحث..." : "Search..."}
                className={cn("bg-muted/40 border-0 rounded-full h-9", rtl ? "pr-9" : "pl-9")}
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            {filteredRooms.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {searchTerm
                  ? (rtl ? "لا نتائج" : "No results")
                  : (rtl ? "مفيش محادثات لسه. اعمل واحدة جديدة." : "No conversations yet. Start one.")}
              </div>
            )}
            {filteredRooms.map((r: any) => {
              const label = r.display_name ?? (r.type === "direct" ? (rtl ? "محادثة" : "Direct") : (rtl ? "جروب" : "Group"));
              const otherMember = r.type === "direct" ? (r.members ?? []).find((m: any) => !m.is_me) : null;
              const online = otherMember ? isOnline(otherMember.user_id) : false;
              const roomTyping = typingUserIds.length > 0 && r.id === activeRoomId;
              return (
                <button
                  key={r.id}
                  onClick={() => setActiveRoomId(r.id)}
                  className={cn(
                    "w-full text-start p-3 flex items-center gap-3 border-b transition-all",
                    "hover:bg-accent/50 active:bg-accent",
                    activeRoomId === r.id && "bg-accent"
                  )}
                >
                  <div className="relative shrink-0">
                    <Avatar className="h-11 w-11 ring-2 ring-primary/20 shadow-sm">
                      {r.avatar_url && <AvatarImage src={r.avatar_url} />}
                      <AvatarFallback className="bg-gradient-to-br from-primary/80 to-primary text-primary-foreground font-semibold">
                        {label.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {online && (
                      <span className="absolute bottom-0 end-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-card" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm truncate">{label}</span>
                      {r.unread_count > 0 && (
                        <Badge className="h-5 min-w-5 px-1.5 text-[10px] rounded-full bg-primary shadow">
                          {r.unread_count}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {roomTyping
                        ? <span className="text-primary italic">{rtl ? "يكتب الآن..." : "typing..."}</span>
                        : (r.last_message_preview ?? (rtl ? "ابدأ المحادثة" : "Start chatting"))}
                    </div>
                  </div>
                </button>
              );
            })}
          </ScrollArea>
        </div>

        {/* Conversation */}
        <div className={cn("flex-1 flex-col min-w-0", activeRoomId ? "flex" : "hidden md:flex")}>
          {activeRoom ? (
            <>
              <div className="p-3 border-b flex items-center gap-3 bg-gradient-to-b from-card to-card/70 backdrop-blur-xl">
                <Button
                  size="icon"
                  variant="ghost"
                  className="md:hidden shrink-0 h-9 w-9"
                  onClick={() => setActiveRoomId(null)}
                  aria-label="Back"
                >
                  {rtl ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
                </Button>
                <div className="relative shrink-0">
                  <Avatar className="h-10 w-10 ring-2 ring-primary/30 shadow">
                    {activeRoom.avatar_url && <AvatarImage src={activeRoom.avatar_url} />}
                    <AvatarFallback className="bg-gradient-to-br from-primary/80 to-primary text-primary-foreground font-semibold">
                      {(activeRoom.display_name ?? "G").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  {activeRoom.type === "direct" && (() => {
                    const other = (activeRoom.members ?? []).find((m: any) => !m.is_me);
                    return other && isOnline(other.user_id) ? (
                      <span className="absolute bottom-0 end-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-card" />
                    ) : null;
                  })()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">
                    {activeRoom.display_name ?? (activeRoom.type === "direct" ? (rtl ? "محادثة مباشرة" : "Direct") : (rtl ? "جروب" : "Group"))}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {typingNames.length > 0 ? (
                      <span className="text-primary italic">
                        {typingNames.slice(0, 2).join(", ")} {rtl ? "يكتب..." : "typing..."}
                      </span>
                    ) : activeRoom.type === "group" ? (
                      `${(activeRoom.members ?? []).length} ${rtl ? "عضو" : "members"}`
                    ) : (() => {
                      const other = (activeRoom.members ?? []).find((m: any) => !m.is_me);
                      if (!other) return rtl ? "محادثة مباشرة" : "Direct chat";
                      if (isOnline(other.user_id)) return rtl ? "متصل الآن" : "online";
                      const ls = lastSeen(other.user_id);
                      if (ls) return `${rtl ? "آخر ظهور " : "last seen "}${new Date(ls).toLocaleString(rtl ? "ar-EG" : undefined, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}`;
                      return rtl ? "غير متصل" : "offline";
                    })()}
                  </div>
                </div>
                <WallpaperPicker value={wallpaper} onChange={changeWallpaper} rtl={rtl} />
              </div>

              <div
                ref={scrollRef}
                className={cn(
                  "flex-1 overflow-y-auto p-3 sm:p-4 space-y-1.5",
                  WALLPAPER_STYLES[wallpaper]
                )}
              >
                <AnimatePresence initial={false}>
                  {messages.map((m, i) => {
                    const prev = messages[i - 1];
                    const next = messages[i + 1];
                    const mine = m.sender_id === user?.id;
                    const sameSenderAsPrev = prev && prev.sender_id === m.sender_id;
                    const sameSenderAsNext = next && next.sender_id === m.sender_id;
                    const showName = !sameSenderAsPrev;
                    const showAvatar = !sameSenderAsNext;
                    return (
                      <MessageBubble
                        key={m.id}
                        msg={m}
                        mine={mine}
                        showAvatar={showAvatar}
                        showName={showName}
                        rtl={rtl}
                        voiceUrl={m.voice_note_url ? voiceUrls[m.voice_note_url] : undefined}
                        attachmentUrls={attachmentUrls}
                        isGroup={activeRoom.type === "group"}
                        isRead={true}
                        onReply={setReplyTo}
                        onDelete={onDelete}
                        onToggleReaction={onToggleReaction}
                      />
                    );
                  })}
                </AnimatePresence>

                {typingNames.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 text-xs text-muted-foreground ps-10"
                  >
                    <div className="flex gap-0.5">
                      {[0, 150, 300].map((d) => (
                        <span key={d} className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </div>
                    <span className="italic">{typingNames.join(", ")} {rtl ? "يكتب..." : "typing..."}</span>
                  </motion.div>
                )}

                {messages.length === 0 && (
                  <div className="text-center text-sm text-muted-foreground py-12">
                    {rtl ? "ابعت أول رسالة 👋" : "Send the first message 👋"}
                  </div>
                )}
              </div>

              <Composer
                rtl={rtl}
                activeRoomId={activeRoom.id}
                replyTo={replyTo}
                onClearReply={() => setReplyTo(null)}
                onTypingChange={onTypingChange}
                onSendText={onSendText}
                onSendVoice={onSendVoice}
                onSendImage={onSendImage}
              />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-6 text-center gap-3">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <MessageSquare className="h-8 w-8 text-primary" />
              </div>
              <div className="font-semibold text-foreground">
                {rtl ? "اختر محادثة عشان تبدأ" : "Pick a conversation to start"}
              </div>
              <div className="text-xs max-w-xs">
                {rtl ? "أو ابدأ محادثة جديدة من زر +" : "Or start a new one from the + button"}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function NewChatDialog({
  open, onOpenChange, members, currentUserId, onCreate, rtl,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  members: any[];
  currentUserId: string;
  onCreate: (p: { type: "direct" | "group"; name?: string; member_ids: string[] }) => Promise<void>;
  rtl: boolean;
}) {
  const [type, setType] = useState<"direct" | "group">("direct");
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const eligible = members.filter((m) => m.user_id !== currentUserId);

  const toggle = (id: string) => {
    if (type === "direct") setSelected([id]);
    else setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const submit = async () => {
    if (selected.length === 0) return;
    if (type === "group" && !groupName.trim()) return;
    await onCreate({
      type,
      name: type === "group" ? groupName.trim() : undefined,
      member_ids: selected,
    });
    setSelected([]); setGroupName(""); setType("direct");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="rounded-full"><Plus className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent dir={rtl ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{rtl ? "محادثة جديدة" : "New conversation"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant={type === "direct" ? "default" : "outline"} onClick={() => { setType("direct"); setSelected([]); }}>
              <Users className="h-4 w-4 me-1" />{rtl ? "محادثة فردية" : "Direct"}
            </Button>
            <Button size="sm" variant={type === "group" ? "default" : "outline"} onClick={() => { setType("group"); setSelected([]); }}>
              {rtl ? "جروب" : "Group"}
            </Button>
          </div>
          {type === "group" && (
            <Input
              placeholder={rtl ? "اسم الجروب" : "Group name"}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          )}
          <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
            {eligible.map((m) => (
              <button
                key={m.user_id}
                onClick={() => toggle(m.user_id)}
                className={cn(
                  "w-full text-start p-2 flex items-center gap-3 hover:bg-accent/50",
                  selected.includes(m.user_id) && "bg-accent"
                )}
              >
                <Avatar className="h-8 w-8">
                  {m.avatar_url && <AvatarImage src={m.avatar_url} />}
                  <AvatarFallback>{(m.display_name ?? m.email ?? "?").charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-2">
                    {m.display_name ?? m.email}
                    {m.job_title && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: (m.job_title_color ?? "#64748b") + "22",
                          color: m.job_title_color ?? "#64748b",
                        }}
                      >
                        {m.job_title}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                </div>
                {selected.includes(m.user_id) && <Badge>✓</Badge>}
              </button>
            ))}
            {eligible.length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {rtl ? "مفيش أعضاء آخرين" : "No other members"}
              </div>
            )}
          </div>
          <Button className="w-full" onClick={submit} disabled={selected.length === 0 || (type === "group" && !groupName.trim())}>
            {rtl ? "إنشاء" : "Create"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
