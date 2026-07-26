import { useRef, useState, Fragment, type ReactNode } from "react";
import { renderMentionBody } from "@/lib/mentions";
import { motion } from "framer-motion";
import { LuxuryAvatar } from "@/components/chat/luxury-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Copy, MoreHorizontal, Reply, SmilePlus, Trash2, CheckCheck, Check, Info } from "lucide-react";
import { VoicePlayer } from "@/components/chat/voice-player";
import { QUICK_REACTIONS } from "@/components/chat/emoji-picker";
import { MessageInfoDialog } from "@/components/chat/message-info-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { TwemojiBody } from "@/components/chat/twemoji-body";

type Reaction = { emoji: string; user_id: string };
export type ChatMsg = {
  id: string;
  sender_id: string;
  body: string | null;
  message_type: string;
  attachments?: Array<{ url: string; mime?: string; name?: string }>;
  voice_note_url?: string | null;
  voice_duration_seconds?: number | null;
  reply_to?: {
    id: string;
    body: string | null;
    message_type: string;
    sender_display_name: string;
  } | null;
  reactions?: Reaction[];
  created_at: string;
  sender_display_name?: string;
  sender_avatar_url?: string | null;
  sender_job_title?: string | null;
  sender_job_title_color?: string | null;
  read_by_count?: number;
  read_by_user_ids?: string[];
  __pending?: boolean;
};

/** Highlight all occurrences of `q` inside `text` (case-insensitive). */
function highlightText(text: string, q: string): ReactNode {
  if (!q) return text;
  const needle = q.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  const lower = text.toLowerCase();
  while (i < text.length) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={`m-${idx}`} className="chat-hl">
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    i = idx + q.length;
  }
  return <>{parts}</>;
}

export function MessageBubble({
  msg, mine, showAvatar, showName, rtl, voiceUrl, attachmentUrls, isGroup, isRead,
  highlightQuery = "",
  currentUserId = null,
  onReply, onDelete, onToggleReaction, readers,
}: {
  msg: ChatMsg;
  mine: boolean;
  showAvatar: boolean;
  showName: boolean;
  rtl: boolean;
  voiceUrl?: string;
  attachmentUrls?: Record<string, string>;
  isGroup: boolean;
  isRead: boolean;
  highlightQuery?: string;
  currentUserId?: string | null;
  onReply: (m: ChatMsg) => void;
  onDelete: (m: ChatMsg) => void;
  onToggleReaction: (m: ChatMsg, emoji: string) => void;
  readers?: Array<{ id: string; name: string; avatar?: string | null }>;
}) {
  const displayName = msg.sender_display_name ?? "?";
  const time = new Date(msg.created_at).toLocaleTimeString(rtl ? "ar-EG" : undefined, {
    hour: "2-digit", minute: "2-digit",
  });

  // Reaction aggregation
  const reactionAgg = new Map<string, number>();
  for (const r of msg.reactions ?? []) reactionAgg.set(r.emoji, (reactionAgg.get(r.emoji) ?? 0) + 1);

  // ---- Long-press on mobile → open action sheet ----
  const [sheetOpen, setSheetOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const pressFired = useRef(false);

  const startPress = () => {
    pressFired.current = false;
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      pressFired.current = true;
      // Haptic buzz if the device supports it
      if ("vibrate" in navigator) {
        try { (navigator as any).vibrate?.(15); } catch {}
      }
      setSheetOpen(true);
    }, 380);
  };
  const cancelPress = () => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const bodyNode: ReactNode = msg.body
    ? (
      <>
        {renderMentionBody(
          msg.body,
          currentUserId,
          (text, key) => <Fragment key={key}>{highlightText(text, highlightQuery)}</Fragment>,
          ({ name, isSelf, key }) => (
            <span
              key={key}
              className={cn(
                "inline-flex items-center rounded-md px-1.5 py-0.5 mx-0.5 text-[0.92em] font-semibold align-baseline",
                isSelf
                  ? "bg-[color:var(--brand-gold,#d4af37)]/25 text-[color:var(--brand-gold,#d4af37)] ring-1 ring-[color:var(--brand-gold,#d4af37)]/40"
                  : "bg-[color:var(--brand-gold,#d4af37)]/10 text-[color:var(--brand-gold,#d4af37)]"
              )}
            >
              @{name}
            </span>
          ),
        )}
      </>
    )
    : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 26, mass: 0.6 }}
      className={cn("group/msg flex gap-2 items-end", mine ? "justify-end" : "justify-start")}
    >
      {!mine && (
        <div
          className="shrink-0 self-end"
          style={{ width: "var(--chat-avatar-slot, 56px)" }}
        >
          {showAvatar && (
            <LuxuryAvatar
              url={msg.sender_avatar_url}
              name={displayName}
              size={60}
              ring="gold"
            />
          )}
        </div>
      )}

      <div className={cn("flex flex-col max-w-[88%] sm:max-w-[78%] md:max-w-[72%] lg:max-w-[68%] xl:max-w-[820px] 2xl:max-w-[960px]", mine ? "items-end" : "items-start")}>
        <div
          onTouchStart={startPress}
          onTouchEnd={cancelPress}
          onTouchMove={cancelPress}
          onTouchCancel={cancelPress}
          onContextMenu={(e) => {
            // Right-click / long-press on Android chrome → open sheet
            e.preventDefault();
            setSheetOpen(true);
          }}
          style={{
            padding: "var(--chat-bubble-pad, 8px 12px)",
            fontSize: "var(--chat-bubble-font, 14px)",
          }}
          className={cn(
            "relative rounded-2xl shadow-sm break-words select-text",
            mine
              ? "bg-gradient-to-br from-primary to-primary/85 text-primary-foreground rounded-ee-md"
              : "bg-card border border-border/60 rounded-es-md backdrop-blur-sm",
            msg.__pending && "opacity-60"
          )}
        >
          {showName && (!mine || isGroup) && (
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className={cn("text-[11px] font-semibold truncate", mine && "opacity-90")}>{displayName}</span>
              {!mine && msg.sender_job_title && (
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: (msg.sender_job_title_color ?? "#64748b") + "22",
                    color: msg.sender_job_title_color ?? "#64748b",
                  }}
                >
                  {msg.sender_job_title}
                </span>
              )}
            </div>
          )}

          {msg.reply_to && (
            <div className={cn(
              "mb-1.5 px-2 py-1 rounded-md border-s-2 text-[11px] leading-snug",
              mine ? "bg-white/15 border-white/50" : "bg-muted/60 border-primary/50"
            )}>
              <div className="font-semibold opacity-80 truncate">{msg.reply_to.sender_display_name}</div>
              <TwemojiBody as="span" className="opacity-70 truncate chat-emoji block">
                {msg.reply_to.message_type === "voice"
                  ? (rtl ? "🎤 رسالة صوتية" : "🎤 Voice message")
                  : msg.reply_to.message_type === "image"
                    ? (rtl ? "📷 صورة" : "📷 Image")
                    : msg.reply_to.body ?? ""}
              </TwemojiBody>
            </div>
          )}

          {msg.message_type === "voice" && msg.voice_note_url ? (
            voiceUrl ? (
              <VoicePlayer url={voiceUrl} durationSeconds={msg.voice_duration_seconds ?? undefined} tone={mine ? "mine" : "neutral"} />
            ) : (
              <div className="text-xs opacity-70">{rtl ? "جاري تحميل الصوت..." : "Loading audio..."}</div>
            )
          ) : msg.message_type === "image" && msg.attachments?.length ? (
            <div className="grid gap-1.5">
              {msg.attachments.map((a, i) => {
                const src = attachmentUrls?.[a.url] ?? a.url;
                // Reserve a fixed-size slot so row height never changes as the
                // image loads. This prevents virtualizer height jumps and
                // scroll-position drift when opening the chat.
                return (
                  <a
                    key={i}
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    className="block relative overflow-hidden rounded-lg bg-black/30"
                    style={{ width: 240, height: 180, contain: "strict" }}
                  >
                    <div
                      aria-hidden
                      className="absolute inset-0 bg-[linear-gradient(110deg,rgba(255,255,255,0.05)_8%,rgba(212,175,55,0.14)_18%,rgba(255,255,255,0.05)_33%)] bg-[length:200%_100%] motion-safe:animate-[chatShimmer_1.4s_linear_infinite] pointer-events-none"
                      data-img-skel
                    />
                    <img
                      src={src}
                      alt={a.name ?? ""}
                      width={240}
                      height={180}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-300"
                      style={{ contentVisibility: "auto" }}
                      onLoad={(e) => {
                        (e.currentTarget as HTMLImageElement).style.opacity = "1";
                        const skel = (e.currentTarget.parentElement?.querySelector("[data-img-skel]") as HTMLElement | null);
                        if (skel) skel.style.display = "none";
                      }}
                      onError={(e) => {
                        const skel = (e.currentTarget.parentElement?.querySelector("[data-img-skel]") as HTMLElement | null);
                        if (skel) skel.style.opacity = "0.4";
                      }}
                    />
                  </a>
                );
              })}
              {msg.body && <TwemojiBody className="whitespace-pre-wrap leading-relaxed chat-emoji">{bodyNode}</TwemojiBody>}
            </div>
          ) : (
            <TwemojiBody className="whitespace-pre-wrap leading-relaxed chat-emoji">{bodyNode}</TwemojiBody>
          )}

          <div className={cn(
            "flex items-center gap-1.5 mt-1 text-[10px]",
            mine ? "justify-end opacity-90" : "justify-end opacity-60"
          )}>
            <span>{time}</span>
            {mine && !msg.__pending && readers && readers.length > 0 && (
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                title={rtl ? `شافها: ${readers.map(r => r.name).join("، ")}` : `Seen by ${readers.map(r => r.name).join(", ")}`}
                aria-label={rtl ? `شافها ${readers.length}` : `Seen by ${readers.length}`}
                className="inline-flex items-center gap-1 rounded-full px-1 py-0.5 hover:bg-white/10 transition"
              >
                <span className="flex -space-x-1.5 rtl:space-x-reverse">
                  {readers.slice(0, 3).map((r) => (
                    <span
                      key={r.id}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-[color:var(--brand-gold,#d4af37)]/70 bg-black/70 text-[8px] font-bold text-white overflow-hidden"
                    >
                      {r.avatar
                        ? <img src={r.avatar} alt="" className="h-full w-full object-cover" />
                        : (r.name?.charAt(0)?.toUpperCase() ?? "?")}
                    </span>
                  ))}
                </span>
                {readers.length > 3 && (
                  <span className="text-[9px] font-bold tabular-nums text-[color:var(--brand-gold,#d4af37)]">+{readers.length - 3}</span>
                )}
              </button>
            )}
            {mine && !msg.__pending && (
              (msg.read_by_count ?? 0) > 0
                ? <button type="button" onClick={() => setInfoOpen(true)} className="rounded-full p-0.5 hover:bg-white/10" aria-label={rtl ? "معلومات الرسالة" : "Message info"}>
                    <CheckCheck className="h-3.5 w-3.5 text-[color:var(--brand-gold,#d4af37)]" />
                  </button>
                : <Check className="h-3.5 w-3.5" aria-label="Sent" />
            )}
          </div>

          {/* Desktop hover toolbar — luxury noir glass */}
          <div
            className={cn(
              "hidden sm:flex absolute -top-4 opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 transition-all duration-150 translate-y-1 group-hover/msg:translate-y-0",
              "items-center gap-0.5 rounded-full px-1 py-0.5 z-20",
              "bg-[linear-gradient(135deg,rgba(20,20,22,0.95),rgba(35,30,20,0.95))] text-white",
              "ring-1 ring-[color:var(--brand-gold,#d4af37)]/40 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.55),0_0_0_1px_rgba(212,175,55,0.15)]",
              "backdrop-blur-xl",
              mine ? (rtl ? "-right-1" : "-left-1") : (rtl ? "-left-1" : "-right-1")
            )}
          >
            <Popover>
              <PopoverTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full text-white/90 hover:text-[color:var(--brand-gold,#d4af37)] hover:bg-white/10" aria-label={rtl ? "تفاعل" : "React"}>
                  <SmilePlus className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-1 w-auto border-[color:var(--brand-gold,#d4af37)]/30 bg-[linear-gradient(135deg,rgba(20,20,22,0.98),rgba(35,30,20,0.98))] text-white shadow-2xl" align="center">
                <div className="flex gap-0.5">
                  {QUICK_REACTIONS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => onToggleReaction(msg, e)}
                      className="emoji-native h-9 w-9 rounded-full hover:bg-white/10 text-lg transition-transform hover:scale-125"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full text-white/90 hover:text-[color:var(--brand-gold,#d4af37)] hover:bg-white/10" onClick={() => onReply(msg)} aria-label={rtl ? "رد" : "Reply"}>
              <Reply className="h-3.5 w-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full text-white/90 hover:text-[color:var(--brand-gold,#d4af37)] hover:bg-white/10" aria-label="More">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-[color:var(--brand-gold,#d4af37)]/30 bg-[linear-gradient(135deg,rgba(20,20,22,0.98),rgba(35,30,20,0.98))] text-white">
                <DropdownMenuItem className="focus:bg-white/10 focus:text-[color:var(--brand-gold,#d4af37)]" onClick={() => { navigator.clipboard.writeText(msg.body ?? ""); toast.success(rtl ? "تم النسخ" : "Copied"); }}>
                  <Copy className="h-3.5 w-3.5 me-2" />{rtl ? "نسخ" : "Copy"}
                </DropdownMenuItem>
                <DropdownMenuItem className="focus:bg-white/10 focus:text-[color:var(--brand-gold,#d4af37)]" onClick={() => onReply(msg)}>
                  <Reply className="h-3.5 w-3.5 me-2" />{rtl ? "رد" : "Reply"}
                </DropdownMenuItem>
                {mine && (
                  <DropdownMenuItem className="focus:bg-white/10 focus:text-[color:var(--brand-gold,#d4af37)]" onClick={() => setInfoOpen(true)}>
                    <Info className="h-3.5 w-3.5 me-2" />{rtl ? "معلومات الرسالة" : "Message info"}
                  </DropdownMenuItem>
                )}
                {mine && (
                  <>
                    <DropdownMenuSeparator className="bg-white/10" />
                    <DropdownMenuItem onClick={() => onDelete(msg)} className="text-red-400 focus:text-red-300 focus:bg-white/10">
                      <Trash2 className="h-3.5 w-3.5 me-2" />{rtl ? "حذف" : "Delete"}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {reactionAgg.size > 0 && (
          <div className={cn("flex flex-wrap gap-1 mt-1", mine ? "justify-end" : "justify-start")}>
            {[...reactionAgg.entries()].map(([emoji, count]) => (
              <motion.button
                key={emoji}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                onClick={() => onToggleReaction(msg, emoji)}
                className="emoji-native text-xs bg-card border rounded-full px-2 py-0.5 shadow-sm hover:bg-accent transition"
              >
                {emoji} <span className="opacity-70 tabular-nums">{count}</span>
              </motion.button>
            ))}
          </div>
        )}
      </div>

      {/* Mobile long-press action sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" dir={rtl ? "rtl" : "ltr"} className="p-0 rounded-t-3xl border-[color:var(--brand-gold,#d4af37)]/25 bg-[linear-gradient(180deg,rgba(20,20,22,0.98),rgba(15,15,17,0.98))] text-white">
          <SheetHeader className="p-4 pb-2">
            <SheetTitle className="text-white text-sm">
              {rtl ? "خيارات الرسالة" : "Message actions"}
            </SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-2">
            <div className="flex justify-around bg-white/5 rounded-full p-1 mb-3">
              {QUICK_REACTIONS.map((e) => (
                <button
                  key={e}
                  onClick={() => { onToggleReaction(msg, e); setSheetOpen(false); }}
                  className="emoji-native h-11 w-11 rounded-full hover:bg-white/10 text-2xl transition active:scale-90"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div className="divide-y divide-white/10">
            <button
              onClick={() => { onReply(msg); setSheetOpen(false); }}
              className="w-full text-start px-5 py-4 flex items-center gap-3 hover:bg-white/5 active:bg-white/10"
            >
              <Reply className="h-5 w-5 text-[color:var(--brand-gold,#d4af37)]" />
              <span className="font-medium">{rtl ? "رد" : "Reply"}</span>
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(msg.body ?? "");
                toast.success(rtl ? "تم النسخ" : "Copied");
                setSheetOpen(false);
              }}
              className="w-full text-start px-5 py-4 flex items-center gap-3 hover:bg-white/5 active:bg-white/10"
            >
              <Copy className="h-5 w-5 text-[color:var(--brand-gold,#d4af37)]" />
              <span className="font-medium">{rtl ? "نسخ" : "Copy"}</span>
            </button>
            {mine && (
              <>
                <button
                  onClick={() => { setInfoOpen(true); setSheetOpen(false); }}
                  className="w-full text-start px-5 py-4 flex items-center gap-3 hover:bg-white/5 active:bg-white/10"
                >
                  <Info className="h-5 w-5 text-[color:var(--brand-gold,#d4af37)]" />
                  <span className="font-medium">{rtl ? "معلومات الرسالة" : "Message info"}</span>
                </button>
                <button
                  onClick={() => { onDelete(msg); setSheetOpen(false); }}
                  className="w-full text-start px-5 py-4 flex items-center gap-3 hover:bg-red-500/10 active:bg-red-500/20 text-red-300"
                >
                  <Trash2 className="h-5 w-5" />
                  <span className="font-medium">{rtl ? "حذف" : "Delete"}</span>
                </button>
              </>
            )}
          </div>
          <div className="h-[max(env(safe-area-inset-bottom),0.75rem)]" />
        </SheetContent>
      </Sheet>

      <MessageInfoDialog open={infoOpen} onOpenChange={setInfoOpen} messageId={mine ? msg.id : null} rtl={rtl} />
    </motion.div>
  );
}
