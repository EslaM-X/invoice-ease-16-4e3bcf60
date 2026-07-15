import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Send, Phone, Bot, BotOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { uniqueRealtimeTopic } from "@/lib/realtime";
import {
  listConversations, listConversationMessages, sendWhatsAppText,
  setBotEnabled, checkWhatsAppStatus,
} from "@/lib/whatsapp.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/whatsapp")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: WhatsAppPage,
});

function WhatsAppPage() {
  const { lang } = useI18n();
  const rtl = lang === "ar";
  const qc = useQueryClient();
  const fetchConvs = useServerFn(listConversations);
  const fetchMsgs = useServerFn(listConversationMessages);
  const sendText = useServerFn(sendWhatsAppText);
  const toggleBot = useServerFn(setBotEnabled);
  const status = useServerFn(checkWhatsAppStatus);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const statusQ = useQuery({ queryKey: ["wa-status"], queryFn: () => status() });
  const convsQ = useQuery({
    queryKey: ["wa-convs"],
    queryFn: () => fetchConvs(),
    refetchInterval: 10000,
  });
  const msgsQ = useQuery({
    queryKey: ["wa-msgs", activeId],
    queryFn: () => activeId ? fetchMsgs({ data: { conversation_id: activeId } }) : Promise.resolve({ messages: [] }),
    enabled: !!activeId,
  });

  // Realtime for new messages in active conversation
  useEffect(() => {
    if (!activeId) return;
    const ch = supabase
      .channel(uniqueRealtimeTopic(`wa-conv-${activeId}`))
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "whatsapp_messages", filter: `conversation_id=eq.${activeId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["wa-msgs", activeId] });
          qc.invalidateQueries({ queryKey: ["wa-convs"] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeId, qc]);

  useEffect(() => {
    const ch = supabase
      .channel(uniqueRealtimeTopic("wa-convs-global"))
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversations" }, () => {
        qc.invalidateQueries({ queryKey: ["wa-convs"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgsQ.data?.messages?.length]);

  const convs = convsQ.data?.conversations ?? [];
  const active = convs.find((c: any) => c.id === activeId);

  const onSend = async () => {
    const body = composer.trim();
    if (!body || !activeId) return;
    setComposer("");
    try {
      await sendText({ data: { conversation_id: activeId, body } });
      qc.invalidateQueries({ queryKey: ["wa-msgs", activeId] });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to send");
      setComposer(body);
    }
  };

  return (
    <AppShell>
      <div dir={rtl ? "rtl" : "ltr"} className="space-y-3">
        {statusQ.data && !statusQ.data.configured && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{rtl ? "واتس اب مش متظبط لسه" : "WhatsApp not configured"}</AlertTitle>
            <AlertDescription className="text-sm">
              {rtl
                ? "محتاج تضيف بيانات Meta Cloud API الأول (Access Token, Phone Number ID, App Secret, Verify Token). كلم Lovable يضيفهالك."
                : "Add WhatsApp Cloud API secrets first (Access Token, Phone Number ID, App Secret, Verify Token)."}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex h-[calc(100vh-14rem)] gap-3 rounded-xl border bg-card overflow-hidden">
          {/* Conversations list */}
          <div className="w-80 shrink-0 border-e flex flex-col">
            <div className="p-3 border-b flex items-center gap-2">
              <Phone className="h-4 w-4 text-green-600" />
              <h2 className="font-semibold">{rtl ? "واتس اب" : "WhatsApp"}</h2>
              <Badge variant="outline" className="ms-auto">{convs.length}</Badge>
            </div>
            <ScrollArea className="flex-1">
              {convs.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  {rtl ? "مفيش محادثات لسه" : "No conversations yet"}
                </div>
              )}
              {convs.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={`w-full text-start p-3 flex items-center gap-3 hover:bg-accent/50 border-b transition ${
                    activeId === c.id ? "bg-accent" : ""
                  }`}
                >
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-green-100 text-green-700">
                      {(c.customer_name ?? c.customer_phone).charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium truncate text-sm">
                        {c.customer_name ?? c.customer_phone}
                      </span>
                      {c.unread_count > 0 && (
                        <Badge className="h-5 px-1.5 text-xs">{c.unread_count}</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate" dir="ltr">{c.customer_phone}</div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {c.last_message_preview ?? "—"}
                    </div>
                  </div>
                </button>
              ))}
            </ScrollArea>
          </div>

          {/* Conversation view */}
          <div className="flex-1 flex flex-col min-w-0">
            {active ? (
              <>
                <div className="p-3 border-b flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-green-100 text-green-700">
                      {(active.customer_name ?? active.customer_phone).charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="font-semibold">{active.customer_name ?? active.customer_phone}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">+{active.customer_phone}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {active.bot_enabled ? <Bot className="h-4 w-4 text-primary" /> : <BotOff className="h-4 w-4 text-muted-foreground" />}
                    <Label className="text-xs">{rtl ? "البوت" : "Bot"}</Label>
                    <Switch
                      checked={active.bot_enabled}
                      onCheckedChange={async (v) => {
                        try {
                          await toggleBot({ data: { conversation_id: active.id, enabled: v } });
                          qc.invalidateQueries({ queryKey: ["wa-convs"] });
                        } catch (err: any) {
                          toast.error(err.message);
                        }
                      }}
                    />
                  </div>
                </div>
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#e5ddd5]/30 dark:bg-muted/20">
                  {(msgsQ.data?.messages ?? []).map((m: any) => {
                    const outgoing = m.direction === "outbound";
                    return (
                      <div key={m.id} className={`flex ${outgoing ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[70%] px-3 py-2 rounded-2xl text-sm shadow-sm ${
                            outgoing
                              ? "bg-[#dcf8c6] text-foreground dark:bg-primary dark:text-primary-foreground rounded-ee-sm"
                              : "bg-white text-foreground dark:bg-card border rounded-es-sm"
                          }`}
                        >
                          {m.is_bot && outgoing && (
                            <div className="text-[10px] opacity-70 mb-0.5 flex items-center gap-1">
                              <Bot className="h-3 w-3" /> Bot
                            </div>
                          )}
                          {m.media_url && m.message_type === "document" && (
                            <a href={m.media_url} target="_blank" rel="noopener noreferrer" className="text-xs underline block mb-1">
                              📄 {m.media_filename ?? "Document"}
                            </a>
                          )}
                          {m.body && (
                            <div className="whitespace-pre-wrap break-words">{m.body}</div>
                          )}
                          {!m.body && !m.media_url && (
                            <div className="opacity-60 italic text-xs">[{m.message_type}]</div>
                          )}
                          <div className="text-[10px] opacity-60 mt-1 text-end flex items-center gap-1 justify-end">
                            {new Date(m.created_at).toLocaleTimeString(rtl ? "ar-EG" : undefined, {
                              hour: "2-digit", minute: "2-digit",
                            })}
                            {outgoing && (
                              <span>{m.status === "read" ? "✓✓" : m.status === "delivered" ? "✓✓" : m.status === "failed" ? "⚠" : "✓"}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {msgsQ.data?.messages?.length === 0 && (
                    <div className="text-center text-sm text-muted-foreground py-8">
                      {rtl ? "مفيش رسايل لسه" : "No messages yet"}
                    </div>
                  )}
                </div>
                <div className="p-3 border-t flex gap-2">
                  <Input
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    placeholder={rtl ? "اكتب رد..." : "Type a reply..."}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
                    }}
                  />
                  <Button onClick={onSend} disabled={!composer.trim() || !statusQ.data?.configured}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                {rtl ? "اختر محادثة" : "Select a conversation"}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
