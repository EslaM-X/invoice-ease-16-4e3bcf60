import { motion } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Copy, MoreHorizontal, Reply, SmilePlus, Trash2, CheckCheck, Check } from "lucide-react";
import { VoicePlayer } from "@/components/chat/voice-player";
import { QUICK_REACTIONS } from "@/components/chat/emoji-picker";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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

export function MessageBubble({
  msg, mine, showAvatar, showName, rtl, voiceUrl, attachmentUrls, isGroup, isRead,
  onReply, onDelete, onToggleReaction,
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
  onReply: (m: ChatMsg) => void;
  onDelete: (m: ChatMsg) => void;
  onToggleReaction: (m: ChatMsg, emoji: string) => void;
}) {
  const displayName = msg.sender_display_name ?? "?";
  const time = new Date(msg.created_at).toLocaleTimeString(rtl ? "ar-EG" : undefined, {
    hour: "2-digit", minute: "2-digit",
  });

  // Reaction aggregation
  const reactionAgg = new Map<string, number>();
  for (const r of msg.reactions ?? []) reactionAgg.set(r.emoji, (reactionAgg.get(r.emoji) ?? 0) + 1);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 26, mass: 0.6 }}
      className={cn("group/msg flex gap-2 items-end", mine ? "justify-end" : "justify-start")}
    >
      {!mine && (
        <div className="w-8 shrink-0">
          {showAvatar && (
            <Avatar className="h-8 w-8 ring-1 ring-border">
              {msg.sender_avatar_url && <AvatarImage src={msg.sender_avatar_url} />}
              <AvatarFallback className="text-[10px] bg-muted">
                {displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      )}

      <div className={cn("flex flex-col max-w-[85%] sm:max-w-[70%]", mine ? "items-end" : "items-start")}>
        <div
          className={cn(
            "relative px-3 py-2 rounded-2xl text-sm shadow-sm break-words",
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
              <div className="opacity-70 truncate">
                {msg.reply_to.message_type === "voice"
                  ? (rtl ? "🎤 رسالة صوتية" : "🎤 Voice message")
                  : msg.reply_to.message_type === "image"
                    ? (rtl ? "📷 صورة" : "📷 Image")
                    : msg.reply_to.body ?? ""}
              </div>
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
                return (
                  <a key={i} href={src} target="_blank" rel="noreferrer" className="block">
                    <img src={src} alt={a.name ?? ""} className="max-w-[280px] max-h-[280px] rounded-lg object-cover" loading="lazy" />
                  </a>
                );
              })}
              {msg.body && <div className="whitespace-pre-wrap leading-relaxed">{msg.body}</div>}
            </div>
          ) : (
            <div className="whitespace-pre-wrap leading-relaxed">{msg.body}</div>
          )}

          <div className={cn(
            "flex items-center gap-1 mt-1 text-[10px]",
            mine ? "justify-end opacity-80" : "justify-end opacity-60"
          )}>
            <span>{time}</span>
            {mine && !msg.__pending && (
              isRead
                ? <CheckCheck className="h-3 w-3" />
                : <Check className="h-3 w-3" />
            )}
          </div>

          {/* Hover action toolbar */}
          <div
            className={cn(
              "absolute -top-3 opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 transition-opacity",
              "flex items-center gap-0.5 bg-popover border rounded-full shadow-md px-1 py-0.5 z-10",
              mine ? (rtl ? "-right-1" : "-left-1") : (rtl ? "-left-1" : "-right-1")
            )}
          >
            <Popover>
              <PopoverTrigger asChild>
                <Button size="icon" variant="ghost" className="h-6 w-6 rounded-full" aria-label={rtl ? "تفاعل" : "React"}>
                  <SmilePlus className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-1 w-auto" align="center">
                <div className="flex gap-0.5">
                  {QUICK_REACTIONS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => onToggleReaction(msg, e)}
                      className="h-8 w-8 rounded-full hover:bg-accent text-lg transition-transform hover:scale-125"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Button size="icon" variant="ghost" className="h-6 w-6 rounded-full" onClick={() => onReply(msg)} aria-label={rtl ? "رد" : "Reply"}>
              <Reply className="h-3.5 w-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-6 w-6 rounded-full" aria-label="More">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(msg.body ?? ""); toast.success(rtl ? "تم النسخ" : "Copied"); }}>
                  <Copy className="h-3.5 w-3.5 me-2" />{rtl ? "نسخ" : "Copy"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onReply(msg)}>
                  <Reply className="h-3.5 w-3.5 me-2" />{rtl ? "رد" : "Reply"}
                </DropdownMenuItem>
                {mine && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onDelete(msg)} className="text-destructive focus:text-destructive">
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
                className="text-xs bg-card border rounded-full px-2 py-0.5 shadow-sm hover:bg-accent transition"
              >
                {emoji} <span className="opacity-70 tabular-nums">{count}</span>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
