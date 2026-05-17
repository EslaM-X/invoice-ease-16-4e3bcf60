import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause } from "lucide-react";

const SPEEDS = [1, 1.5, 2] as const;

export function VoicePlayer({
  url,
  durationSeconds,
  tone = "neutral",
}: {
  url: string;
  durationSeconds?: number | null;
  tone?: "mine" | "neutral";
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [speed, setSpeed] = useState<number>(1);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrent(a.currentTime);
    const onMeta = () => {
      if (!Number.isNaN(a.duration) && Number.isFinite(a.duration)) setDuration(a.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setCurrent(0);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.playbackRate = speed;
      await a.play();
      setPlaying(true);
    }
  };

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(speed as 1 | 1.5 | 2);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const fmt = (s: number) => {
    if (!Number.isFinite(s)) s = 0;
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  };

  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const trackBg = tone === "mine" ? "bg-primary-foreground/30" : "bg-muted";
  const fillBg = tone === "mine" ? "bg-primary-foreground" : "bg-primary";

  return (
    <div className="flex items-center gap-2 min-w-[200px]">
      <audio ref={audioRef} src={url} preload="metadata" />
      <Button
        size="icon"
        variant={tone === "mine" ? "secondary" : "outline"}
        className="h-8 w-8 rounded-full shrink-0"
        onClick={toggle}
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <div className="flex-1">
        <div className={`h-1.5 rounded-full ${trackBg} overflow-hidden`}>
          <div className={`h-full ${fillBg} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between text-[10px] opacity-70 mt-1">
          <span className="font-mono">{fmt(current)}</span>
          <span className="font-mono">{fmt(duration)}</span>
        </div>
      </div>
      <button
        onClick={cycleSpeed}
        className={`text-[10px] font-semibold rounded-full px-2 py-0.5 border shrink-0 ${
          tone === "mine" ? "border-primary-foreground/40" : "border-border"
        }`}
        title="Playback speed"
      >
        {speed}x
      </button>
    </div>
  );
}
