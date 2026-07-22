import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, Rewind, FastForward } from "lucide-react";
import { cn } from "@/lib/utils";

const SPEEDS = [1, 1.5, 2] as const;

/**
 * Cheap deterministic pseudo-waveform: uses url hash to produce stable bars.
 * Fast + no network cost. Real waveform decode is overkill for chat voice notes.
 */
function useFakeWaveform(url: string, bars = 42): number[] {
  return useMemo(() => {
    let seed = 0;
    for (let i = 0; i < url.length; i++) seed = (seed * 31 + url.charCodeAt(i)) >>> 0;
    const out: number[] = [];
    for (let i = 0; i < bars; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      // Bell-ish shape: taller in the middle
      const bellPos = i / (bars - 1); // 0..1
      const bell = 0.35 + 0.55 * Math.sin(Math.PI * bellPos);
      const rand = ((seed >>> 8) & 0xff) / 255;
      out.push(Math.max(0.18, Math.min(1, bell * (0.55 + rand * 0.55))));
    }
    return out;
  }, [url, bars]);
}

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
  const bars = useFakeWaveform(url, 40);

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

  const skip = (delta: number) => {
    const a = audioRef.current;
    if (!a) return;
    const d = Number.isFinite(a.duration) ? a.duration : duration;
    const next = Math.max(0, Math.min(d || 0, a.currentTime + delta));
    a.currentTime = next;
    setCurrent(next);
  };

  const seekTo = (fraction: number) => {
    const a = audioRef.current;
    if (!a) return;
    const d = Number.isFinite(a.duration) ? a.duration : duration;
    if (!d) return;
    const t = Math.max(0, Math.min(d, fraction * d));
    a.currentTime = t;
    setCurrent(t);
  };

  const fmt = (s: number) => {
    if (!Number.isFinite(s)) s = 0;
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  };

  const pct = duration > 0 ? Math.min(1, current / duration) : 0;
  const mine = tone === "mine";
  const barBg = mine ? "bg-primary-foreground/35" : "bg-primary/25";
  const barActive = mine ? "bg-primary-foreground" : "bg-primary";
  const btnCls = mine
    ? "text-primary-foreground hover:bg-primary-foreground/15"
    : "text-foreground hover:bg-muted";

  return (
    <div className="flex items-center gap-1.5 min-w-[240px]">
      <audio ref={audioRef} src={url} preload="metadata" />

      <Button
        size="icon"
        variant="ghost"
        className={cn("h-7 w-7 rounded-full shrink-0", btnCls)}
        onClick={() => skip(-10)}
        title="-10s"
        aria-label="Rewind 10 seconds"
      >
        <Rewind className="h-3.5 w-3.5" />
      </Button>

      <Button
        size="icon"
        variant={mine ? "secondary" : "outline"}
        className="h-9 w-9 rounded-full shrink-0 shadow"
        onClick={toggle}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ms-0.5" />}
      </Button>

      <Button
        size="icon"
        variant="ghost"
        className={cn("h-7 w-7 rounded-full shrink-0", btnCls)}
        onClick={() => skip(10)}
        title="+10s"
        aria-label="Forward 10 seconds"
      >
        <FastForward className="h-3.5 w-3.5" />
      </Button>

      <div className="flex-1 min-w-0">
        <button
          type="button"
          className="w-full flex items-end gap-[2px] h-7 cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            seekTo(x / rect.width);
          }}
          aria-label="Seek"
        >
          {bars.map((h, i) => {
            const passed = i / bars.length < pct;
            return (
              <span
                key={i}
                className={cn(
                  "flex-1 rounded-full transition-colors",
                  passed ? barActive : barBg
                )}
                style={{ height: `${Math.round(h * 100)}%`, minHeight: 3 }}
              />
            );
          })}
        </button>
        <div className="flex items-center justify-between text-[10px] opacity-70 mt-0.5">
          <span className="font-mono tabular-nums">{fmt(current)}</span>
          <span className="font-mono tabular-nums">{fmt(duration)}</span>
        </div>
      </div>

      <button
        onClick={cycleSpeed}
        className={cn(
          "text-[11px] font-bold rounded-full px-2.5 py-1 border shrink-0 shadow-sm",
          mine
            ? "border-primary-foreground/50 bg-primary-foreground/15 text-primary-foreground"
            : "border-[color:var(--brand-gold,#d4af37)]/40 bg-[color:var(--brand-gold,#d4af37)]/10 text-foreground"
        )}
        title="Playback speed"
      >
        {speed}×
      </button>
    </div>
  );
}
