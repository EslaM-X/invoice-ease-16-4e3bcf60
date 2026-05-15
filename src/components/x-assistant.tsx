import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, Loader2, Plus, MessageSquare, X as XIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

type Msg = { id: string; role: "user" | "assistant"; content: string };
type Conv = { id: string; title: string; last_message_at: string };

/**
 * X Assistant — floating sphere FAB that opens a fullscreen chat sheet.
 * Phase 2: streaming chat (read-only). Tools/voice come in Phase 3.
 */
export function XAssistant() {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [conv, setConv] = useState<Conv | null>(null);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamBuf, setStreamBuf] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ar = lang === "ar";

  // Load conversations list when opening
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("x_conversations")
        .select("id,title,last_message_at")
        .order("last_message_at", { ascending: false })
        .limit(50);
      setConvs((data ?? []) as Conv[]);
    })();
  }, [open]);

  // Load messages for a conversation
  const openConv = async (c: Conv | null) => {
    setConv(c);
    setShowHistory(false);
    if (!c) {
      setMessages([]);
      return;
    }
    const { data } = await supabase
      .from("x_messages")
      .select("id,role,content")
      .eq("conversation_id", c.id)
      .order("created_at", { ascending: true });
    setMessages(((data ?? []) as any[]).filter((m) => m.role === "user" || m.role === "assistant"));
  };

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamBuf]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: text };
    setMessages((m) => [...m, userMsg]);
    setStreaming(true);
    setStreamBuf("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("not authed");

      const res = await fetch("/api/x-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text, conversationId: conv?.id ?? null }),
      });

      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => "");
        if (res.status === 429) throw new Error(ar ? "تم تجاوز الحد. حاول بعد دقيقة." : "Rate limited. Try again shortly.");
        if (res.status === 402) throw new Error(ar ? "نفد الرصيد. أضف رصيد للمتابعة." : "Out of credits.");
        throw new Error(err || "AI error");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      let newConvId: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const evt of parts) {
          const line = evt.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          try {
            const json = JSON.parse(line.slice(5).trim());
            if (json.type === "meta" && json.conversationId) {
              newConvId = json.conversationId;
            } else if (json.type === "delta") {
              acc += json.content;
              setStreamBuf(acc);
            } else if (json.type === "error") {
              throw new Error(json.error);
            }
          } catch {
            /* ignore parse errors */
          }
        }
      }

      // Commit final assistant message
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: acc }]);
      setStreamBuf("");
      if (newConvId && !conv) {
        setConv({ id: newConvId, title: text.slice(0, 60), last_message_at: new Date().toISOString() });
      }
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", content: `⚠️ ${e?.message ?? "حدث خطأ"}` },
      ]);
      setStreamBuf("");
    } finally {
      setStreaming(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          aria-label="X Assistant"
          className="no-print group fixed bottom-20 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-500 to-amber-400 text-white shadow-[0_10px_30px_-8px_rgba(168,85,247,0.6)] ring-1 ring-white/30 backdrop-blur transition-transform hover:scale-110 active:scale-95 sm:bottom-6 lg:bottom-8"
          style={{ insetInlineEnd: "1.25rem" }}
        >
          <span className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 opacity-0 blur-xl transition-opacity group-hover:opacity-70" />
          <Sparkles className="relative h-6 w-6 drop-shadow" />
          <span className="sr-only">X</span>
        </button>
      </SheetTrigger>
      <SheetContent
        side={ar ? "left" : "right"}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b border-border/60 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-amber-400/10 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="flex items-center gap-2 text-base">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
                <Sparkles className="h-4 w-4" />
              </span>
              <span>X — {ar ? "المساعد الذكي" : "Smart Assistant"}</span>
            </SheetTitle>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openConv(null)} title={ar ? "محادثة جديدة" : "New chat"}>
                <Plus className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowHistory((s) => !s)} title={ar ? "السجل" : "History"}>
                <MessageSquare className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </SheetHeader>

        {showHistory ? (
          <div className="flex-1 overflow-y-auto p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground">{ar ? "محادثاتك" : "Conversations"}</p>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setShowHistory(false)}>
                <XIcon className="h-3 w-3" />
              </Button>
            </div>
            {convs.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{ar ? "لا محادثات بعد" : "No conversations yet"}</p>
            ) : (
              <ul className="space-y-1">
                {convs.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => openConv(c)}
                      className={`w-full truncate rounded-lg px-3 py-2 text-start text-sm transition hover:bg-accent ${conv?.id === c.id ? "bg-accent" : ""}`}
                    >
                      {c.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
              {messages.length === 0 && !streamBuf ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg">
                    <Sparkles className="h-8 w-8" />
                  </div>
                  <h3 className="text-lg font-semibold">{ar ? "أهلاً، أنا X" : "Hi, I'm X"}</h3>
                  <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                    {ar
                      ? "اسألني عن أي شيء في التطبيق — صفحات، فواتير، مخزون، أرباح."
                      : "Ask me anything about the app — pages, invoices, stock, profits."}
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {(ar
                      ? ["اشرحلي صفحة الفواتير", "إيه فايدة المخزون؟", "وريني مكان التقارير"]
                      : ["Explain invoices page", "What is stock for?", "Where are reports?"]
                    ).map((q) => (
                      <button
                        key={q}
                        onClick={() => setInput(q)}
                        className="rounded-full border border-border/60 bg-card px-3 py-1 text-xs hover:bg-accent"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((m) => (
                    <Bubble key={m.id} role={m.role} content={m.content} />
                  ))}
                  {streamBuf && <Bubble role="assistant" content={streamBuf} streaming />}
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="border-t border-border/60 bg-background/80 p-3 backdrop-blur"
            >
              <div className="flex items-end gap-2 rounded-2xl border border-border/60 bg-muted/40 px-3 py-2 focus-within:border-primary/50">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder={ar ? "اكتب رسالتك… (Enter للإرسال)" : "Type a message… (Enter to send)"}
                  className="max-h-32 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <Button
                  type="submit"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white hover:opacity-90"
                  disabled={!input.trim() || streaming}
                >
                  {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
                {ar ? "X في النسخة الأولى — قراءة فقط. الصوت والتنفيذ قريباً." : "X v1 — read-only. Voice + actions coming."}
              </p>
            </form>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Bubble({ role, content, streaming }: { role: "user" | "assistant"; content: string; streaming?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md"
            : "bg-muted text-foreground"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1">
            <ReactMarkdown
              components={{
                a: ({ href, children }) => {
                  const internal = href?.startsWith("/");
                  if (internal) {
                    return (
                      <Link to={href as any} className="text-primary underline underline-offset-2">
                        {children}
                      </Link>
                    );
                  }
                  return (
                    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
                      {children}
                    </a>
                  );
                },
              }}
            >
              {content}
            </ReactMarkdown>
            {streaming && <span className="ms-1 inline-block h-3 w-1.5 animate-pulse bg-current align-middle" />}
          </div>
        )}
      </div>
    </div>
  );
}
