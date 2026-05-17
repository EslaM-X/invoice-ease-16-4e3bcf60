import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Send, Plus, Users, MessageSquare, ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listChatRooms, listChatMessages, sendChatMessage, markRoomRead,
  listCompanyMembers, createChatRoom, deleteChatMessage,
} from "@/lib/chat.functions";
import { toast } from "sonner";
import { VoiceRecorder } from "@/components/chat/voice-recorder";
import { VoicePlayer } from "@/components/chat/voice-player";

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

  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [voiceUrls, setVoiceUrls] = useState<Record<string, string>>({});
  const [myProfile, setMyProfile] = useState<{ display_name: string | null; avatar_url: string | null }>({ display_name: null, avatar_url: null });
  const [voiceActive, setVoiceActive] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) setMyProfile({ display_name: data.display_name ?? null, avatar_url: data.avatar_url ?? null });
    })();
  }, [user?.id]);

  const roomsQ = useQuery({
    queryKey: ["chat-rooms"],
    queryFn: () => fetchRooms(),
    refetchInterval: 15000,
  });

  const messagesQ = useQuery({
    queryKey: ["chat-messages", activeRoomId],
    queryFn: () =>
      activeRoomId ? fetchMessages({ data: { room_id: activeRoomId } }) : Promise.resolve({ messages: [] }),
    enabled: !!activeRoomId,
  });

  const membersQ = useQuery({
    queryKey: ["company-members"],
    queryFn: () => fetchMembers(),
    enabled: newOpen,
  });

  // Realtime per room
  useEffect(() => {
    if (!activeRoomId) return;
    const ch = supabase
      .channel(`chat-room-${activeRoomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages", filter: `room_id=eq.${activeRoomId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] });
          qc.invalidateQueries({ queryKey: ["chat-rooms"] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeRoomId, qc]);

  // Global rooms refresh (new rooms / new direct memberships)
  useEffect(() => {
    const ch = supabase
      .channel("chat-rooms-global")
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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messagesQ.data?.messages?.length]);

  const rooms = roomsQ.data?.rooms ?? [];
  const activeRoom = useMemo(() => rooms.find((r: any) => r.id === activeRoomId), [rooms, activeRoomId]);

  // Sign voice-note URLs for visible messages
  useEffect(() => {
    const msgs = messagesQ.data?.messages ?? [];
    const missing = msgs.filter(
      (m: any) => m.voice_note_url && !voiceUrls[m.voice_note_url]
    );
    if (missing.length === 0) return;
    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        missing.map(async (m: any) => {
          const { data } = await supabase.storage
            .from("chat-voice-notes")
            .createSignedUrl(m.voice_note_url, 3600);
          if (data?.signedUrl) updates[m.voice_note_url] = data.signedUrl;
        })
      );
      if (Object.keys(updates).length) {
        setVoiceUrls((prev) => ({ ...prev, ...updates }));
      }
    })();
  }, [messagesQ.data?.messages, voiceUrls]);

  const onSend = async () => {
    const body = composer.trim();
    if (!body || !activeRoomId) return;
    setComposer("");
    try {
      await sendMessage({ data: { room_id: activeRoomId, body, message_type: "text" } });
      qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] });
      qc.invalidateQueries({ queryKey: ["chat-rooms"] });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to send");
      setComposer(body);
    }
  };

  const onSendVoice = async (blob: Blob, durationSeconds: number) => {
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
  };

  return (
    <AppShell>
      <div
        className="flex h-[calc(100dvh-9rem)] sm:h-[calc(100vh-12rem)] rounded-2xl border bg-card overflow-hidden shadow-sm"
        dir={rtl ? "rtl" : "ltr"}
      >
        {/* Sidebar */}
        <div
          className={`${activeRoomId ? "hidden md:flex" : "flex"} w-full md:w-72 md:shrink-0 md:border-e flex-col`}
        >
          <div className="p-3 border-b flex items-center justify-between bg-card/60 backdrop-blur">
            <h2 className="font-semibold flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
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
          <ScrollArea className="flex-1">
            {rooms.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {rtl ? "مفيش محادثات لسه. اعمل واحدة جديدة." : "No conversations yet. Start one."}
              </div>
            )}
            {rooms.map((r: any) => {
              const label =
                r.display_name ??
                (r.type === "direct" ? (rtl ? "محادثة" : "Direct") : (rtl ? "جروب" : "Group"));
              return (
                <button
                  key={r.id}
                  onClick={() => setActiveRoomId(r.id)}
                  className={`w-full text-start p-3 flex items-center gap-3 hover:bg-accent/50 border-b transition ${
                    activeRoomId === r.id ? "bg-accent" : ""
                  }`}
                >
                  <Avatar className="h-10 w-10 ring-2 ring-background shadow">
                    {r.avatar_url && <AvatarImage src={r.avatar_url} />}
                    <AvatarFallback className="bg-gradient-to-br from-primary/80 to-primary text-primary-foreground font-semibold">
                      {label.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{label}</span>
                      {r.unread_count > 0 && (
                        <Badge variant="default" className="h-5 px-1.5 text-xs">{r.unread_count}</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {r.last_message_preview ?? (rtl ? "ابدأ المحادثة" : "Start chatting")}
                    </div>
                  </div>
                </button>
              );
            })}
          </ScrollArea>
        </div>

        {/* Conversation */}
        <div className={`${activeRoomId ? "flex" : "hidden md:flex"} flex-1 flex-col min-w-0`}>
          {activeRoom ? (
            <>
              <div className="p-3 border-b flex items-center gap-3 bg-card/60 backdrop-blur">
                <Button
                  size="icon"
                  variant="ghost"
                  className="md:hidden shrink-0 h-9 w-9"
                  onClick={() => setActiveRoomId(null)}
                  aria-label="Back"
                >
                  {rtl ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
                </Button>
                <Avatar className="h-10 w-10 ring-2 ring-background shadow">
                  {activeRoom.avatar_url && <AvatarImage src={activeRoom.avatar_url} />}
                  <AvatarFallback className="bg-gradient-to-br from-primary/80 to-primary text-primary-foreground font-semibold">
                    {(activeRoom.display_name ?? "G").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">
                    {activeRoom.display_name ??
                      (activeRoom.type === "direct"
                        ? (rtl ? "محادثة مباشرة" : "Direct")
                        : (rtl ? "جروب" : "Group"))}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {activeRoom.type === "group" && activeRoom.members
                      ? `${activeRoom.members.length} ${rtl ? "عضو" : "members"}`
                      : (rtl ? "محادثة مباشرة" : "Direct chat")}
                  </div>
                </div>
              </div>
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2 bg-gradient-to-b from-muted/30 to-muted/10"
              >
                {(messagesQ.data?.messages ?? []).map((m: any) => {
                  const mine = m.sender_id === user?.id;
                  const isGroup = activeRoom.type === "group";
                  const displayName = mine
                    ? (myProfile.display_name ?? (rtl ? "أنا" : "You"))
                    : (m.sender_display_name ?? m.sender_email ?? "?");
                  const avatarUrl = mine ? myProfile.avatar_url : m.sender_avatar_url;
                  return (
                    <div key={m.id} className={`group/msg flex gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                      {!mine && (
                        <Avatar className="h-8 w-8 mt-1 shrink-0 ring-1 ring-border">
                          {avatarUrl && <AvatarImage src={avatarUrl} />}
                          <AvatarFallback className="text-[10px] bg-muted">
                            {displayName.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div
                        className={`max-w-[80%] sm:max-w-[70%] px-3 py-2 rounded-2xl text-sm shadow-sm ${
                          mine
                            ? "bg-primary text-primary-foreground rounded-ee-sm"
                            : "bg-card border rounded-es-sm"
                        }`}
                      >
                        {(!mine || isGroup) && (
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={`text-xs font-semibold truncate ${mine ? "opacity-90" : ""}`}>
                              {displayName}
                            </span>
                            {(mine ? null : m.sender_job_title) && (
                              <span
                                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                style={{
                                  backgroundColor: (m.sender_job_title_color ?? "#64748b") + "22",
                                  color: m.sender_job_title_color ?? "#64748b",
                                }}
                              >
                                {m.sender_job_title}
                              </span>
                            )}
                          </div>
                        )}
                        {m.message_type === "voice" && m.voice_note_url ? (
                          voiceUrls[m.voice_note_url] ? (
                            <VoicePlayer
                              url={voiceUrls[m.voice_note_url]}
                              durationSeconds={m.voice_duration_seconds}
                              tone={mine ? "mine" : "neutral"}
                            />
                          ) : (
                            <div className="text-xs opacity-70">{rtl ? "جاري تحميل الصوت..." : "Loading audio..."}</div>
                          )
                        ) : (
                          <div className="whitespace-pre-wrap break-words leading-relaxed">{m.body}</div>
                        )}
                        <div className="text-[10px] opacity-60 mt-1 text-end">
                          {new Date(m.created_at).toLocaleTimeString(rtl ? "ar-EG" : undefined, {
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </div>
                      </div>
                      {mine && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 self-center opacity-0 group-hover/msg:opacity-100 focus:opacity-100 transition-opacity text-destructive hover:bg-destructive/10"
                          onClick={async () => {
                            if (!confirm(rtl ? "حذف الرسالة؟" : "Delete message?")) return;
                            try {
                              await deleteMsg({ data: { message_id: m.id } });
                              qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] });
                              qc.invalidateQueries({ queryKey: ["chat-rooms"] });
                            } catch (err: any) {
                              toast.error(err?.message ?? "Failed");
                            }
                          }}
                          aria-label={rtl ? "حذف" : "Delete"}
                          title={rtl ? "حذف الرسالة" : "Delete message"}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {mine && (
                        <Avatar className="h-8 w-8 mt-1 shrink-0 ring-1 ring-primary/30">
                          {avatarUrl && <AvatarImage src={avatarUrl} />}
                          <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                            {displayName.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  );
                })}
                {messagesQ.data?.messages?.length === 0 && (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    {rtl ? "ابعت أول رسالة 👋" : "Send the first message 👋"}
                  </div>
                )}
              </div>
              <div className="p-2 sm:p-3 border-t flex gap-2 items-center bg-card/60 backdrop-blur">
                {!voiceActive && (
                  <Input
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    placeholder={rtl ? "اكتب رسالة أو سجل صوت..." : "Type a message or record..."}
                    className="flex-1 min-w-0 rounded-full bg-muted/40 border-muted"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onSend();
                      }
                    }}
                  />
                )}
                {composer.trim() && !voiceActive ? (
                  <Button onClick={onSend} size="icon" className="rounded-full shrink-0">
                    <Send className="h-4 w-4" />
                  </Button>
                ) : (
                  <VoiceRecorder onSend={onSendVoice} rtl={rtl} onActiveChange={setVoiceActive} />
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground p-6 text-center">
              {rtl ? "اختر محادثة عشان تبدأ" : "Pick a conversation to start"}
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
        <Button size="icon" variant="ghost"><Plus className="h-4 w-4" /></Button>
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
                className={`w-full text-start p-2 flex items-center gap-3 hover:bg-accent/50 ${
                  selected.includes(m.user_id) ? "bg-accent" : ""
                }`}
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
