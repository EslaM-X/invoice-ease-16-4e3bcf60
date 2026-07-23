/**
 * Screen-share diagnostics, live quality monitor and auto-fallback controller.
 *
 * This module owns everything that observes the LOCAL screen-share publication:
 *   • polls RTCStatsReport every 2s and derives bitrate / fps / freezes / RTT
 *   • classifies quality (excellent → poor) and warns on sudden drops
 *   • detects instability (track ended unexpectedly, sustained low bitrate,
 *     freeze bursts, `qualityLimitationReason === "bandwidth"`) and asks
 *     the user to switch to the next capture surface — the browser still
 *     requires a user gesture to open the picker, so we surface a toast
 *     action that re-runs the preview flow with the next surface pre-selected
 *   • renders an unobtrusive live bandwidth / quality pill next to the badge
 *   • renders a full diagnostics dialog with an "Export JSON" button so the
 *     user can share a snapshot of stats + recent errors with support
 *
 * All persisted preferences (resolution / fps / perf mode / surface) live in
 * `localStorage` under the `LS_*` keys exported below so the CallStage
 * preview form can read/write them without duplicating string keys.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useLocalParticipant,
  useConnectionQualityIndicator,
  useRoomContext,
} from "@livekit/components-react";
import {
  Track,
  ConnectionQuality,
  RoomEvent,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type Participant,
} from "livekit-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Activity,
  Download,
  Gauge,
  AlertTriangle,
  Zap,
  Wand2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Storage keys — shared with CallStage preview UI                     */
/* ------------------------------------------------------------------ */
export const LS_SHARE_RES = "call.screenShare.resolution"; // "720" | "1080"
export const LS_SHARE_FPS = "call.screenShare.fps";        // "15" | "30" | "60"
export const LS_PERF_MODE = "call.screenShare.perfMode";   // "quality" | "balanced" | "latency" | "auto"

export type ShareRes = "720" | "1080";
export type ShareFps = "15" | "30" | "60";
export type PerfMode = "quality" | "balanced" | "latency" | "auto";

export function readShareRes(): ShareRes {
  const v = safeRead(LS_SHARE_RES, "1080");
  return v === "720" ? "720" : "1080";
}
export function readShareFps(): ShareFps {
  const v = safeRead(LS_SHARE_FPS, "30");
  return v === "15" || v === "60" ? v : "30";
}
export function readPerfMode(): PerfMode {
  const v = safeRead(LS_PERF_MODE, "balanced");
  return (["quality", "balanced", "latency", "auto"] as const).includes(v as any)
    ? (v as PerfMode)
    : "balanced";
}
function safeRead(k: string, d: string) {
  try { return localStorage.getItem(k) ?? d; } catch { return d; }
}
export function writeLS(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* Encoding presets — resolved from res/fps + perf mode                */
/* ------------------------------------------------------------------ */

export interface ResolvedEncoding {
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
  maxFramerate: number;
  degradationPreference: RTCDegradationPreference;
  simulcast: boolean;
}

export function resolveScreenEncoding(
  res: ShareRes,
  fps: ShareFps,
  mode: PerfMode,
  connection: ConnectionQuality = ConnectionQuality.Good,
): ResolvedEncoding {
  const dims = res === "1080"
    ? { width: 1920, height: 1080 }
    : { width: 1280, height: 720 };
  const frameRate = Number(fps);

  // Auto mode maps quality → perf profile.
  let effective: Exclude<PerfMode, "auto"> = mode === "auto"
    ? (connection === ConnectionQuality.Excellent ? "quality"
      : connection === ConnectionQuality.Good ? "balanced"
      : "latency")
    : mode;

  const baseBitrate = res === "1080" ? 4_000_000 : 2_500_000;

  if (effective === "latency") {
    return {
      ...dims,
      frameRate: Math.min(frameRate, 15),
      maxBitrate: Math.round(baseBitrate * 0.4),
      maxFramerate: Math.min(frameRate, 15),
      degradationPreference: "maintain-framerate",
      simulcast: false,
    };
  }
  if (effective === "quality") {
    return {
      ...dims,
      frameRate,
      maxBitrate: Math.round(baseBitrate * 1.1),
      maxFramerate: frameRate,
      degradationPreference: "maintain-resolution",
      simulcast: true,
    };
  }
  // balanced
  return {
    ...dims,
    frameRate,
    maxBitrate: baseBitrate,
    maxFramerate: frameRate,
    degradationPreference: "balanced",
    simulcast: true,
  };
}

/* ------------------------------------------------------------------ */
/* Stats sampler — polls the local screen-share sender every 2s        */
/* ------------------------------------------------------------------ */

export interface ShareStatsSample {
  ts: number;                   // epoch ms
  kbps: number;                 // outbound bitrate over the last window
  fps: number | null;           // framesPerSecond
  frames: number;               // framesSent
  freezes: number;              // freezeCount (cumulative)
  freezeDelta: number;          // freezes since previous sample
  jitter: number | null;        // seconds
  rtt: number | null;           // seconds
  packetLoss: number | null;    // fraction 0..1
  qualityLimitationReason: string | null; // "none" | "cpu" | "bandwidth" | "other"
  width: number | null;
  height: number | null;
  codec: string | null;
  encoder: string | null;
}

export type QualityBand = "excellent" | "good" | "fair" | "poor" | "critical";

export function classifyQuality(s: ShareStatsSample | null): QualityBand {
  if (!s) return "good";
  if (s.kbps === 0 && s.frames === 0) return "critical";
  const loss = s.packetLoss ?? 0;
  const rtt = s.rtt ?? 0;
  if (s.kbps < 100 || loss > 0.15 || rtt > 0.6) return "critical";
  if (s.kbps < 300 || loss > 0.08 || rtt > 0.4) return "poor";
  if (s.kbps < 800 || loss > 0.04 || rtt > 0.25) return "fair";
  if (s.kbps < 2000 || loss > 0.02) return "good";
  return "excellent";
}

interface ShareErrorLog {
  ts: number;
  kind: "track-ended" | "publish-failed" | "media-failure" | "room-error" | "quality-drop";
  message: string;
}

interface MonitorState {
  samples: ShareStatsSample[];
  errors: ShareErrorLog[];
  latest: ShareStatsSample | null;
  quality: QualityBand;
  isSharing: boolean;
  codec: string | null;
}

const MAX_SAMPLES = 60; // ~2 minutes of history at 2s cadence
const MAX_ERRORS = 30;

export function useScreenShareMonitor(opts: {
  onUnstable?: (reason: string) => void;
}): MonitorState {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const [state, setState] = useState<MonitorState>({
    samples: [],
    errors: [],
    latest: null,
    quality: "good",
    isSharing: false,
    codec: null,
  });
  const onUnstableRef = useRef(opts.onUnstable);
  onUnstableRef.current = opts.onUnstable;
  const prevRef = useRef<{ bytes: number; frames: number; freezes: number; ts: number } | null>(null);
  const unstableStreakRef = useRef(0);
  const lastQualityRef = useRef<QualityBand>("good");

  const pushError = useCallback((kind: ShareErrorLog["kind"], message: string) => {
    setState((s) => ({
      ...s,
      errors: [...s.errors.slice(-(MAX_ERRORS - 1)), { ts: Date.now(), kind, message }],
    }));
  }, []);

  useEffect(() => {
    if (!room) return;
    const onError = (e: Error) => pushError("room-error", e?.message ?? String(e));
    const onMediaFail = (e: unknown) => pushError("media-failure", String(e ?? "unknown"));
    room.on(RoomEvent.SignalConnected, () => {});
    room.on(RoomEvent.MediaDevicesError, onMediaFail as any);
    return () => {
      room.off(RoomEvent.MediaDevicesError, onMediaFail as any);
    };
  }, [room, pushError]);

  useEffect(() => {
    if (!localParticipant) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const getPub = (): LocalTrackPublication | undefined =>
      localParticipant.getTrackPublication(Track.Source.ScreenShare);

    const detectStart = () => {
      const pub = getPub();
      const track = pub?.track as LocalVideoTrack | undefined;
      const sharing = !!track && !track.isMuted;
      setState((s) => (s.isSharing === sharing ? s : { ...s, isSharing: sharing }));
      if (!sharing) {
        prevRef.current = null;
        unstableStreakRef.current = 0;
        return;
      }
      // Wire the track-ended listener once per publication.
      const mst = track!.mediaStreamTrack;
      if (mst && !(mst as any)._diagWired) {
        (mst as any)._diagWired = true;
        mst.addEventListener("ended", () => {
          pushError("track-ended", `Capture source ended (${mst.label || "unknown"})`);
          onUnstableRef.current?.("source-ended");
        });
      }
    };

    const sample = async () => {
      const pub = getPub();
      const track = pub?.track as LocalVideoTrack | undefined;
      if (!track) return;

      let report: RTCStatsReport | undefined;
      try {
        report = await (track as any).getRTCStatsReport?.();
      } catch { /* ignore */ }
      if (!report) return;

      let bytes = 0, frames = 0, freezes = 0;
      let fps: number | null = null;
      let jitter: number | null = null;
      let rtt: number | null = null;
      let packetLoss: number | null = null;
      let qlr: string | null = null;
      let width: number | null = null, height: number | null = null;
      let codec: string | null = null;
      let encoder: string | null = null;
      let packetsSent = 0, packetsLost = 0;
      let codecId: string | null = null;

      report.forEach((r: any) => {
        if (r.type === "outbound-rtp" && r.kind === "video") {
          bytes = Math.max(bytes, r.bytesSent ?? 0);
          frames = Math.max(frames, r.framesSent ?? 0);
          freezes = Math.max(freezes, r.freezeCount ?? 0);
          if (typeof r.framesPerSecond === "number") fps = r.framesPerSecond;
          width = r.frameWidth ?? width;
          height = r.frameHeight ?? height;
          qlr = r.qualityLimitationReason ?? qlr;
          encoder = r.encoderImplementation ?? encoder;
          packetsSent += r.packetsSent ?? 0;
          codecId = r.codecId ?? codecId;
        } else if (r.type === "remote-inbound-rtp" && r.kind === "video") {
          if (typeof r.roundTripTime === "number") rtt = r.roundTripTime;
          if (typeof r.jitter === "number") jitter = r.jitter;
          packetsLost += r.packetsLost ?? 0;
        }
      });
      if (codecId) {
        const c = report.get(codecId) as any;
        if (c?.mimeType) codec = String(c.mimeType).split("/")[1] ?? c.mimeType;
      }
      if (packetsSent > 0) packetLoss = packetsLost / Math.max(packetsSent, 1);

      const now = Date.now();
      const prev = prevRef.current;
      let kbps = 0;
      let freezeDelta = 0;
      if (prev) {
        const dtSec = Math.max((now - prev.ts) / 1000, 0.001);
        kbps = Math.max(0, ((bytes - prev.bytes) * 8) / 1000 / dtSec);
        freezeDelta = Math.max(0, freezes - prev.freezes);
      }
      prevRef.current = { bytes, frames, freezes, ts: now };

      const s: ShareStatsSample = {
        ts: now, kbps: Math.round(kbps), fps: fps == null ? null : Math.round(fps),
        frames, freezes, freezeDelta, jitter, rtt, packetLoss, qualityLimitationReason: qlr,
        width, height, codec, encoder,
      };
      const q = classifyQuality(s);

      // Instability heuristic: two consecutive critical samples, OR a burst of
      // ≥3 freezes in one window, OR sustained bandwidth-limited state.
      const criticalStreak = q === "critical" ? unstableStreakRef.current + 1 : 0;
      unstableStreakRef.current = criticalStreak;
      const badBw = qlr === "bandwidth" && s.kbps < 200;
      const freezeBurst = s.freezeDelta >= 3;
      if (criticalStreak >= 2 || badBw || freezeBurst) {
        unstableStreakRef.current = 0;
        onUnstableRef.current?.(
          criticalStreak >= 2 ? "sustained-critical"
          : badBw ? "bandwidth-limited"
          : "freeze-burst"
        );
      }

      // Drop warning (fair→poor / poor→critical) — toast at most every 8s.
      if (
        (lastQualityRef.current === "excellent" || lastQualityRef.current === "good") &&
        (q === "poor" || q === "critical")
      ) {
        pushError("quality-drop", `${lastQualityRef.current} → ${q} @ ${s.kbps} kbps`);
      }
      lastQualityRef.current = q;

      if (cancelled) return;
      setState((prevSt) => ({
        ...prevSt,
        latest: s,
        quality: q,
        codec,
        samples: [...prevSt.samples.slice(-(MAX_SAMPLES - 1)), s],
      }));
    };

    // Faster startup detection, slower steady-state polling.
    const boot = setInterval(detectStart, 750);
    interval = setInterval(sample, 2000);

    return () => {
      cancelled = true;
      clearInterval(boot);
      if (interval) clearInterval(interval);
    };
  }, [localParticipant, pushError]);

  return state;
}

/* ------------------------------------------------------------------ */
/* Live bandwidth / quality pill                                       */
/* ------------------------------------------------------------------ */

const bandStyles: Record<QualityBand, string> = {
  excellent: "border-emerald-400/40 bg-emerald-500/15 text-emerald-100",
  good:      "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
  fair:      "border-amber-400/40 bg-amber-500/15 text-amber-100",
  poor:      "border-orange-400/50 bg-orange-500/20 text-orange-100",
  critical:  "border-red-500/60 bg-red-500/25 text-red-100 animate-pulse",
};

const bandLabelEn: Record<QualityBand, string> = {
  excellent: "Excellent", good: "Good", fair: "Fair", poor: "Poor", critical: "Critical",
};
const bandLabelAr: Record<QualityBand, string> = {
  excellent: "ممتاز", good: "جيد", fair: "متوسط", poor: "ضعيف", critical: "حرج",
};

export function ShareQualityBadge({
  rtl,
  state,
  onOpenDiagnostics,
}: {
  rtl: boolean;
  state: MonitorState;
  onOpenDiagnostics: () => void;
}) {
  if (!state.isSharing || !state.latest) return null;
  const s = state.latest;
  const label = rtl ? bandLabelAr[state.quality] : bandLabelEn[state.quality];
  const kbpsLabel = s.kbps >= 1000 ? `${(s.kbps / 1000).toFixed(1)} Mbps` : `${s.kbps} kbps`;
  const title = rtl
    ? `جودة المشاركة: ${label} • ${kbpsLabel} • ${s.fps ?? "—"} fps — اضغط للتشخيص`
    : `Share quality: ${label} • ${kbpsLabel} • ${s.fps ?? "—"} fps — click for diagnostics`;

  return (
    <button
      type="button"
      onClick={onOpenDiagnostics}
      dir={rtl ? "rtl" : "ltr"}
      aria-label={title}
      title={title}
      className={cn(
        "absolute top-28 z-20 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur-xl shadow-lg transition",
        "hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300",
        bandStyles[state.quality],
        rtl ? "right-4" : "left-4",
      )}
    >
      <Activity className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="tabular-nums">{kbpsLabel}</span>
      <span className="opacity-70">·</span>
      <span className="tabular-nums">{s.fps ?? "—"} fps</span>
      <span className="opacity-70">·</span>
      <span>{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Diagnostics dialog                                                  */
/* ------------------------------------------------------------------ */

export function ShareDiagnosticsDialog({
  rtl, open, onOpenChange, state,
}: {
  rtl: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  state: MonitorState;
}) {
  const s = state.latest;

  const exportJson = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "n/a",
      screen: typeof window !== "undefined"
        ? { w: window.screen?.width, h: window.screen?.height, dpr: window.devicePixelRatio }
        : null,
      quality: state.quality,
      latest: state.latest,
      codec: state.codec,
      samples: state.samples,
      errors: state.errors,
      prefs: {
        resolution: readShareRes(),
        fps: readShareFps(),
        perfMode: readPerfMode(),
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `screen-share-diagnostics-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(rtl ? "تم تصدير التشخيص" : "Diagnostics exported");
  }, [state, rtl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir={rtl ? "rtl" : "ltr"}
        className="max-w-2xl bg-neutral-950 text-white border-white/10"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-amber-300" aria-hidden="true" />
            {rtl ? "تشخيص مشاركة الشاشة" : "Screen share diagnostics"}
          </DialogTitle>
          <DialogDescription className="text-white/60">
            {rtl
              ? "قياسات لحظية للـ RTC + سجل الأخطاء. اضغط «تصدير JSON» لمشاركة الملف مع الدعم."
              : "Live RTC measurements + recent errors. Export the JSON to share with support."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <Metric label={rtl ? "الجودة" : "Quality"} value={rtl ? bandLabelAr[state.quality] : bandLabelEn[state.quality]} />
          <Metric label={rtl ? "معدل البت" : "Bitrate"} value={s ? `${s.kbps} kbps` : "—"} />
          <Metric label="FPS" value={s?.fps != null ? String(s.fps) : "—"} />
          <Metric label={rtl ? "الدقة" : "Resolution"} value={s?.width && s.height ? `${s.width}×${s.height}` : "—"} />
          <Metric label="RTT" value={s?.rtt != null ? `${Math.round(s.rtt * 1000)} ms` : "—"} />
          <Metric label={rtl ? "الفقد" : "Loss"} value={s?.packetLoss != null ? `${(s.packetLoss * 100).toFixed(1)}%` : "—"} />
          <Metric label={rtl ? "الجيتر" : "Jitter"} value={s?.jitter != null ? `${Math.round(s.jitter * 1000)} ms` : "—"} />
          <Metric label={rtl ? "تجمّدات" : "Freezes"} value={s ? String(s.freezes) : "—"} />
          <Metric label={rtl ? "الترميز" : "Codec"} value={state.codec ?? "—"} />
          <Metric label={rtl ? "المحرك" : "Encoder"} value={s?.encoder ?? "—"} />
          <Metric label={rtl ? "قيد الجودة" : "Limit"} value={s?.qualityLimitationReason ?? "—"} />
          <Metric label={rtl ? "عيّنات" : "Samples"} value={String(state.samples.length)} />
        </div>

        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-white/50">
            {rtl ? "آخر الأخطاء" : "Recent errors"}
          </div>
          <div className="max-h-40 overflow-y-auto rounded border border-white/10 bg-black/40 p-2 text-xs">
            {state.errors.length === 0 ? (
              <div className="text-white/50">{rtl ? "لا أخطاء مسجّلة." : "No errors logged."}</div>
            ) : (
              <ul className="space-y-1 font-mono">
                {state.errors.slice(-15).reverse().map((e, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-white/40 tabular-nums">
                      {new Date(e.ts).toLocaleTimeString()}
                    </span>
                    <span className="text-amber-300">[{e.kind}]</span>
                    <span className="text-white/90 truncate">{e.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {rtl ? "إغلاق" : "Close"}
          </Button>
          <Button onClick={exportJson} className="bg-amber-500 hover:bg-amber-400 text-black">
            <Download className="mr-1 h-4 w-4" aria-hidden="true" />
            {rtl ? "تصدير JSON" : "Export JSON"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.03] px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-white/50">{label}</div>
      <div className="tabular-nums font-semibold">{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Auto-fallback controller                                            */
/* ------------------------------------------------------------------ */

/**
 * When the monitor emits an "unstable" event we cycle the persisted preferred
 * capture surface (monitor → window → browser → monitor) and invoke the
 * supplied `requestRestart` callback so the CallStage preview flow re-opens
 * with the new surface pre-selected. The browser requires a fresh user
 * gesture to call `getDisplayMedia` again, so we surface the retry as a toast
 * action rather than silently swapping sources.
 */
export const SURFACE_ORDER = ["monitor", "window", "browser"] as const;
export type Surface = typeof SURFACE_ORDER[number];

export function nextSurface(current: Surface): Surface {
  const i = SURFACE_ORDER.indexOf(current);
  return SURFACE_ORDER[(i + 1) % SURFACE_ORDER.length];
}

export function useAutoFallback(opts: {
  rtl: boolean;
  isSharing: boolean;
  currentSurface: Surface;
  onSwitchTo: (s: Surface) => void; // updates the persisted preference
  onRestart: () => void;            // triggers openPicker() flow
}) {
  const { rtl, isSharing, currentSurface, onSwitchTo, onRestart } = opts;
  const cooldownRef = useRef(0);

  return useCallback((reason: string) => {
    if (!isSharing) return;
    const now = Date.now();
    if (now - cooldownRef.current < 10_000) return; // one prompt per 10s
    cooldownRef.current = now;

    const next = nextSurface(currentSurface);
    const reasonLabel = rtl
      ? (reason === "source-ended" ? "المصدر توقف"
        : reason === "bandwidth-limited" ? "الشبكة ضعيفة"
        : reason === "freeze-burst" ? "تجمّدات متكررة"
        : "جودة حرجة")
      : (reason === "source-ended" ? "source ended"
        : reason === "bandwidth-limited" ? "bandwidth-limited"
        : reason === "freeze-burst" ? "freeze burst"
        : "critical quality");

    toast.warning(
      rtl
        ? `مشاركة الشاشة غير مستقرة (${reasonLabel}). جرّب ${next}.`
        : `Screen share unstable (${reasonLabel}). Try ${next}.`,
      {
        id: "share-fallback",
        duration: 8000,
        action: {
          label: rtl ? "التبديل التلقائي" : "Auto-switch",
          onClick: () => {
            onSwitchTo(next);
            onRestart();
          },
        },
      }
    );
  }, [rtl, isSharing, currentSurface, onSwitchTo, onRestart]);
}

/* ------------------------------------------------------------------ */
/* Diagnostics button (mounted in the control bar area)                */
/* ------------------------------------------------------------------ */

export function DiagnosticsLaunchButton({
  rtl, onClick, quality, isSharing,
}: {
  rtl: boolean;
  onClick: () => void;
  quality: QualityBand;
  isSharing: boolean;
}) {
  const alert = isSharing && (quality === "poor" || quality === "critical");
  return (
    <button
      type="button"
      onClick={onClick}
      title={rtl ? "تشخيص المشاركة" : "Share diagnostics"}
      aria-label={rtl ? "فتح لوحة تشخيص المشاركة" : "Open share diagnostics"}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300",
        alert
          ? "border-red-400/50 bg-red-500/20 text-red-100 animate-pulse"
          : "border-white/15 bg-white/5 text-white/70 hover:text-white hover:bg-white/10",
      )}
    >
      {alert ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
             : <Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
      <span className="hidden md:inline">{rtl ? "تشخيص" : "Diagnostics"}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Perf-mode + res/fps compact selectors used inside the preview UI   */
/* ------------------------------------------------------------------ */

const perfLabels: Record<PerfMode, { en: string; ar: string; hint: string; hintAr: string }> = {
  quality:  { en: "Quality",  ar: "الجودة",     hint: "Highest fidelity, higher bitrate", hintAr: "أعلى وضوح، معدل بت أعلى" },
  balanced: { en: "Balanced", ar: "متوازن",     hint: "Good default for most calls",     hintAr: "الأنسب في أغلب المكالمات" },
  latency:  { en: "Low latency", ar: "زمن استجابة منخفض", hint: "Cuts fps and bitrate for smoothness", hintAr: "يقلل الإطارات والبت لسلاسة أعلى" },
  auto:     { en: "Auto",     ar: "تلقائي",     hint: "Tunes to your connection quality",  hintAr: "يضبط حسب جودة شبكتك" },
};

export function PerfModeSelector({
  rtl, value, onChange,
}: {
  rtl: boolean;
  value: PerfMode;
  onChange: (v: PerfMode) => void;
}) {
  const modes: PerfMode[] = ["auto", "balanced", "quality", "latency"];
  return (
    <div
      className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 p-0.5"
      role="group"
      aria-label={rtl ? "وضع الأداء" : "Performance mode"}
    >
      <Zap className="h-3.5 w-3.5 ml-1 text-amber-300" aria-hidden="true" />
      {modes.map((m) => {
        const l = perfLabels[m];
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            aria-pressed={value === m}
            title={rtl ? l.hintAr : l.hint}
            className={cn(
              "rounded px-2 py-1 text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300",
              value === m ? "bg-amber-500/25 text-amber-100" : "text-white/70 hover:text-white hover:bg-white/10",
            )}
          >
            {rtl ? l.ar : l.en}
          </button>
        );
      })}
    </div>
  );
}

export function ResFpsSelector({
  rtl, res, fps, onChangeRes, onChangeFps,
}: {
  rtl: boolean;
  res: ShareRes;
  fps: ShareFps;
  onChangeRes: (r: ShareRes) => void;
  onChangeFps: (f: ShareFps) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 p-0.5">
      <Wand2 className="h-3.5 w-3.5 ml-1 text-amber-300" aria-hidden="true" />
      {(["720", "1080"] as ShareRes[]).map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChangeRes(r)}
          aria-pressed={res === r}
          title={r === "1080" ? "1920×1080" : "1280×720"}
          className={cn(
            "rounded px-2 py-1 text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300",
            res === r ? "bg-amber-500/25 text-amber-100" : "text-white/70 hover:text-white hover:bg-white/10",
          )}
        >
          {r}p
        </button>
      ))}
      <span className="mx-1 text-white/30">·</span>
      {(["15", "30", "60"] as ShareFps[]).map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => onChangeFps(f)}
          aria-pressed={fps === f}
          title={`${f} fps`}
          className={cn(
            "rounded px-2 py-1 text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300",
            fps === f ? "bg-amber-500/25 text-amber-100" : "text-white/70 hover:text-white hover:bg-white/10",
          )}
        >
          {f}
        </button>
      ))}
    </div>
  );
}

/* re-export unused type to silence tree-shaking noise */
export type { Participant };
