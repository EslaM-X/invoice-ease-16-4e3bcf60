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
import { Send, Plus, Users, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listChatRooms, listChatMessages, sendChatMessage, markRoomRead,
  listCompanyMembers, createChatRoom,
} from "@/lib/chat.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/team-chat")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: TeamChatPage,
});

function TeamChatPage() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const rtl = lang === "ar";
  const qc = useQueryClient();
  const fetchRooms = useServerFn(listChatRooms);
  const fetchMessages = useServerFn(listChatMessages);
  const sendMessage = useServerFn(sendChatMessage);
  const markRead = useServerFn(markRoomRead);
  const fetchMembers = useServerFn(listCompanyMembers);
  const createRoom = useServerFn(createChatRoom);

  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // Realtime subscription
  useEffect(() => {
    if (!activeRoomId) return;
    const ch = supabase
      .channel(`chat-room-${activeRoomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${activeRoomId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] });
          qc.invalidateQueries({ queryKey: ["chat-rooms"] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [activeRoomId, qc]);

  // Global realtime to refresh rooms list on any new message
  useEffect(() => {
    const ch = supabase
      .channel("chat-rooms-global")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_rooms" }, () => {
        qc.invalidateQueries({ queryKey: ["chat-rooms"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  // Mark as read when opening
  useEffect(() => {
    if (activeRoomId) {
      markRead({ data: { room_id: activeRoomId } }).then(() =>
        qc.invalidateQueries({ queryKey: ["chat-rooms"] })
      );
    }
  }, [activeRoomId, markRead, qc]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messagesQ.data?.messages?.length]);

  const rooms = roomsQ.data?.rooms ?? [];
  const activeRoom = useMemo(() => rooms.find((r: any) => r.id === activeRoomId), [rooms, activeRoomId]);

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

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-12rem)] gap-3 rounded-xl border bg-card overflow-hidden" dir={rtl ? "rtl" : "ltr"}>
        {/* Sidebar */}
        <div className="w-72 shrink-0 border-e flex flex-col">
          <div className="p-3 border-b flex items-center justify-between">
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
            {rooms.map((r: any) => (
              <button
                key={r.id}
                onClick={() => setActiveRoomId(r.id)}
                className={`w-full text-start p-3 flex items-center gap-3 hover:bg-accent/50 border-b transition ${
                  activeRoomId === r.id ? "bg-accent" : ""
                }`}
              >
                <Avatar className="h-10 w-10">
                  <AvatarFallback>{(r.name ?? "G").charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate">
                      {r.name ?? (r.type === "direct" ? (rtl ? "محادثة" : "Direct") : (rtl ? "جروب" : "Group"))}
                    </span>
                    {r.unread_count > 0 && (
                      <Badge variant="default" className="h-5 px-1.5 text-xs">{r.unread_count}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {r.last_message_preview ?? (rtl ? "ابدأ المحادثة" : "Start chatting")}
                  </div>
                </div>
              </button>
            ))}
          </ScrollArea>
        </div>

        {/* Conversation */}
        <div className="flex-1 flex flex-col min-w-0">
          {activeRoom ? (
            <>
              <div className="p-3 border-b flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback>{(activeRoom.name ?? "G").charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-semibold">
                    {activeRoom.name ?? (activeRoom.type === "direct" ? (rtl ? "محادثة مباشرة" : "Direct") : (rtl ? "جروب" : "Group"))}
                  </div>
                  <div className="text-xs text-muted-foreground capitalize">{activeRoom.type}</div>
                </div>
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/20">
                {(messagesQ.data?.messages ?? []).map((m: any) => {
                  const mine = m.sender_id === user?.id;
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[70%] px-3 py-2 rounded-2xl text-sm ${
                          mine
                            ? "bg-primary text-primary-foreground rounded-ee-sm"
                            : "bg-card border rounded-es-sm"
                        }`}
                      >
                        {!mine && (
                          <div className="text-[10px] opacity-70 mb-0.5">{m.sender_email}</div>
                        )}
                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                        <div className="text-[10px] opacity-60 mt-1 text-end">
                          {new Date(m.created_at).toLocaleTimeString(rtl ? "ar-EG" : undefined, {
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {messagesQ.data?.messages?.length === 0 && (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    {rtl ? "ابعت أول رسالة 👋" : "Send the first message 👋"}
                  </div>
                )}
              </div>
              <div className="p-3 border-t flex gap-2 items-end">
                <Input
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  placeholder={rtl ? "اكتب رسالة..." : "Type a message..."}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      onSend();
                    }
                  }}
                />
                <Button onClick={onSend} disabled={!composer.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
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
                  <div className="text-sm font-medium truncate">{m.display_name ?? m.email}</div>
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
