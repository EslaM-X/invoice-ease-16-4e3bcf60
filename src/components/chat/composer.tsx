import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, Send, X, Image as ImageIcon, AtSign, Users } from "lucide-react";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import { VoiceRecorder } from "@/components/chat/voice-recorder";
import { LuxuryAvatar } from "@/components/chat/luxury-avatar";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ChatMsg } from "./message-bubble";
import { serializeComposerMentions, sanitizePastedMentions } from "@/lib/mentions";

export type MentionMember = {
  user_id: string;
  display_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  is_me?: boolean;
};

type Pending = { file: File; previewUrl: string };

export function Composer({
  rtl,
  disabled,
  activeRoomId,
  replyTo,
  onClearReply,
  onTypingChange,
  onSendText,
  onSendVoice,
  onSendImage,
  members = [],
  isGroup = false,
}: {
  rtl: boolean;
  disabled?: boolean;
  activeRoomId: string;
  replyTo: ChatMsg | null;
  onClearReply: () => void;
  onTypingChange: (typing: boolean) => void;
  onSendText: (body: string, replyToId: string | null) => Promise<void>;
  onSendVoice: (blob: Blob, seconds: number) => Promise<void>;
  onSendImage: (path: string, name: string, mime: string, size: number, replyToId: string | null, caption?: string | null) => Promise<void>;
  members?: MentionMember[];
  isGroup?: boolean;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [uploading, setUploading] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  // Mention picker state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-grow textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const maxH = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches ? 220 : 140;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, maxH) + "px";
  }, [text]);

  useEffect(() => {
    // Focus on room change
    taRef.current?.focus();
  }, [activeRoomId]);

  const triggerTyping = () => {
    onTypingChange(true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => onTypingChange(false), 3500);
  };

  // Detect an active `@word` immediately before the caret.
  const detectMention = (value: string, caret: number) => {
    // Look backwards from caret for an @ that starts a word.
    let i = caret - 1;
    while (i >= 0) {
      const ch = value[i];
      if (ch === "@") {
        const prev = i > 0 ? value[i - 1] : " ";
        if (i === 0 || /\s/.test(prev)) {
          const q = value.slice(i + 1, caret);
          // Stop at whitespace inside query
          if (/\s/.test(q)) return null;
          if (q.length > 30) return null;
          return { start: i, query: q };
        }
        return null;
      }
      if (/\s/.test(ch)) return null;
      i--;
    }
    return null;
  };

  const filteredMembers = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();
    const base = members
      .filter((m) => !m.is_me)
      .filter((m) => {
        if (!q) return true;
        const name = (m.display_name ?? m.email ?? "").toLowerCase();
        return name.includes(q);
      })
      .slice(0, 6);
    const specials: MentionMember[] = [];
    if (isGroup) {
      const matchAll = !q || "all".includes(q) || "everyone".includes(q) || "الكل".includes(mentionQuery);
      if (matchAll) specials.push({ user_id: "all", display_name: "everyone" });
    }
    return [...specials, ...base];
  }, [members, mentionQuery, isGroup]);

  // Track the user_id backing each `@Name` visible in the composer, so we can
  // serialize the message back to the storage token `@[Name](uid)` on send.
  // If the same display name maps to multiple selections, the latest wins.
  const pendingMentionsRef = useRef<Map<string, string>>(new Map());

  const insertMention = (m: MentionMember) => {
    const ta = taRef.current;
    if (!ta || mentionStart === null) return;
    const caret = ta.selectionStart ?? text.length;
    const name = m.user_id === "all" ? "everyone" : (m.display_name ?? m.email ?? "user");
    // Visible token: just `@Name ` — no ids or brackets shown in the input.
    const visible = `@${name} `;
    pendingMentionsRef.current.set(name, m.user_id);
    const next = text.slice(0, mentionStart) + visible + text.slice(caret);
    setText(next);
    setMentionOpen(false);
    setMentionQuery("");
    setMentionStart(null);
    setMentionIndex(0);
    requestAnimationFrame(() => {
      const pos = mentionStart + visible.length;
      ta.focus();
      try { ta.setSelectionRange(pos, pos); } catch {}
    });
  };

  /** Convert visible `@Name` occurrences back to the `@[Name](uid) ` token. */
  const serializeMentions = (raw: string): string =>
    serializeComposerMentions(raw, pendingMentionsRef.current);

  const onTextChange = (value: string, caret: number) => {
    setText(value);
    triggerTyping();
    const det = detectMention(value, caret);
    if (det) {
      setMentionOpen(true);
      setMentionQuery(det.query);
      setMentionStart(det.start);
      setMentionIndex(0);
    } else if (mentionOpen) {
      setMentionOpen(false);
      setMentionQuery("");
      setMentionStart(null);
    }
  };

  const handleSend = async () => {
    const body = text.trim();
    const replyId = replyTo?.id ?? null;
    if (pending) {
      setUploading(true);
      try {
        const ext = pending.file.name.split(".").pop() || "png";
        const path = `${activeRoomId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage
          .from("chat-attachments")
          .upload(path, pending.file, { contentType: pending.file.type, upsert: false });
        if (error) throw error;
        const caption = body ? serializeMentions(body) : null;
        await onSendImage(path, pending.file.name, pending.file.type, pending.file.size, replyId, caption);
        URL.revokeObjectURL(pending.previewUrl);
        setPending(null);
        setText("");
        pendingMentionsRef.current.clear();
        onClearReply();
      } catch (err: any) {
        toast.error(err?.message ?? "Upload failed");
      } finally {
        setUploading(false);
      }
      return;
    }
    if (!body) return;
    const serialized = serializeMentions(body);
    setText("");
    pendingMentionsRef.current.clear();
    onClearReply();
    onTypingChange(false);
    try {
      await onSendText(serialized, replyId);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed");
      setText(body);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && filteredMembers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % filteredMembers.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + filteredMembers.length) % filteredMembers.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredMembers[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape" && replyTo) {
      onClearReply();
    }
  };

  const insertAtCursor = (s: string) => {
    const ta = taRef.current;
    if (!ta) { setText((p) => p + s); return; }
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? start;
    const next = text.slice(0, start) + s + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      const pos = start + s.length;
      ta.focus();
      try { ta.setSelectionRange(pos, pos); } catch {}
      // If user typed '@', open picker
      const det = detectMention(next, pos);
      if (det) {
        setMentionOpen(true);
        setMentionQuery(det.query);
        setMentionStart(det.start);
        setMentionIndex(0);
      }
    });
  };

  const onPickFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error(rtl ? "الصور فقط حاليًا" : "Images only for now");
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      toast.error(rtl ? "الحد 8 ميجا" : "Max 8MB");
      return;
    }
    setPending({ file: f, previewUrl: URL.createObjectURL(f) });
  };

  return (
    <div className="border-t bg-card/80 backdrop-blur-xl relative">
      {mentionOpen && filteredMembers.length > 0 && (
        <div
          className="absolute left-2 right-2 md:left-6 md:right-6 lg:left-10 lg:right-10 bottom-full mb-1 z-30 rounded-2xl border border-[color:var(--brand-gold,#d4af37)]/25 bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden max-h-64 overflow-y-auto"
          dir={rtl ? "rtl" : "ltr"}
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-white/5 flex items-center gap-1.5">
            <AtSign className="h-3 w-3" />
            {rtl ? "منشن عضو" : "Mention someone"}
          </div>
          {filteredMembers.map((m, i) => {
            const isAll = m.user_id === "all";
            const name = isAll ? (rtl ? "الكل" : "everyone") : (m.display_name ?? m.email ?? "user");
            const sub = isAll ? (rtl ? "إشعار جميع الأعضاء" : "Notify all members") : (m.email ?? "");
            return (
              <button
                key={m.user_id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
                onMouseEnter={() => setMentionIndex(i)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 text-start hover:bg-[color:var(--brand-gold,#d4af37)]/10 transition",
                  i === mentionIndex && "bg-[color:var(--brand-gold,#d4af37)]/15"
                )}
              >
                {isAll ? (
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[color:var(--brand-gold,#d4af37)] to-amber-600 flex items-center justify-center text-black">
                    <Users className="h-4 w-4" />
                  </div>
                ) : (
                  <LuxuryAvatar url={m.avatar_url ?? null} name={name} size={32} ring="gold" showSkeleton={false} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate flex items-center gap-1.5">
                    <span className="text-[color:var(--brand-gold,#d4af37)]">@</span>
                    <span className="truncate">{name}</span>
                  </div>
                  {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {replyTo && (
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 text-xs">
          <div className="w-1 self-stretch bg-primary rounded-full" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">
              {rtl ? "رد على" : "Replying to"} {replyTo.sender_display_name}
            </div>
            <div className="opacity-70 truncate">
              {replyTo.message_type === "voice"
                ? (rtl ? "🎤 رسالة صوتية" : "🎤 Voice message")
                : replyTo.message_type === "image"
                  ? (rtl ? "📷 صورة" : "📷 Image")
                  : replyTo.body}
            </div>
          </div>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClearReply} aria-label={rtl ? "إلغاء" : "Cancel"}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {pending && (
        <div className="flex items-center gap-3 px-3 py-2 border-b bg-muted/30">
          <img src={pending.previewUrl} alt="" className="h-14 w-14 rounded-md object-cover ring-1 ring-border" />
          <div className="flex-1 min-w-0 text-xs">
            <div className="font-medium truncate">{pending.file.name}</div>
            <div className="opacity-60">{(pending.file.size / 1024).toFixed(1)} KB</div>
          </div>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { URL.revokeObjectURL(pending.previewUrl); setPending(null); }}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div
        className={cn("flex items-end gap-1.5 p-2 sm:p-3 md:px-6 md:py-4 lg:px-10", "pb-[max(env(safe-area-inset-bottom),0.5rem)]")}
      >
        {!voiceActive && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { onPickFile(e.target.files?.[0]); e.currentTarget.value = ""; }}
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 rounded-full text-muted-foreground hover:text-primary shrink-0"
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              aria-label={rtl ? "إرفاق صورة" : "Attach image"}
            >
              <ImageIcon className="h-5 w-5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 rounded-full text-muted-foreground hover:text-[color:var(--brand-gold,#d4af37)] shrink-0"
              onClick={() => insertAtCursor("@")}
              disabled={disabled}
              aria-label={rtl ? "منشن" : "Mention"}
            >
              <AtSign className="h-5 w-5" />
            </Button>
            <EmojiPicker
              quickBar
              onPick={(e) => { insertAtCursor(e); triggerTyping(); }}
            />
          </>
        )}

        {voiceActive ? (
          <VoiceRecorder
            rtl={rtl}
            disabled={disabled}
            onSend={onSendVoice}
            onActiveChange={setVoiceActive}
          />
        ) : (
          <>
            <textarea
              ref={taRef}
              rows={1}
              value={text}
              disabled={disabled || uploading}
              onChange={(e) => onTextChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
              onPaste={(e) => {
                // Sanitize any raw storage tokens (`@[Name](uid)`) pasted from
                // copied messages so the composer only ever shows clean `@Name`.
                const raw = e.clipboardData.getData("text");
                if (!raw || !/@\[[^\]]+\]\([^)\s]+\)/.test(raw)) return;
                e.preventDefault();
                const cleaned = raw.replace(/@\[([^\]]{1,80})\]\(([^)\s]{1,80})\)/g, (_all, name, uid) => {
                  pendingMentionsRef.current.set(name, uid);
                  return `@${name}`;
                });
                const ta = taRef.current;
                if (!ta) { setText((p) => p + cleaned); return; }
                const start = ta.selectionStart ?? text.length;
                const end = ta.selectionEnd ?? start;
                const next = text.slice(0, start) + cleaned + text.slice(end);
                setText(next);
                requestAnimationFrame(() => {
                  const pos = start + cleaned.length;
                  try { ta.setSelectionRange(pos, pos); } catch {}
                });
              }}
              onKeyUp={(e) => {
                const t = e.currentTarget;
                const det = detectMention(t.value, t.selectionStart ?? t.value.length);
                if (det) {
                  if (!mentionOpen) setMentionOpen(true);
                  setMentionQuery(det.query);
                  setMentionStart(det.start);
                } else if (mentionOpen) {
                  setMentionOpen(false);
                }
              }}
              onKeyDown={onKeyDown}
              placeholder={rtl ? "اكتب رسالة... (اكتب @ لعمل منشن)" : "Type a message... (@ to mention)"}
              className="flex-1 min-w-0 resize-none bg-muted/40 rounded-2xl px-4 py-2.5 md:px-5 md:py-3.5 md:text-[15px] md:min-h-[52px] text-sm leading-relaxed outline-none focus:ring-2 focus:ring-primary/40 transition placeholder:text-muted-foreground/60 max-h-[140px] md:max-h-[220px]"
              dir={rtl ? "rtl" : "ltr"}
            />

            {text.trim() || pending ? (
              <Button
                size="icon"
                onClick={handleSend}
                disabled={disabled || uploading}
                className="h-10 w-10 md:h-12 md:w-12 rounded-full shrink-0 shadow-md bg-gradient-to-br from-primary to-primary/85"
                aria-label={rtl ? "إرسال" : "Send"}
              >
                <Send className="h-4 w-4 md:h-5 md:w-5" />
              </Button>
            ) : (
              <VoiceRecorder
                rtl={rtl}
                disabled={disabled}
                onSend={onSendVoice}
                onActiveChange={setVoiceActive}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
