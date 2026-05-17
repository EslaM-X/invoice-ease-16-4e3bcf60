import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Trash2, Send } from "lucide-react";
import { toast } from "sonner";

const MAX_SECONDS = 15 * 60; // 15 minutes

export function VoiceRecorder({
  onSend,
  rtl,
  disabled,
}: {
  onSend: (blob: Blob, durationSeconds: number) => Promise<void>;
  rtl: boolean;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRef.current = null;
  };

  useEffect(() => () => cleanup(), []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime =
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "audio/mp4";
      const mr = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const b = new Blob(chunksRef.current, { type: mime });
        setBlob(b);
        cleanup();
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
      setSeconds(0);
      setBlob(null);
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) {
            stop();
            return MAX_SECONDS;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err: any) {
      toast.error(err?.message || (rtl ? "تعذر الوصول للمايك" : "Microphone access denied"));
    }
  };

  const stop = () => {
    setRecording(false);
    try {
      mediaRef.current?.stop();
    } catch {}
  };

  const discard = () => {
    setBlob(null);
    setSeconds(0);
  };

  const send = async () => {
    if (!blob) return;
    setBusy(true);
    try {
      await onSend(blob, seconds);
      setBlob(null);
      setSeconds(0);
    } catch (err: any) {
      toast.error(err?.message || "Failed");
    } finally {
      setBusy(false);
    }
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  if (blob) {
    const url = URL.createObjectURL(blob);
    return (
      <div className="flex items-center gap-1.5 flex-1 min-w-0 bg-muted/50 rounded-full px-2 py-1">
        <Button
          size="icon"
          variant="ghost"
          onClick={discard}
          disabled={busy}
          className="h-8 w-8 shrink-0 rounded-full"
          title={rtl ? "حذف" : "Discard"}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
        <audio src={url} controls preload="metadata" className="h-8 flex-1 min-w-0" />
        <span className="text-[11px] font-mono text-muted-foreground shrink-0 px-1 tabular-nums">
          {fmt(seconds)}
        </span>
        <Button
          size="icon"
          onClick={send}
          disabled={busy}
          className="h-9 w-9 shrink-0 rounded-full shadow"
          title={rtl ? "إرسال" : "Send"}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  if (recording) {
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0 bg-destructive/10 rounded-full px-3 py-1">
        <span className="inline-block h-2 w-2 rounded-full bg-destructive animate-pulse shrink-0" />
        <span className="text-sm font-mono tabular-nums shrink-0">{fmt(seconds)}</span>
        <span className="text-[10px] text-muted-foreground truncate hidden xs:inline">
          / {fmt(MAX_SECONDS)}
        </span>
        <div className="flex-1" />
        <Button
          size="icon"
          variant="destructive"
          onClick={stop}
          className="h-9 w-9 shrink-0 rounded-full"
          title={rtl ? "إيقاف" : "Stop"}
        >
          <Square className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={start}
      disabled={disabled}
      className="rounded-full shrink-0"
      title={rtl ? "تسجيل صوتي" : "Voice note"}
    >
      <Mic className="h-4 w-4" />
    </Button>
  );
}
