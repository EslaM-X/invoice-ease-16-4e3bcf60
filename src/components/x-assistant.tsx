import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  Sparkles,
  Send,
  Loader2,
  Plus,
  MessageSquare,
  X as XIcon,
  Mic,
  ChevronRight,
  Wand2,
  TrendingUp,
  Package,
  FileText,
  Users,
  BarChart3,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

type Msg = { id: string; role: "user" | "assistant"; content: string };
type Conv = { id: string; title: string; last_message_at: string };
type Status = "idle" | "thinking" | "speaking";

/**
 * X Assistant — luxury floating orb FAB that opens a polished chat sheet.
 * Phase 1: refined visual identity aligned with Steinheim editorial monochrome.
 * Voice + tool execution land in subsequent phases.
 */
export function XAssistant() {
  const { lang } = useI18n();
  const [mounted, setMounted] = useState(false);
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
  const status: Status = streaming ? (streamBuf ? "speaking" : "thinking") : "idle";

  useEffect(() => {
    setMounted(true);
  }, []);

  const openAssistant = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    window.setTimeout(() => setOpen(true), 0);
  };

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

  // Cmd/Ctrl + K shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // External open trigger (e.g., reminder toast → "Open X")
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("x:assistant:open", onOpen);
    return () => window.removeEventListener("x:assistant:open", onOpen);
  }, []);

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

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || streaming) return;
    if (!overrideText) setInput("");
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

      const { cleaned, actions } = extractActions(acc);
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: cleaned }]);
      setStreamBuf("");
      if (newConvId && !conv) {
        setConv({ id: newConvId, title: text.slice(0, 60), last_message_at: new Date().toISOString() });
      }
      for (const a of actions) {
        await runAssistantAction(a, ar);
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

  const quickActions = ar
    ? [
        { icon: TrendingUp, label: "مبيعات اليوم", prompt: "اعملي ملخص مبيعات اليوم بشكل سريع" },
        { icon: FileText, label: "صفحة الفواتير", prompt: "اشرحلي صفحة الفواتير وإزاي أعمل فاتورة جديدة" },
        { icon: Package, label: "أقل مخزون", prompt: "إيه المنتجات اللي مخزونها منخفض؟" },
        { icon: Users, label: "العملاء", prompt: "إزاي أضيف عميل جديد وأشوف معاملاته؟" },
        { icon: BarChart3, label: "الأرباح", prompt: "ودّيني للأرباح واشرحلي الأرقام" },
        { icon: Wand2, label: "فاجئني", prompt: "اقترحلي ٣ حاجات أعملها دلوقتي تزوّد مبيعاتي" },
      ]
    : [
        { icon: TrendingUp, label: "Today's sales", prompt: "Give me a quick summary of today's sales" },
        { icon: FileText, label: "Invoices page", prompt: "Explain the invoices page and how to create one" },
        { icon: Package, label: "Low stock", prompt: "Which products are running low on stock?" },
        { icon: Users, label: "Customers", prompt: "How do I add a customer and view their history?" },
        { icon: BarChart3, label: "Profits", prompt: "Take me to profits and explain the numbers" },
        { icon: Wand2, label: "Surprise me", prompt: "Suggest 3 things I can do right now to grow sales" },
      ];

  return (
    <>
      <button
        type="button"
        aria-label="X Assistant"
        onClick={openAssistant}
        className="x-orb no-print group fixed bottom-24 z-[60] flex h-14 w-14 items-center justify-center rounded-full sm:bottom-14 lg:bottom-16"
        style={{ insetInlineEnd: "1.25rem" }}
      >
        <span className="x-orb-ring" aria-hidden />
        <span className="x-orb-core" aria-hidden>
          <svg className="x-orb-mark" viewBox="0 0 24 24" fill="none" aria-hidden>
            <defs>
              <linearGradient id="x-orb-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="oklch(1 0 0)" />
                <stop offset="55%" stopColor="oklch(0.92 0.005 250)" />
                <stop offset="100%" stopColor="oklch(0.72 0.005 250)" />
              </linearGradient>
            </defs>
            <path
              d="M5 4.5 L11 12 L5 19.5 M19 4.5 L13 12 L19 19.5"
              stroke="url(#x-orb-grad)"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="x-orb-shine" aria-hidden />
        <span className="sr-only">X Assistant</span>
      </button>
      {mounted && open && createPortal(
        <>
          {/* No full-screen backdrop — keep the app visible behind so the user
              can still see context. A subtle gradient bleed sits behind only
              the panel itself for separation. */}
          <section
            role="dialog"
            aria-modal="false"
            aria-labelledby="x-assistant-title"
            aria-describedby="x-assistant-desc"
            dir={ar ? "rtl" : "ltr"}
            className="x-sheet fixed inset-y-0 end-0 z-[70] isolate flex w-full max-w-full flex-col gap-0 border-0 p-0 shadow-2xl sm:max-w-md"
          >
        <div className="x-sheet-header px-4 py-3">
          <p id="x-assistant-desc" className="sr-only">
            {ar
              ? "مساعد ذكي للمحادثة بالعربية والإنجليزية داخل التطبيق."
              : "A smart in-app assistant for Arabic and English conversations."}
          </p>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-base text-white">
              <span className="x-header-orb">
                <span className="x-header-orb-core">X</span>
              </span>
              <span className="flex flex-col items-start leading-tight">
                <span id="x-assistant-title" className="x-title font-display text-[17px] tracking-wide">
                  X — {ar ? "المساعد الذكي" : "Smart Assistant"}
                </span>
                <span className="x-status">
                  <span className={`x-status-dot ${status}`} />
                  {statusLabel(status, ar)}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
                onClick={() => openConv(null)}
                title={ar ? "محادثة جديدة" : "New chat"}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
                onClick={() => setShowHistory((s) => !s)}
                title={ar ? "السجل" : "History"}
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white/80 hover:bg-white/10 hover:text-white"
                onClick={() => setOpen(false)}
                title={ar ? "إغلاق" : "Close"}
              >
                <XIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {showHistory ? (
          <div className="x-sheet-body flex-1 overflow-y-auto p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-white/60">
                {ar ? "محادثاتك" : "Conversations"}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-white/70 hover:bg-white/10 hover:text-white"
                onClick={() => setShowHistory(false)}
              >
                <XIcon className="h-3 w-3" />
              </Button>
            </div>
            {convs.length === 0 ? (
              <p className="py-12 text-center text-sm text-white/50">
                {ar ? "لا محادثات بعد" : "No conversations yet"}
              </p>
            ) : (
              <ul className="space-y-1">
                {convs.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => openConv(c)}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl border border-white/5 px-3 py-2.5 text-start text-sm text-white/85 transition hover:border-white/15 hover:bg-white/[0.06] ${
                        conv?.id === c.id ? "bg-white/[0.08] border-white/20" : ""
                      }`}
                    >
                      <span className="truncate">{c.title}</span>
                      <ChevronRight className={`h-3.5 w-3.5 shrink-0 opacity-50 ${ar ? "rotate-180" : ""}`} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="x-sheet-body flex-1 overflow-y-auto px-4 py-4">
              {messages.length === 0 && !streamBuf ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className="x-hero-orb mb-5">
                    <span className="x-hero-orb-ring" />
                    <span className="x-hero-orb-core">
                      <Sparkles className="h-7 w-7 text-white" />
                    </span>
                  </div>
                  <h3 className="font-display text-2xl text-white">
                    {ar ? "أهلاً، أنا X" : "Hi, I'm X"}
                  </h3>
                  <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/65">
                    {ar
                      ? "بسألني عن أي حاجة في شغلك — فواتير، مخزون، عملاء، أرباح. وبتكلم عربي وإنجليزي. وأحياناً بهزر 😉"
                      : "Ask me anything about your business — invoices, stock, customers, profits. I speak Arabic & English, and I sometimes crack a joke 😉"}
                  </p>
                  <div className="mt-5 grid w-full grid-cols-2 gap-2">
                    {quickActions.map((q) => (
                      <button
                        key={q.label}
                        onClick={() => send(q.prompt)}
                        className="x-quick-card group flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-start text-xs text-white/85 transition hover:border-white/25 hover:bg-white/[0.08]"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/90 transition group-hover:bg-white/20">
                          <q.icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="truncate font-medium">{q.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((m) => (
                    <Bubble key={m.id} role={m.role} content={m.content} />
                  ))}
                  {streaming && !streamBuf && <ThinkingBubble ar={ar} />}
                  {streamBuf && <Bubble role="assistant" content={streamBuf} streaming />}
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="x-sheet-footer p-3"
            >
              <div className="x-input-shell flex items-end gap-2 rounded-2xl px-3 py-2">
                <VoiceMic
                  ar={ar}
                  onTranscript={(t) => {
                    setInput((prev) => (prev ? prev + " " : "") + t);
                  }}
                  onAutoSend={(t) => send(t)}
                />

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
                  className="max-h-32 flex-1 resize-none bg-transparent text-sm text-white outline-none placeholder:text-white/40"
                />
                <Button
                  type="submit"
                  size="icon"
                  className="x-send h-9 w-9 shrink-0 rounded-full border-0 text-black hover:opacity-90"
                  disabled={!input.trim() || streaming}
                >
                  {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <p className="mt-1.5 px-1 text-center text-[10px] text-white/40">
                {ar
                  ? "X نسخة المعاينة • Cmd/Ctrl + K لفتح أو إغلاق"
                  : "X preview • Cmd/Ctrl + K to toggle"}
              </p>
            </form>
          </>
        )}
          </section>
        </>,
        document.body,
      )}
    </>
  );
}

function statusLabel(s: Status, ar: boolean) {
  if (s === "thinking") return ar ? "يفكّر…" : "Thinking…";
  if (s === "speaking") return ar ? "يكتب…" : "Typing…";
  return ar ? "متصل" : "Online";
}

function ThinkingBubble({ ar }: { ar: boolean }) {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm text-white/70">
        <span className="x-think-dot" />
        <span className="x-think-dot" />
        <span className="x-think-dot" />
        <span className="ms-1 text-[11px] text-white/45">{ar ? "لحظة…" : "one sec…"}</span>
      </div>
    </div>
  );
}

function Bubble({ role, content, streaming }: { role: "user" | "assistant"; content: string; streaming?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "x-bubble-user text-white"
            : "x-bubble-bot text-white/90"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-headings:text-white prose-strong:text-white prose-ul:my-1 prose-ol:my-1">
            <ReactMarkdown
              components={{
                a: ({ href, children }) => {
                  const internal = href?.startsWith("/");
                  if (internal) {
                    return (
                      <Link to={href as any} className="text-white underline decoration-white/40 underline-offset-2 hover:decoration-white">
                        {children}
                      </Link>
                    );
                  }
                  return (
                    <a href={href} target="_blank" rel="noreferrer" className="text-white underline decoration-white/40 underline-offset-2">
                      {children}
                    </a>
                  );
                },
              }}
            >
              {content}
            </ReactMarkdown>
            {streaming && <span className="ms-1 inline-block h-3 w-1.5 animate-pulse bg-white/80 align-middle" />}
          </div>
        )}
      </div>
    </div>
  );
}

type AssistantAction =
  | {
      type: "create_event";
      title: string;
      starts_at: string;
      notes?: string;
      kind?: string;
      remind_before_minutes?: number[];
    }
  | { type: string; [k: string]: any };

/**
 * Extracts ```x-action JSON blocks from an assistant reply and returns the
 * cleaned text (with blocks removed) plus the parsed actions.
 */
function extractActions(text: string): { cleaned: string; actions: AssistantAction[] } {
  const actions: AssistantAction[] = [];
  const cleaned = text.replace(/```x-action\s*([\s\S]*?)```/g, (_, body) => {
    try {
      const parsed = JSON.parse(body.trim());
      if (Array.isArray(parsed)) actions.push(...parsed);
      else actions.push(parsed);
    } catch {
      /* ignore bad json */
    }
    return "";
  }).trim();
  return { cleaned, actions };
}

async function runAssistantAction(a: AssistantAction, ar: boolean) {
  try {
    if (a.type === "create_event" && a.title && a.starts_at) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from("x_calendar_events").insert({
        user_id: user.id,
        title: String(a.title).slice(0, 200),
        notes: a.notes ? String(a.notes).slice(0, 2000) : null,
        kind: a.kind || "event",
        starts_at: new Date(a.starts_at).toISOString(),
        remind_before_minutes: Array.isArray(a.remind_before_minutes) && a.remind_before_minutes.length
          ? a.remind_before_minutes
          : [60, 1440],
      });
      if (error) throw error;
      window.dispatchEvent(new CustomEvent("x:calendar:refresh"));
      const { toast } = await import("sonner");
      toast.success(ar ? "اتسجّل في الكلندر ✨" : "Saved to calendar ✨");
    }
  } catch (e: any) {
    const { toast } = await import("sonner");
    toast.error(e?.message ?? "Action failed");
  }
}
