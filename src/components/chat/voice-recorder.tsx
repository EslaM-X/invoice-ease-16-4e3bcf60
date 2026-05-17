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
      <div className="flex items-center gap-2 flex-1">
        <Button size="icon" variant="ghost" onClick={discard} disabled={busy} title={rtl ? "حذف" : "Discard"}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
        <audio src={url} controls className="h-9 flex-1" />
        <Button size="icon" onClick={send} disabled={busy}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  if (recording) {
    return (
      <div className="flex items-center gap-2 flex-1">
        <span className="inline-block h-2 w-2 rounded-full bg-destructive animate-pulse" />
        <span className="text-sm font-mono">{fmt(seconds)}</span>
        <span className="text-xs text-muted-foreground">
          / {fmt(MAX_SECONDS)} {rtl ? "كحد أقصى" : "max"}
        </span>
        <div className="flex-1" />
        <Button size="icon" variant="destructive" onClick={stop}>
          <Square className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Button size="icon" variant="ghost" onClick={start} disabled={disabled} title={rtl ? "تسجيل صوتي" : "Voice note"}>
      <Mic className="h-4 w-4" />
    </Button>
  );
}
