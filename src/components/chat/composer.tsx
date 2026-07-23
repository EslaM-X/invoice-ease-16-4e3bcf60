import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, Send, X, Image as ImageIcon } from "lucide-react";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import { VoiceRecorder } from "@/components/chat/voice-recorder";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ChatMsg } from "./message-bubble";

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
}: {
  rtl: boolean;
  disabled?: boolean;
  activeRoomId: string;
  replyTo: ChatMsg | null;
  onClearReply: () => void;
  onTypingChange: (typing: boolean) => void;
  onSendText: (body: string, replyToId: string | null) => Promise<void>;
  onSendVoice: (blob: Blob, seconds: number) => Promise<void>;
  onSendImage: (path: string, name: string, mime: string, size: number, replyToId: string | null) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [uploading, setUploading] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
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
        await onSendImage(path, pending.file.name, pending.file.type, pending.file.size, replyId);
        URL.revokeObjectURL(pending.previewUrl);
        setPending(null);
        setText("");
        onClearReply();
      } catch (err: any) {
        toast.error(err?.message ?? "Upload failed");
      } finally {
        setUploading(false);
      }
      return;
    }
    if (!body) return;
    setText("");
    onClearReply();
    onTypingChange(false);
    try {
      await onSendText(body, replyId);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed");
      setText(body);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape" && replyTo) {
      onClearReply();
    }
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
    <div className="border-t bg-card/80 backdrop-blur-xl">
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
        className={cn("flex items-end gap-1.5 p-2 sm:p-3", "pb-[max(env(safe-area-inset-bottom),0.5rem)]")}
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
            <EmojiPicker
              quickBar
              onPick={(e) => {
                setText((prev) => prev + e);
                taRef.current?.focus();
                triggerTyping();
              }}
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
              onChange={(e) => { setText(e.target.value); triggerTyping(); }}
              onKeyDown={onKeyDown}
              placeholder={rtl ? "اكتب رسالة..." : "Type a message..."}
              className="flex-1 min-w-0 resize-none bg-muted/40 rounded-2xl px-4 py-2.5 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-primary/40 transition placeholder:text-muted-foreground/60 max-h-[140px]"
              dir={rtl ? "rtl" : "ltr"}
            />
            {text.trim() || pending ? (
              <Button
                size="icon"
                onClick={handleSend}
                disabled={disabled || uploading}
                className="h-10 w-10 rounded-full shrink-0 shadow-md bg-gradient-to-br from-primary to-primary/85"
                aria-label={rtl ? "إرسال" : "Send"}
              >
                <Send className="h-4 w-4" />
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
