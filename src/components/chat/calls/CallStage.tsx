import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import "@livekit/components-styles";
import {
  LiveKitRoom,
  GridLayout,
  CarouselLayout,
  FocusLayoutContainer,
  FocusLayout,
  ParticipantTile,
  ControlBar,
  RoomAudioRenderer,
  useTracks,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  usePinnedTracks,
  useMaybeTrackRefContext,
  useMaybeLayoutContext,
  LayoutContextProvider,
  useCreateLayoutContext,
} from "@livekit/components-react";
import {
  Track,
  ConnectionState,
  ConnectionQuality,
  VideoPresets,
  VideoQuality,
  ScreenSharePresets,
  RoomEvent,
  createLocalScreenTracks,
  type RoomOptions,
  type LocalTrack,
  type LocalTrackPublication,
  type TrackPublication,
  type Participant,
} from "livekit-client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import {
  Signal, SignalHigh, SignalLow, SignalMedium, WifiOff, Loader2,
  Mic, MicOff, Video as VideoIcon, VideoOff, Pin, PinOff,
  MonitorUp, Keyboard, X, Users, Sparkles, Monitor, AppWindow, Globe,
  Lock, Unlock, Volume2, VolumeX, MonitorPlay, AlertTriangle,
  Gauge, Cpu, Activity, Lightbulb, Zap, Feather, Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PresenterTools } from "./PresenterTools";
import {
  useScreenShareMonitor, ShareQualityBadge, ShareDiagnosticsDialog,
  DiagnosticsLaunchButton, PerfModeSelector, ResFpsSelector,
  useAutoFallback, resolveScreenEncoding,
  readShareRes, readShareFps, readPerfMode,
  LS_SHARE_RES, LS_SHARE_FPS, LS_PERF_MODE,
  type Surface, type ShareRes, type ShareFps, type PerfMode,
} from "./ShareDiagnostics";

/* ------------------------------------------------------------------ */
/*  Persisted preferences (screen-share surface + pinned participant) */
/* ------------------------------------------------------------------ */

type DisplaySurface = "monitor" | "window" | "browser";
const LS_SURFACE = "call.screenShare.displaySurface";
const LS_PIN = "call.pin.identity";
const LS_AUTOSPK = "call.autoSpeakerReorder";
const LS_FOCUSLOCK = "call.focusLock";
const LS_SYSAUDIO = "call.screenShare.systemAudio";
const LS_SYSAUDIO_TRUSTED = "call.screenShare.systemAudio.trusted";

/** Event key used to toggle the participants panel from anywhere in the tree. */
const EVT_TOGGLE_PARTICIPANTS = "call:toggleParticipants";

function readLS(key: string, fallback: string): string {
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    return v ?? fallback;
  } catch { return fallback; }
}
function writeLS(key: string, value: string | null) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* ignore */ }
}

type Props = {
  open: boolean;
  onClose: () => void;
  url: string;
  token: string;
  video: boolean;
  onLeave: () => void;
};

/* ------------------------------------------------------------------ */
/*  Studio-grade participant tile                                     */
/*  – Full aria-label announcing name / mic / cam / screen state      */
/*  – Pin / unpin button in the corner (keyboard-focusable)           */
/*  – High-fidelity avatar fallback when camera is off                */
/* ------------------------------------------------------------------ */

function initialsOf(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

/** Deterministic gradient per identity so each participant gets a stable "studio backdrop". */
function gradientFor(identity: string) {
  let h = 0;
  for (let i = 0; i < identity.length; i++) h = (h * 31 + identity.charCodeAt(i)) >>> 0;
  const h1 = h % 360;
  const h2 = (h1 + 42) % 360;
  return `radial-gradient(circle at 30% 20%, hsl(${h1} 70% 40%) 0%, hsl(${h2} 55% 18%) 55%, #0a0a0a 100%)`;
}

function StudioAvatar({ participant, rtl }: { participant: Participant; rtl: boolean }) {
  const name = participant.name || participant.identity;
  // Attempt to read avatar_url from participant metadata (JSON)
  let avatarUrl: string | undefined;
  try {
    if (participant.metadata) {
      const meta = JSON.parse(participant.metadata);
      if (typeof meta?.avatar_url === "string") avatarUrl = meta.avatar_url;
    }
  } catch { /* ignore */ }

  return (
    <div
      className="absolute inset-0 z-[1] flex items-center justify-center overflow-hidden"
      style={{ background: gradientFor(participant.identity) }}
      aria-hidden="true"
    >
      {/* Subtle studio vignette + grain */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.55)_100%)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="relative z-10 h-[42%] max-h-64 w-[42%] max-w-64 min-h-16 min-w-16 rounded-full object-cover ring-4 ring-white/15 shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : (
        <div
          className="relative z-10 flex h-[42%] max-h-64 w-[42%] max-w-64 min-h-16 min-w-16 items-center justify-center rounded-full bg-white/10 backdrop-blur-md ring-4 ring-white/15 shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
        >
          <span
            className="font-serif font-semibold tracking-wide text-white/95"
            style={{ fontSize: "clamp(1.5rem, 6vw, 4rem)" }}
          >
            {initialsOf(name)}
          </span>
        </div>
      )}
      <div
        className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-xs text-white/85 backdrop-blur-md"
        dir={rtl ? "rtl" : "ltr"}
      >
        {rtl ? "الكاميرا مقفولة" : "Camera off"}
      </div>
    </div>
  );
}

function StudioTile() {
  const trackRef = useMaybeTrackRefContext();
  const layoutCtx = useMaybeLayoutContext();
  const { lang } = useI18n();
  const rtl = lang === "ar";

  if (!trackRef) return <ParticipantTile />;

  const participant = trackRef.participant;
  const source = trackRef.source;
  const isScreen = source === Track.Source.ScreenShare;
  const name = participant.name || participant.identity || (rtl ? "مشارك" : "Participant");
  const isLocal = participant.isLocal;
  const micOn = participant.isMicrophoneEnabled;
  const camOn = participant.isCameraEnabled;
  const isSpeaking = participant.isSpeaking;
  const sharing = participant.isScreenShareEnabled;

  const pinned = usePinnedTracks(layoutCtx ?? undefined) ?? [];
  const isPinned = pinned.some(
    (p) => p.participant.identity === participant.identity && p.source === source
  );

  const togglePin = useCallback(() => {
    if (!layoutCtx) return;
    if (isPinned) {
      layoutCtx.pin.dispatch?.({ msg: "clear_pin" });
      writeLS(LS_PIN, null);
    } else {
      layoutCtx.pin.dispatch?.({ msg: "set_pin", trackReference: trackRef });
      writeLS(LS_PIN, `${participant.identity}::${source}`);
    }
  }, [layoutCtx, isPinned, trackRef, participant.identity, source]);

  const label = rtl
    ? `${name}${isLocal ? " (أنت)" : ""} — ${
        isScreen
          ? "مشاركة شاشة"
          : `الميكروفون ${micOn ? "مفتوح" : "مكتوم"}، الكاميرا ${camOn ? "مفتوحة" : "مقفولة"}${sharing ? "، يشارك الشاشة" : ""}`
      }`
    : `${name}${isLocal ? " (You)" : ""} — ${
        isScreen
          ? "Screen share"
          : `mic ${micOn ? "on" : "muted"}, camera ${camOn ? "on" : "off"}${sharing ? ", sharing screen" : ""}`
      }`;

  const pinLabel = isPinned
    ? rtl ? "إلغاء التثبيت" : "Unpin participant"
    : rtl ? "تثبيت المشارك" : "Pin participant";

  return (
    <div
      role="group"
      aria-label={label}
      aria-roledescription={rtl ? "بلاطة مشارك" : "Participant tile"}
      className={cn(
        "relative h-full w-full",
        isSpeaking && "outline outline-2 outline-emerald-400/70 rounded-lg"
      )}
    >
      <ParticipantTile trackRef={trackRef} className="h-full w-full" />

      {/* Studio-grade avatar overlay when camera is off (camera source only) */}
      {!isScreen && !camOn && (
        <StudioAvatar participant={participant} rtl={rtl} />
      )}

      {/* Pin toggle (keyboard-focusable, aria-labeled) */}
      <button
        type="button"
        onClick={togglePin}
        title={pinLabel}
        aria-label={pinLabel}
        aria-pressed={isPinned}
        className={cn(
          "absolute top-2 z-20 rounded-full border border-white/15 bg-black/55 p-1.5 text-white/85 backdrop-blur-md transition",
          "hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300",
          rtl ? "left-2" : "right-2"
        )}
      >
        {isPinned ? <PinOff className="h-3.5 w-3.5" aria-hidden="true" />
                  : <Pin className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>

      {/* Per-subscriber quality tier (remote tracks only) */}
      {!isLocal && (
        <SubQualityBadge identity={participant.identity} source={source} rtl={rtl} />
      )}
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  Adaptive stage                                                    */
/* ------------------------------------------------------------------ */

function useAutoSpeaker(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => readLS(LS_AUTOSPK, "1") !== "0");
  const set = useCallback((v: boolean) => {
    setOn(v);
    writeLS(LS_AUTOSPK, v ? "1" : "0");
  }, []);
  return [on, set];
}

/**
 * NetworkResilience — reacts to sustained poor local connection quality by
 * (1) dropping the camera capture to 180p and capping the top simulcast layer,
 * (2) muting video entirely if quality stays poor, and
 * (3) auto-restoring higher quality when the link recovers.
 * Runs a single monitor per call; toasts once per state transition.
 */
function NetworkResilience({ rtl }: { rtl: boolean }) {
  const room = useRoomContext();
  const stateRef = useRef<{ level: "ok" | "low" | "audio-only"; since: number }>({
    level: "ok",
    since: Date.now(),
  });

  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    const local = room.localParticipant;

    const apply = async (target: "ok" | "low" | "audio-only") => {
      if (cancelled) return;
      const cur = stateRef.current.level;
      if (cur === target) return;
      stateRef.current = { level: target, since: Date.now() };
      try {
        const camPub = local.getTrackPublication(Track.Source.Camera);
        const camTrack = camPub?.track as LocalTrack | undefined;
        if (target === "audio-only") {
          if (camPub && !camPub.isMuted) await local.setCameraEnabled(false);
          toast.warning(
            rtl
              ? "الشبكة ضعيفة جداً — تم إيقاف الكاميرا تلقائياً للحفاظ على جودة الصوت"
              : "Very weak network — camera auto-disabled to preserve audio",
            { id: "net-resilience" }
          );
        } else if (target === "low") {
          if (camTrack && "restartTrack" in camTrack) {
            try {
              await (camTrack as any).restartTrack({
                resolution: VideoPresets.h180.resolution,
              });
            } catch {}
          }
          if (camPub && camPub.isMuted) await local.setCameraEnabled(true);
          toast.info(
            rtl ? "تم خفض جودة الفيديو تلقائياً لتحسين الاستقرار" : "Video quality lowered automatically for stability",
            { id: "net-resilience" }
          );
        } else {
          // recover
          if (camTrack && "restartTrack" in camTrack) {
            try {
              await (camTrack as any).restartTrack({
                resolution: VideoPresets.h720.resolution,
              });
            } catch {}
          }
          toast.success(
            rtl ? "تحسنت جودة الشبكة — تمت استعادة الجودة العالية" : "Network recovered — high quality restored",
            { id: "net-resilience" }
          );
        }
      } catch {
        /* swallow — best-effort adaptation */
      }
    };

    const onQual = (q: ConnectionQuality, p: Participant) => {
      if (p.identity !== local.identity) return;
      const now = Date.now();
      const st = stateRef.current;
      if (q === ConnectionQuality.Poor || q === ConnectionQuality.Lost) {
        // 4s in Poor → low; 10s continuously poor → audio-only
        if (st.level === "ok") {
          stateRef.current = { level: "ok", since: st.since };
          setTimeout(() => {
            if (!cancelled && stateRef.current.level === "ok") apply("low");
          }, 4000);
        } else if (st.level === "low" && now - st.since > 10_000) {
          apply("audio-only");
        }
      } else if (q === ConnectionQuality.Excellent || q === ConnectionQuality.Good) {
        if (st.level !== "ok" && now - st.since > 8000) apply("ok");
      }
    };

    room.on(RoomEvent.ConnectionQualityChanged, onQual);
    return () => {
      cancelled = true;
      room.off(RoomEvent.ConnectionQualityChanged, onQual);
    };
  }, [room, rtl]);

  return null;
}

/** Restore a previously-pinned participant when their track becomes available. */
function PinRestorer() {
  const layoutCtx = useMaybeLayoutContext();
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: false },
     { source: Track.Source.ScreenShare, withPlaceholder: false }],
    { onlySubscribed: false }
  );
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !layoutCtx) return;
    const saved = readLS(LS_PIN, "");
    if (!saved) return;
    const [identity, srcStr] = saved.split("::");
    const match = tracks.find(
      (t) => t.participant.identity === identity && String(t.source) === srcStr
    );
    if (match) {
      layoutCtx.pin.dispatch?.({ msg: "set_pin", trackReference: match });
      restoredRef.current = true;
    }
  }, [tracks, layoutCtx]);
  return null;
}

function Stage({ autoSpeaker, focusLock }: { autoSpeaker: boolean; focusLock: boolean }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false, updateOnlyOn: [
        RoomEvent.ActiveSpeakersChanged,
        RoomEvent.ParticipantConnected,
        RoomEvent.ParticipantDisconnected,
        RoomEvent.TrackPublished,
        RoomEvent.TrackUnpublished,
        RoomEvent.TrackSubscribed,
        RoomEvent.TrackUnsubscribed,
      ] }
  );

  const screenShareTracks = tracks.filter((t) => t.source === Track.Source.ScreenShare);
  const cameraTracks = tracks.filter((t) => t.source === Track.Source.Camera);

  // Speaker-based ordering — active speakers first, then last-spoke recency, then join order.
  // When focusLock is on, we FREEZE ordering after the first speaker-based sort so tiles stop
  // shuffling around; the active-speaker outline (in StudioTile) still lights up in real time.
  const lockedOrderRef = useRef<string[] | null>(null);
  const lockedFocusRef = useRef<string | null>(null);

  const orderedCamera = useMemo(() => {
    if (!autoSpeaker) {
      lockedOrderRef.current = null;
      return cameraTracks;
    }
    const score = (p: Participant) => {
      const speaking = p.isSpeaking ? 1_000_000_000 : 0;
      const lastSpoke = p.lastSpokeAt ? p.lastSpokeAt.getTime() : 0;
      const joined = p.joinedAt ? -p.joinedAt.getTime() / 1000 : 0;
      return speaking + lastSpoke + joined;
    };
    const sorted = [...cameraTracks].sort((a, b) => score(b.participant) - score(a.participant));

    if (focusLock) {
      // Preserve last order; append any new joiners at the end.
      const prev = lockedOrderRef.current;
      if (!prev) {
        lockedOrderRef.current = sorted.map((t) => t.participant.identity);
        return sorted;
      }
      const byId = new Map(sorted.map((t) => [t.participant.identity, t]));
      const kept = prev.map((id) => byId.get(id)).filter(Boolean) as typeof sorted;
      const added = sorted.filter((t) => !prev.includes(t.participant.identity));
      const merged = [...kept, ...added];
      lockedOrderRef.current = merged.map((t) => t.participant.identity);
      return merged;
    }
    lockedOrderRef.current = null;
    return sorted;
  }, [cameraTracks, autoSpeaker, focusLock]);

  const pinned = usePinnedTracks() ?? [];
  const activeSpeakerTrack = autoSpeaker
    ? orderedCamera.find((t) => t.participant.isSpeaking)
    : undefined;

  // When focusLock is on we keep the SAME participant in the focus slot until unlocked.
  let autoFocus = autoSpeaker && cameraTracks.length > 3 ? activeSpeakerTrack : undefined;
  if (autoSpeaker && focusLock) {
    const currentId = autoFocus?.participant.identity ?? lockedFocusRef.current ?? orderedCamera[0]?.participant.identity ?? null;
    if (currentId) {
      lockedFocusRef.current = currentId;
      autoFocus = orderedCamera.find((t) => t.participant.identity === currentId) ?? autoFocus;
    }
  } else if (!focusLock) {
    lockedFocusRef.current = null;
  }

  const focusTrack = pinned[0] ?? screenShareTracks[0] ?? autoFocus;

  const allOrdered = useMemo(() => {
    return [...screenShareTracks, ...orderedCamera];
  }, [screenShareTracks, orderedCamera]);

  if (focusTrack) {
    const carousel = orderedCamera.length > 0 ? orderedCamera : allOrdered;
    return (
      <FocusLayoutContainer style={{ height: "calc(100% - 128px)" }}>
        <CarouselLayout tracks={carousel}>
          <StudioTile />
        </CarouselLayout>
        <FocusLayout trackRef={focusTrack} />
      </FocusLayoutContainer>
    );
  }

  return (
    <GridLayout tracks={allOrdered} style={{ height: "calc(100% - 128px)" }}>
      <StudioTile />
    </GridLayout>
  );
}

/* ------------------------------------------------------------------ */
/*  Toast announcer with throttling / coalescing                      */
/* ------------------------------------------------------------------ */

function MediaStateAnnouncer({ rtl }: { rtl: boolean }) {
  const room = useRoomContext();
  const seenRef = useRef(false);
  // Per-participant coalescing: one toast per person, showing the LATEST state,
  // debounced by ~2.5s so rapid mic/cam/share flips don't spam the room.
  const pendingRef = useRef<Map<string, any>>(new Map());
  // SR-only live region text. Replaced (not appended) so screen readers
  // always hear the LATEST change without a growing backlog of announcements.
  const [srLine, setSrLine] = useState("");

  useEffect(() => {
    if (!room) return;

    const nameOf = (p: any) => p?.name || p?.identity || (rtl ? "مشارك" : "Participant");
    const whoLabel = (p: any) =>
      p?.identity === room.localParticipant?.identity ? (rtl ? "أنت" : "You") : nameOf(p);

    const schedule = (identity: string, buildLine: () => string, isPositive: boolean) => {
      if (!seenRef.current) return;
      const key = `p-${identity}`;
      const existing = pendingRef.current.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        pendingRef.current.delete(key);
        const line = buildLine();
        (isPositive ? toast.success : toast)(line, { id: key, duration: 3500 });
        // Broadcast to assistive tech (coalesced by the same 2.5s window).
        setSrLine(line);
      }, 2500);
      pendingRef.current.set(key, timer);
    };



    const buildSummary = (participant: any, change: string) => {
      const who = whoLabel(participant);
      const mic = participant?.isMicrophoneEnabled;
      const cam = participant?.isCameraEnabled;
      const share = participant?.isScreenShareEnabled;
      if (rtl) {
        const bits: string[] = [];
        bits.push(`🎙️ ${mic ? "مفتوح" : "مكتوم"}`);
        bits.push(`📷 ${cam ? "مفتوحة" : "مقفولة"}`);
        if (share) bits.push("🖥️ يشارك");
        return `${who} — ${change} · ${bits.join(" · ")}`;
      }
      const bits: string[] = [];
      bits.push(`🎙️ ${mic ? "on" : "muted"}`);
      bits.push(`📷 ${cam ? "on" : "off"}`);
      if (share) bits.push("🖥️ sharing");
      return `${who} — ${change} · ${bits.join(" · ")}`;
    };

    const onMuteChange = (pub: TrackPublication, participant: any, muted: boolean) => {
      const src = pub.source;
      if (src !== Track.Source.Microphone && src !== Track.Source.Camera) return;
      const change = rtl
        ? (src === Track.Source.Microphone
            ? (muted ? "كتم الميكروفون" : "فتح الميكروفون")
            : (muted ? "أغلق الكاميرا" : "فتح الكاميرا"))
        : (src === Track.Source.Microphone
            ? (muted ? "muted mic" : "unmuted mic")
            : (muted ? "camera off" : "camera on"));
      schedule(participant.identity, () => buildSummary(participant, change), !muted);
    };

    const onMuted = (pub: TrackPublication, participant: any) => onMuteChange(pub, participant, true);
    const onUnmuted = (pub: TrackPublication, participant: any) => onMuteChange(pub, participant, false);

    const onShareChange = (pub: TrackPublication, participant: any, started: boolean) => {
      if (pub.source !== Track.Source.ScreenShare) return;
      const change = rtl
        ? (started ? "بدأ مشاركة الشاشة" : "أوقف مشاركة الشاشة")
        : (started ? "started screen share" : "stopped screen share");
      schedule(participant.identity, () => buildSummary(participant, change), started);
    };
    const onPub = (pub: TrackPublication, participant: any) => onShareChange(pub, participant, true);
    const onUnpub = (pub: TrackPublication, participant: any) => onShareChange(pub, participant, false);

    room.on(RoomEvent.TrackMuted, onMuted);
    room.on(RoomEvent.TrackUnmuted, onUnmuted);
    room.on(RoomEvent.TrackPublished, onPub);
    room.on(RoomEvent.LocalTrackPublished, onPub as any);
    room.on(RoomEvent.TrackUnpublished, onUnpub);
    room.on(RoomEvent.LocalTrackUnpublished, onUnpub as any);

    const t = setTimeout(() => { seenRef.current = true; }, 1200);
    return () => {
      clearTimeout(t);
      pendingRef.current.forEach((v) => clearTimeout(v));
      pendingRef.current.clear();
      room.off(RoomEvent.TrackMuted, onMuted);
      room.off(RoomEvent.TrackUnmuted, onUnmuted);
      room.off(RoomEvent.TrackPublished, onPub);
      room.off(RoomEvent.LocalTrackPublished, onPub as any);
      room.off(RoomEvent.TrackUnpublished, onUnpub);
      room.off(RoomEvent.LocalTrackUnpublished, onUnpub as any);
    };
  }, [room, rtl]);

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {srLine}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Network quality badge                                             */
/* ------------------------------------------------------------------ */

function NetworkQualityBadge({ rtl }: { rtl: boolean }) {
  const state = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const quality = localParticipant?.connectionQuality ?? ConnectionQuality.Unknown;

  const lastQualityRef = useRef<ConnectionQuality>(quality);
  useEffect(() => {
    const prev = lastQualityRef.current;
    if (
      (prev === ConnectionQuality.Excellent || prev === ConnectionQuality.Good) &&
      (quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost)
    ) {
      toast.warning(rtl ? "جودة الاتصال ضعفت" : "Connection quality degraded");
    }
    if (
      (prev === ConnectionQuality.Poor || prev === ConnectionQuality.Lost) &&
      (quality === ConnectionQuality.Good || quality === ConnectionQuality.Excellent)
    ) {
      toast.success(rtl ? "الاتصال عاد ممتاز" : "Connection recovered");
    }
    lastQualityRef.current = quality;
  }, [quality, rtl]);

  useEffect(() => {
    if (state === ConnectionState.Reconnecting) {
      toast.loading(rtl ? "جارٍ إعادة الاتصال…" : "Reconnecting…", { id: "lk-reconnect" });
    } else {
      toast.dismiss("lk-reconnect");
    }
  }, [state, rtl]);

  let icon = <Signal className="h-3.5 w-3.5" />;
  let label = rtl ? "غير معروف" : "Unknown";
  let color = "bg-white/10 text-white/80 border-white/15";
  if (state === ConnectionState.Reconnecting) {
    icon = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    label = rtl ? "إعادة الاتصال" : "Reconnecting";
    color = "bg-amber-500/20 text-amber-200 border-amber-400/30";
  } else if (state === ConnectionState.Disconnected) {
    icon = <WifiOff className="h-3.5 w-3.5" />;
    label = rtl ? "غير متصل" : "Disconnected";
    color = "bg-red-500/20 text-red-200 border-red-400/30";
  } else {
    switch (quality) {
      case ConnectionQuality.Excellent:
        icon = <SignalHigh className="h-3.5 w-3.5" />;
        label = rtl ? "ممتاز" : "Excellent";
        color = "bg-emerald-500/20 text-emerald-200 border-emerald-400/30";
        break;
      case ConnectionQuality.Good:
        icon = <SignalMedium className="h-3.5 w-3.5" />;
        label = rtl ? "جيد" : "Good";
        color = "bg-sky-500/20 text-sky-200 border-sky-400/30";
        break;
      case ConnectionQuality.Poor:
        icon = <SignalLow className="h-3.5 w-3.5" />;
        label = rtl ? "ضعيف" : "Poor";
        color = "bg-amber-500/20 text-amber-200 border-amber-400/30";
        break;
      case ConnectionQuality.Lost:
        icon = <WifiOff className="h-3.5 w-3.5" />;
        label = rtl ? "مفقود" : "Lost";
        color = "bg-red-500/20 text-red-200 border-red-400/30";
        break;
    }
  }

  return (
    <div
      className={cn(
        "absolute top-4 left-4 z-20 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-xl shadow-lg",
        color
      )}
      dir={rtl ? "rtl" : "ltr"}
      role="status"
      aria-live="polite"
    >
      {icon}
      <span>{label}</span>
      <span className="opacity-60">·</span>
      <span className="tabular-nums">
        {participants.length} {rtl ? "متصلين" : "on call"}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Local mic + cam status pill                                       */
/* ------------------------------------------------------------------ */

function LocalMediaStatusBadge({ rtl }: { rtl: boolean }) {
  const { localParticipant } = useLocalParticipant();
  const micEnabled = localParticipant?.isMicrophoneEnabled ?? false;
  const camEnabled = localParticipant?.isCameraEnabled ?? false;

  const micLabel = rtl ? (micEnabled ? "الميكروفون مفتوح" : "الميكروفون مكتوم") : micEnabled ? "Microphone on" : "Microphone muted";
  const camLabel = rtl ? (camEnabled ? "الكاميرا مفتوحة" : "الكاميرا مقفولة") : camEnabled ? "Camera on" : "Camera off";

  return (
    <div
      className="absolute top-4 right-4 z-20 flex items-center gap-2 rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur-xl shadow-lg"
      dir={rtl ? "rtl" : "ltr"}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`${micLabel} — ${camLabel}`}
    >
      <span
        className={cn(
          "flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors",
          micEnabled ? "bg-emerald-500/20 text-emerald-200" : "bg-red-500/25 text-red-200"
        )}
        title={micLabel}
        aria-label={micLabel}
      >
        {micEnabled ? <Mic className="h-3.5 w-3.5" aria-hidden="true" /> : <MicOff className="h-3.5 w-3.5" aria-hidden="true" />}
        <span className="hidden sm:inline">{rtl ? (micEnabled ? "مفتوح" : "مكتوم") : micEnabled ? "On" : "Muted"}</span>
      </span>
      <span
        className={cn(
          "flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors",
          camEnabled ? "bg-sky-500/20 text-sky-200" : "bg-white/10 text-white/70"
        )}
        title={camLabel}
        aria-label={camLabel}
      >
        {camEnabled ? <VideoIcon className="h-3.5 w-3.5" aria-hidden="true" /> : <VideoOff className="h-3.5 w-3.5" aria-hidden="true" />}
        <span className="hidden sm:inline">{rtl ? (camEnabled ? "مفتوحة" : "مقفولة") : camEnabled ? "On" : "Off"}</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Screen share with preview                                         */
/*  The browser's native picker handles screen / window / tab choice; */
/*  we then show a preview and only publish on confirm.               */
/* ------------------------------------------------------------------ */

interface ShareController {
  setSurface: (s: DisplaySurface) => void;
  openPicker: () => void;
  isSharing: boolean;
}

function ScreenShareWithPreview({
  rtl,
  bindController,
}: {
  rtl: boolean;
  bindController?: (c: ShareController) => void;
}) {
  const { localParticipant } = useLocalParticipant();
  const [tracks, setTracks] = useState<LocalTrack[] | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [busy, setBusy] = useState(false);
  const isSharing = localParticipant?.isScreenShareEnabled ?? false;
  const [surface, setSurface] = useState<DisplaySurface>(
    () => (readLS(LS_SURFACE, "monitor") as DisplaySurface)
  );
  const [sysAudio, setSysAudio] = useState<boolean>(() => readLS(LS_SYSAUDIO, "1") !== "0");
  const [sourceInfo, setSourceInfo] = useState<{ name: string; surface: string; hasAudio: boolean } | null>(null);
  const [confirmAudioOpen, setConfirmAudioOpen] = useState(false);
  const [trustAudioCk, setTrustAudioCk] = useState(false);

  // Persisted per-call encoding preferences.
  const [res, setRes] = useState<ShareRes>(() => readShareRes());
  const [fps, setFps] = useState<ShareFps>(() => readShareFps());
  const [perfMode, setPerfMode] = useState<PerfMode>(() => readPerfMode());

  const chooseSurface = useCallback((s: DisplaySurface) => {
    setSurface(s);
    writeLS(LS_SURFACE, s);
  }, []);
  const chooseRes = useCallback((r: ShareRes) => { setRes(r); writeLS(LS_SHARE_RES, r); }, []);
  const chooseFps = useCallback((f: ShareFps) => { setFps(f); writeLS(LS_SHARE_FPS, f); }, []);
  const choosePerf = useCallback((m: PerfMode) => { setPerfMode(m); writeLS(LS_PERF_MODE, m); }, []);

  /** Direct setter — no confirmation. Used after the user acknowledges. */
  const commitSysAudio = useCallback((v: boolean) => {
    setSysAudio(v);
    writeLS(LS_SYSAUDIO, v ? "1" : "0");
  }, []);

  const requestSysAudioToggle = useCallback((next: boolean) => {
    if (!next) {
      commitSysAudio(false);
      return;
    }
    const trusted = readLS(LS_SYSAUDIO_TRUSTED, "0") === "1";
    if (trusted) {
      commitSysAudio(true);
      toast.warning(
        rtl ? "تم تفعيل صوت النظام — أي شيء يعمل على جهازك سيُنشر مع المشاركة."
            : "System audio enabled — anything playing on this device will be published with the share.",
        { duration: 4500 }
      );
      return;
    }
    setTrustAudioCk(false);
    setConfirmAudioOpen(true);
  }, [commitSysAudio, rtl]);

  const cleanup = useCallback(() => {
    tracks?.forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    setTracks(null);
    setSourceInfo(null);
  }, [tracks]);

  const openPicker = useCallback(async () => {
    if (isSharing) {
      try { await localParticipant?.setScreenShareEnabled(false); } catch { /* ignore */ }
      return;
    }
    setBusy(true);
    try {
      const enc = resolveScreenEncoding(res, fps, perfMode);
      const videoConstraint = {
        displaySurface: surface,
        frameRate: { ideal: enc.frameRate, max: enc.frameRate },
      } as unknown as MediaTrackConstraints;
      const created = await createLocalScreenTracks({
        audio: sysAudio,
        resolution: { width: enc.width, height: enc.height, frameRate: enc.frameRate },
        video: videoConstraint as any,
      } as any);
      const vTrack = created.find((t) => t.kind === Track.Kind.Video);
      const aTrack = created.find((t) => t.kind === Track.Kind.Audio);
      const mst = vTrack?.mediaStreamTrack;
      const settings: any = mst?.getSettings?.() ?? {};
      const actualSurface: string = settings.displaySurface ?? surface;
      const surfaceLabel = actualSurface === "monitor"
        ? (rtl ? "شاشة كاملة" : "Entire screen")
        : actualSurface === "window"
        ? (rtl ? "نافذة تطبيق" : "Application window")
        : (rtl ? "تبويب متصفح" : "Browser tab");
      const name = mst?.label || surfaceLabel;
      setSourceInfo({ name, surface: surfaceLabel, hasAudio: !!aTrack });
      setTracks(created);
    } catch (e: any) {
      if (e?.name !== "AbortError" && e?.name !== "NotAllowedError") {
        toast.error(rtl ? `تعذّر بدء المشاركة: ${e?.message ?? ""}` : `Could not start share: ${e?.message ?? ""}`);
      }
    } finally {
      setBusy(false);
    }
  }, [isSharing, localParticipant, rtl, surface, sysAudio, res, fps, perfMode]);

  // Expose imperative controller for auto-fallback.
  useEffect(() => {
    bindController?.({ setSurface: chooseSurface, openPicker: () => { void openPicker(); }, isSharing });
  }, [bindController, chooseSurface, openPicker, isSharing]);

  useEffect(() => {
    if (!tracks || !videoRef.current) return;
    const videoTrack = tracks.find((t) => t.kind === Track.Kind.Video);
    if (videoTrack?.mediaStreamTrack) {
      videoRef.current.srcObject = new MediaStream([videoTrack.mediaStreamTrack]);
      videoRef.current.play().catch(() => {});
    }
  }, [tracks]);

  const confirm = useCallback(async () => {
    if (!tracks || !localParticipant) return;
    try {
      const enc = resolveScreenEncoding(res, fps, perfMode);
      for (const track of tracks) {
        if (track.kind === Track.Kind.Video) {
          await localParticipant.publishTrack(track, {
            source: Track.Source.ScreenShare,
            screenShareEncoding: {
              maxBitrate: enc.maxBitrate,
              maxFramerate: enc.maxFramerate,
              priority: "high",
            } as any,
            simulcast: enc.simulcast,
            degradationPreference: enc.degradationPreference as any,
            videoCodec: "vp9",
          } as any);
        } else {
          await localParticipant.publishTrack(track, {
            source: Track.Source.ScreenShareAudio,
          } as any);
        }
      }
      setTracks(null);
      setSourceInfo(null);
      toast.success(
        rtl
          ? `بدأت المشاركة (${res}p @ ${fps}fps · ${perfMode})`
          : `Sharing started (${res}p @ ${fps}fps · ${perfMode})`
      );
    } catch (e: any) {
      cleanup();
      toast.error(rtl ? `فشل نشر المشاركة: ${e?.message ?? ""}` : `Publish failed: ${e?.message ?? ""}`);
    }
  }, [tracks, localParticipant, rtl, cleanup, res, fps, perfMode]);

  const cancel = useCallback(() => cleanup(), [cleanup]);

  // Keyboard: Enter to confirm, Esc handled natively by Dialog
  useEffect(() => {
    if (!tracks) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        confirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tracks, confirm]);

  const surfaces: Array<{ id: DisplaySurface; icon: any; label: string }> = [
    { id: "monitor", icon: Monitor,   label: rtl ? "شاشة كاملة" : "Full screen" },
    { id: "window",  icon: AppWindow, label: rtl ? "نافذة" : "Window" },
    { id: "browser", icon: Globe,     label: rtl ? "تبويب" : "Tab" },
  ];

  return (
    <>
      <div className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 p-0.5" role="group" aria-label={rtl ? "نوع مشاركة الشاشة" : "Screen share source"}>
        {surfaces.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => chooseSurface(id)}
            aria-pressed={surface === id}
            title={label}
            aria-label={label}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1 text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300",
              surface === id ? "bg-amber-500/25 text-amber-100" : "text-white/70 hover:text-white hover:bg-white/10"
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden md:inline">{label}</span>
          </button>
        ))}
      </div>

      <ResFpsSelector rtl={rtl} res={res} fps={fps} onChangeRes={chooseRes} onChangeFps={chooseFps} />
      <PerfModeSelector rtl={rtl} value={perfMode} onChange={choosePerf} />

      <button
        type="button"
        onClick={() => requestSysAudioToggle(!sysAudio)}
        aria-pressed={sysAudio}
        title={sysAudio ? (rtl ? "صوت النظام: مفعّل" : "System audio: on") : (rtl ? "صوت النظام: متوقف" : "System audio: off")}
        aria-label={sysAudio ? (rtl ? "صوت النظام مفعّل" : "System audio on") : (rtl ? "صوت النظام متوقف" : "System audio off")}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300",
          sysAudio ? "border-amber-400/40 bg-amber-500/20 text-amber-100" : "border-white/15 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
        )}
      >
        {sysAudio ? <Volume2 className="h-3.5 w-3.5" aria-hidden="true" /> : <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />}
        <span className="hidden md:inline">{rtl ? "صوت النظام" : "System audio"}</span>
      </button>

      <button
        type="button"
        onClick={openPicker}
        disabled={busy}
        title={isSharing
          ? (rtl ? "إيقاف مشاركة الشاشة" : "Stop screen share")
          : (rtl ? "مشاركة الشاشة (مع معاينة)" : "Share screen (with preview)")}
        aria-label={isSharing
          ? (rtl ? "إيقاف مشاركة الشاشة" : "Stop screen share")
          : (rtl ? "مشاركة الشاشة مع معاينة" : "Share screen with preview")}
        aria-pressed={isSharing}
        className={cn(
          "lk-button inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300",
          isSharing
            ? "bg-red-500/20 text-red-100 hover:bg-red-500/30 border border-red-400/30"
            : "bg-white/10 text-white hover:bg-white/20 border border-white/15"
        )}
      >
        <MonitorUp className="h-4 w-4" aria-hidden="true" />
        <span>{isSharing ? (rtl ? "إيقاف المشاركة" : "Stop share") : (rtl ? "مشاركة شاشة" : "Share screen")}</span>
      </button>

      {/* Full-screen preview overlay before publishing */}
      <Dialog open={!!tracks} onOpenChange={(o) => { if (!o) cancel(); }}>
        <DialogContent
          className="max-w-none w-screen h-[100dvh] rounded-none bg-black text-white border-0 p-0 flex flex-col"
          dir={rtl ? "rtl" : "ltr"}
        >
          <DialogHeader className="px-6 pt-5 pb-2">
            <DialogTitle className="text-lg flex items-center gap-2">
              <MonitorPlay className="h-5 w-5 text-amber-300" aria-hidden="true" />
              {rtl ? "معاينة مشاركة الشاشة" : "Screen share preview"}
            </DialogTitle>
            <DialogDescription className="text-white/60">
              {rtl
                ? `سيتم النشر بجودة ${res}p @ ${fps}fps — وضع «${perfMode}». راجع المصدر واضغط «بدء» للتأكيد.`
                : `Will publish at ${res}p @ ${fps}fps — “${perfMode}” mode. Review the source and confirm to start.`}
            </DialogDescription>
            {sourceInfo && (
              <div
                className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm"
                role="status"
                aria-live="polite"
              >
                <span className="text-white/60">{rtl ? "المصدر:" : "Source:"}</span>
                <span className="font-semibold text-amber-100 truncate max-w-[60vw]" title={sourceInfo.name}>
                  {sourceInfo.name}
                </span>
                <span className="opacity-40">·</span>
                <span className="text-white/75">{sourceInfo.surface}</span>
                <span className="opacity-40">·</span>
                <span className={cn("inline-flex items-center gap-1", sourceInfo.hasAudio ? "text-emerald-200" : "text-white/60")}>
                  {sourceInfo.hasAudio ? <Volume2 className="h-3.5 w-3.5" aria-hidden="true" /> : <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />}
                  {sourceInfo.hasAudio ? (rtl ? "مع صوت النظام" : "with system audio") : (rtl ? "بدون صوت" : "no audio")}
                </span>
              </div>
            )}
            {sourceInfo?.hasAudio && (
              <div
                className="mt-2 flex items-start gap-2 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-100"
                role="alert"
              >
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <div className="font-semibold">
                    {rtl ? "تنبيه: صوت النظام سيُنشر" : "Warning: system audio will be published"}
                  </div>
                  <div className="text-red-200/80">
                    {rtl
                      ? "أي صوت يعمل على جهازك (موسيقى، إشعارات، مكالمات) سيسمعه باقي المشاركين. لإيقاف الصوت، ألغِ الآن، عطّل «صوت النظام»، وأعد المحاولة."
                      : "Anything playing on this device (music, notifications, other calls) will be audible to everyone. To silence it, cancel, disable “System audio”, then try again."}
                  </div>
                </div>
              </div>
            )}
          </DialogHeader>
          <div className="flex-1 min-h-0 bg-black flex items-center justify-center px-6">
            <video
              ref={videoRef}
              className="h-full w-full object-contain rounded-lg ring-1 ring-white/10 shadow-[0_20px_80px_rgba(0,0,0,0.6)]"
              muted
              playsInline
              aria-label={rtl ? "معاينة الشاشة" : "Screen preview"}
            />
          </div>
          <DialogFooter className="gap-2 px-6 py-5 border-t border-white/10">
            <Button variant="secondary" onClick={cancel}>
              <X className="h-4 w-4 mr-1" aria-hidden="true" />
              {rtl ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={confirm}
              className="bg-amber-500 hover:bg-amber-400 text-black font-semibold"
            >
              <MonitorUp className="h-4 w-4 mr-1" aria-hidden="true" />
              {rtl ? "تأكيد وبدء المشاركة" : "Confirm & start sharing"}
              <kbd className="ml-2 rounded border border-black/30 bg-black/10 px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* System-audio confirmation — one-time (or per-toggle if not trusted) */}
      <AlertDialog open={confirmAudioOpen} onOpenChange={setConfirmAudioOpen}>
        <AlertDialogContent dir={rtl ? "rtl" : "ltr"} className="border-amber-400/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" aria-hidden="true" />
              {rtl ? "تفعيل صوت النظام أثناء المشاركة؟" : "Enable system audio while sharing?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                {rtl
                  ? "لو فعّلت هذا الخيار، أي شيء بيتشغّل على جهازك — موسيقى، فيديو، إشعارات، مكالمة تانية — هيسمعه كل المشاركين معاك."
                  : "If you turn this on, everything playing on this device — music, videos, notifications, other calls — will be published to every participant."}
              </span>
              <span className="block text-amber-700 dark:text-amber-300 font-medium">
                {rtl
                  ? "متأكد إنك عايز تنشر صوت النظام؟"
                  : "Are you sure you want to publish system audio?"}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-sm text-muted-foreground select-none cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border accent-amber-500"
              checked={trustAudioCk}
              onChange={(e) => setTrustAudioCk(e.target.checked)}
            />
            {rtl ? "افهم المخاطر — لا تسألني مرة أخرى على هذا الجهاز" : "I understand — don’t ask again on this device"}
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>{rtl ? "إلغاء" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500 hover:bg-amber-400 text-black"
              onClick={() => {
                if (trustAudioCk) writeLS(LS_SYSAUDIO_TRUSTED, "1");
                commitSysAudio(true);
                toast.warning(
                  rtl ? "تم تفعيل صوت النظام — كل ما يعمل على جهازك سيُنشر."
                      : "System audio enabled — anything playing on this device will be published.",
                  { duration: 4500 }
                );
              }}
            >
              {rtl ? "تفعيل ونشر الصوت" : "Enable & publish audio"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Keyboard shortcuts + help legend                                  */
/* ------------------------------------------------------------------ */

function KeyboardShortcuts({
  rtl,
  autoSpeaker, setAutoSpeaker,
  focusLock, setFocusLock,
}: {
  rtl: boolean;
  autoSpeaker: boolean;
  setAutoSpeaker: (v: boolean) => void;
  focusLock: boolean;
  setFocusLock: (v: boolean) => void;
}) {
  const room = useRoomContext();
  const layoutCtx = useMaybeLayoutContext();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (!room) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const lp = room.localParticipant;
      const key = e.key.toLowerCase();
      if (key === "m") {
        e.preventDefault();
        lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled);
      } else if (key === "v") {
        e.preventDefault();
        lp.setCameraEnabled(!lp.isCameraEnabled);
      } else if (key === "s") {
        e.preventDefault();
        lp.setScreenShareEnabled(!lp.isScreenShareEnabled).catch(() => {});
      } else if (key === "p") {
        e.preventDefault();
        if (layoutCtx?.pin.state && layoutCtx.pin.state.length > 0) {
          layoutCtx.pin.dispatch?.({ msg: "clear_pin" });
        }
      } else if (key === "l") {
        e.preventDefault();
        setAutoSpeaker(!autoSpeaker);
      } else if (key === "f") {
        e.preventDefault();
        if (autoSpeaker) setFocusLock(!focusLock);
        else toast(rtl ? "فعّل ترتيب المتحدث أولًا (L)" : "Enable speaker sort first (L)");
      } else if (key === "u") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(EVT_TOGGLE_PARTICIPANTS));
      } else if (key === "?" || (e.shiftKey && key === "/")) {
        e.preventDefault();
        setHelpOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [room, layoutCtx, autoSpeaker, focusLock, setAutoSpeaker, setFocusLock, rtl]);

  const rows: Array<[string, string]> = useMemo(() => rtl ? [
    ["M", "كتم/فتح الميكروفون"],
    ["V", "تشغيل/إيقاف الكاميرا"],
    ["S", "بدء/إيقاف مشاركة الشاشة"],
    ["P", "إلغاء تثبيت المشارك"],
    ["L", "تفعيل/إيقاف ترتيب المتحدث"],
    ["F", "قفل التركيز على المتحدث الحالي"],
    ["U", "فتح/إغلاق قائمة المشاركين"],
    ["?", "عرض/إخفاء هذه القائمة"],
    ["Esc", "إغلاق النوافذ"],
  ] : [
    ["M", "Mute / unmute mic"],
    ["V", "Camera on / off"],
    ["S", "Start / stop screen share"],
    ["P", "Clear pinned participant"],
    ["L", "Toggle speaker-based auto reorder"],
    ["F", "Lock focus on current speaker"],
    ["U", "Open / close participants panel"],
    ["?", "Show / hide shortcuts"],
    ["Esc", "Close dialogs"],
  ], [rtl]);


  return (
    <>
      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        aria-label={rtl ? "اختصارات لوحة المفاتيح" : "Keyboard shortcuts"}
        title={rtl ? "اختصارات (?)" : "Shortcuts (?)"}
        className={cn(
          "absolute bottom-24 z-20 rounded-full border border-white/15 bg-black/55 p-2 text-white/85 backdrop-blur-md",
          "hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300",
          rtl ? "left-4" : "right-4"
        )}
      >
        <Keyboard className="h-4 w-4" aria-hidden="true" />
      </button>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-md bg-neutral-950 text-white border-white/10" dir={rtl ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{rtl ? "اختصارات لوحة المفاتيح" : "Keyboard shortcuts"}</DialogTitle>
          </DialogHeader>
          <ul className="divide-y divide-white/10">
            {rows.map(([k, desc]) => (
              <li key={k} className="flex items-center justify-between py-2 text-sm">
                <span className="text-white/80">{desc}</span>
                <kbd className="rounded border border-white/20 bg-white/10 px-2 py-0.5 font-mono text-xs">{k}</kbd>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Live participant count badge + clickable participants panel       */
/* ------------------------------------------------------------------ */

function ParticipantRow({ p, rtl }: { p: Participant; rtl: boolean }) {
  const name = p.name || p.identity || (rtl ? "مشارك" : "Participant");
  const isLocal = p.isLocal;
  const mic = p.isMicrophoneEnabled;
  const cam = p.isCameraEnabled;
  const share = p.isScreenShareEnabled;
  const speaking = p.isSpeaking;
  let avatarUrl: string | undefined;
  try {
    if (p.metadata) {
      const meta = JSON.parse(p.metadata);
      if (typeof meta?.avatar_url === "string") avatarUrl = meta.avatar_url;
    }
  } catch { /* ignore */ }

  return (
    <li
      tabIndex={0}
      role="option"
      data-participant-row
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2 transition",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950",
        speaking ? "border-emerald-400/40 bg-emerald-500/10" : "border-white/10 bg-white/[0.03]"
      )}
      aria-label={`${name}${isLocal ? (rtl ? " (أنت)" : " (You)") : ""} — ${mic ? (rtl ? "الميكروفون مفتوح" : "mic on") : (rtl ? "الميكروفون مكتوم" : "mic off")}, ${cam ? (rtl ? "الكاميرا مفتوحة" : "camera on") : (rtl ? "الكاميرا مقفولة" : "camera off")}${share ? (rtl ? "، يشارك الشاشة" : ", sharing screen") : ""}`}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-white/15" loading="lazy" />
      ) : (
        <div className="h-9 w-9 rounded-full bg-white/10 ring-1 ring-white/15 flex items-center justify-center text-xs font-semibold text-white/85">
          {initialsOf(name)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-white">
          {name}
          {isLocal && (
            <span className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-100 align-middle">
              {rtl ? "أنت" : "You"}
            </span>
          )}
        </div>
        <div className="text-[11px] text-white/60 truncate">{p.identity}</div>
      </div>
      <div className="flex items-center gap-1.5" aria-hidden="true">
        <span className={cn("rounded-full p-1", mic ? "bg-emerald-500/20 text-emerald-200" : "bg-red-500/25 text-red-200")}>
          {mic ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
        </span>
        <span className={cn("rounded-full p-1", cam ? "bg-sky-500/20 text-sky-200" : "bg-white/10 text-white/60")}>
          {cam ? <VideoIcon className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
        </span>
        {share && (
          <span className="rounded-full p-1 bg-amber-500/25 text-amber-100" title={rtl ? "يشارك الشاشة" : "sharing screen"}>
            <MonitorUp className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
    </li>
  );
}

function ParticipantCountBadge({ rtl }: { rtl: boolean }) {
  const participants = useParticipants(); // reactive to join/leave for everyone
  const count = participants.length;
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const label = rtl
    ? `${count} في المكالمة — اضغط للتفاصيل (U)`
    : `${count} in call — click for details (U)`;

  // sr-only live region text: announces join/leave transitions politely.
  const prevCountRef = useRef(count);
  const [srCount, setSrCount] = useState("");
  useEffect(() => {
    const prev = prevCountRef.current;
    if (count !== prev) {
      const delta = count - prev;
      setSrCount(
        rtl
          ? (delta > 0
              ? `انضم مشارك — الآن ${count} في المكالمة`
              : `غادر مشارك — الآن ${count} في المكالمة`)
          : (delta > 0
              ? `A participant joined — ${count} now in the call`
              : `A participant left — ${count} now in the call`)
      );
      prevCountRef.current = count;
    }
  }, [count, rtl]);

  const sorted = useMemo(() => {
    return [...participants].sort((a, b) => {
      if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
      const ja = a.joinedAt?.getTime() ?? 0;
      const jb = b.joinedAt?.getTime() ?? 0;
      return ja - jb;
    });
  }, [participants]);

  // Global keyboard shortcut ("U") + programmatic toggle from KeyboardShortcuts.
  useEffect(() => {
    const onToggle = () => setOpen((o) => !o);
    window.addEventListener(EVT_TOGGLE_PARTICIPANTS, onToggle);
    return () => window.removeEventListener(EVT_TOGGLE_PARTICIPANTS, onToggle);
  }, []);

  // When the panel opens, move focus to the first row so the user can
  // navigate the list immediately with the keyboard.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const first = listRef.current?.querySelector<HTMLElement>("[data-participant-row]");
      first?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [open, sorted.length]);

  // Arrow-key navigation inside the list.
  const onListKeyDown: React.KeyboardEventHandler<HTMLUListElement> = (e) => {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-participant-row]") ?? []
    );
    if (rows.length === 0) return;
    const idx = rows.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = Math.min(rows.length - 1, idx + 1);
    else if (e.key === "ArrowUp") next = Math.max(0, idx - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = rows.length - 1;
    else return;
    e.preventDefault();
    rows[next < 0 ? 0 : next]?.focus();
  };

  return (
    <>
      {/* SR-only live region: participant count transitions */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {srCount}
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "absolute top-16 z-20 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-black/55 px-3 py-1.5 text-xs font-semibold text-amber-100 backdrop-blur-xl shadow-lg",
          "hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 transition",
          rtl ? "right-4" : "left-4"
        )}
        dir={rtl ? "rtl" : "ltr"}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="u"
        title={label}
      >
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="tabular-nums">{count}</span>
        <span className="opacity-75">{rtl ? "في المكالمة" : "in call"}</span>
        <kbd className="ml-1 rounded border border-white/20 bg-white/10 px-1 py-0 font-mono text-[9px] text-white/80">U</kbd>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={rtl ? "left" : "right"}
          className="bg-neutral-950 text-white border-white/10 w-[92vw] sm:w-[420px]"
          dir={rtl ? "rtl" : "ltr"}
        >
          <SheetHeader>
            <SheetTitle className="text-white flex items-center gap-2">
              <Users className="h-4 w-4 text-amber-300" aria-hidden="true" />
              {rtl ? `المشاركون (${count})` : `Participants (${count})`}
            </SheetTitle>
            <SheetDescription className="text-white/60">
              {rtl
                ? "استخدم الأسهم للتنقّل، U للإغلاق. حالة الميكروفون والكاميرا والمشاركة محدَّثة لحظيًا."
                : "Use ↑/↓ to navigate, U to close. Mic, camera and share state update in real time."}
            </SheetDescription>
          </SheetHeader>
          <ul
            ref={listRef}
            onKeyDown={onListKeyDown}
            className="mt-4 space-y-2 max-h-[calc(100dvh-140px)] overflow-y-auto pr-1 focus:outline-none"
            role="listbox"
            aria-label={rtl ? "قائمة المشاركين" : "Participants list"}
            aria-activedescendant={undefined}
            tabIndex={-1}
          >
            {sorted.map((p) => (
              <ParticipantRow key={p.identity} p={p} rtl={rtl} />
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Auto speaker-reorder toggle + focus lock                          */
/* ------------------------------------------------------------------ */

/**
 * Persisted user preference for the "lock focus on current speaker" toggle.
 * Returns `[on, set, setTransient]`:
 *  - `set` updates state AND writes to localStorage (user intent)
 *  - `setTransient` updates only in-memory state (used for runtime guards
 *    such as "auto-off while speaker sort is disabled") so the saved
 *    preference is restored automatically on the next call.
 */
function useFocusLock(): [boolean, (v: boolean) => void, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => readLS(LS_FOCUSLOCK, "0") === "1");
  const set = useCallback((v: boolean) => {
    setOn(v);
    writeLS(LS_FOCUSLOCK, v ? "1" : "0");
  }, []);
  const setTransient = useCallback((v: boolean) => setOn(v), []);
  return [on, set, setTransient];
}

function AutoSpeakerToggle({ rtl, on, setOn }: { rtl: boolean; on: boolean; setOn: (v: boolean) => void }) {
  const label = rtl
    ? (on ? "ترتيب حسب المتحدث: مفعّل (L)" : "ترتيب حسب المتحدث: متوقف (L)")
    : (on ? "Speaker sort: on (L)" : "Speaker sort: off (L)");
  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={cn(
        "absolute bottom-24 z-20 rounded-full border p-2 backdrop-blur-md transition",
        "hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300",
        on
          ? "border-amber-400/40 bg-amber-500/20 text-amber-100"
          : "border-white/15 bg-black/55 text-white/80",
        rtl ? "left-16" : "right-16"
      )}
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function FocusLockToggle({ rtl, on, setOn, disabled }: { rtl: boolean; on: boolean; setOn: (v: boolean) => void; disabled: boolean }) {
  const label = disabled
    ? (rtl ? "قفل التركيز يتطلب تفعيل ترتيب المتحدث" : "Focus lock requires speaker sort")
    : rtl
    ? (on ? "قفل التركيز على المتحدث الحالي: مفعّل (F)" : "قفل التركيز على المتحدث الحالي: متوقف (F)")
    : (on ? "Lock focus on current speaker: on (F)" : "Lock focus on current speaker: off (F)");
  return (
    <button
      type="button"
      onClick={() => !disabled && setOn(!on)}
      aria-pressed={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "absolute bottom-24 z-20 rounded-full border p-2 backdrop-blur-md transition",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300",
        disabled && "opacity-40 cursor-not-allowed",
        !disabled && "hover:bg-black/75",
        on
          ? "border-amber-400/40 bg-amber-500/20 text-amber-100"
          : "border-white/15 bg-black/55 text-white/80",
        rtl ? "left-28" : "right-28"
      )}
    >
      {on ? <Lock className="h-4 w-4" aria-hidden="true" /> : <Unlock className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Call-wide performance preference (Auto / Lite / Balanced)         */
/* ------------------------------------------------------------------ */

const LS_CALL_PERF = "call.perfPref"; // "auto" | "lite" | "balanced"
type CallPerfPref = "auto" | "lite" | "balanced";

function readCallPerf(): CallPerfPref {
  const v = readLS(LS_CALL_PERF, "auto");
  return v === "lite" || v === "balanced" ? v : "auto";
}
function useCallPerf(): [CallPerfPref, (v: CallPerfPref) => void] {
  const [v, setV] = useState<CallPerfPref>(() => readCallPerf());
  const set = useCallback((n: CallPerfPref) => {
    setV(n);
    writeLS(LS_CALL_PERF, n);
  }, []);
  return [v, set];
}

function CallPerfSelector({ rtl, value, onChange }: {
  rtl: boolean; value: CallPerfPref; onChange: (v: CallPerfPref) => void;
}) {
  const opts: Array<{ id: CallPerfPref; icon: any; label: string; hint: string }> = [
    { id: "auto",     icon: Wand2,   label: rtl ? "تلقائي" : "Auto",     hint: rtl ? "يقرر حسب شبكتك وجهازك" : "Adapts to network & device" },
    { id: "lite",     icon: Feather, label: rtl ? "خفيف" : "Lite",       hint: rtl ? "أقل استهلاك وأسلس" : "Lowest CPU/bandwidth" },
    { id: "balanced", icon: Zap,     label: rtl ? "متوازن" : "Balanced", hint: rtl ? "جودة وأداء معًا" : "Quality + performance" },
  ];
  return (
    <div
      className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 p-0.5"
      role="radiogroup"
      aria-label={rtl ? "وضع أداء المكالمة" : "Call performance mode"}
    >
      {opts.map(({ id, icon: Icon, label, hint }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(id)}
            title={hint}
            aria-label={`${label} — ${hint}`}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1 text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300",
              active ? "bg-amber-500/25 text-amber-100" : "text-white/70 hover:text-white hover:bg-white/10"
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden md:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * AutoBitrateCap — when local connection quality drops to Poor/Lost we
 * publish only the LOW simulcast layer on every video/screen-share track
 * (huge bandwidth save, no reconnect), then restore on recovery.
 */
function AutoBitrateCap({ rtl }: { rtl: boolean }) {
  const room = useRoomContext();
  const cappedRef = useRef(false);

  useEffect(() => {
    if (!room) return;
    const local = room.localParticipant;

    const applyMaxQuality = (max: VideoQuality) => {
      const pubs = Array.from(local.trackPublications.values());
      for (const pub of pubs) {
        if (pub.kind !== Track.Kind.Video) continue;
        const t: any = (pub as LocalTrackPublication).track;
        try { t?.setPublishingQuality?.(max); } catch { /* ignore */ }
      }
    };

    const cap = () => {
      if (cappedRef.current) return;
      cappedRef.current = true;
      applyMaxQuality(VideoQuality.LOW);
      toast.info(
        rtl ? "تم تقليل بترييت الفيديو تلقائياً بسبب ضعف الشبكة" : "Video bitrate auto-capped for weak network",
        { id: "auto-bitrate-cap" }
      );
    };
    const uncap = () => {
      if (!cappedRef.current) return;
      cappedRef.current = false;
      applyMaxQuality(VideoQuality.HIGH);
      toast.success(
        rtl ? "استعادة البترييت الكامل — الشبكة تحسنت" : "Full bitrate restored — network recovered",
        { id: "auto-bitrate-cap" }
      );
    };

    const onQual = (q: ConnectionQuality, p: Participant) => {
      if (p.identity !== local.identity) return;
      if (q === ConnectionQuality.Poor || q === ConnectionQuality.Lost) cap();
      else if (q === ConnectionQuality.Good || q === ConnectionQuality.Excellent) uncap();
    };
    room.on(RoomEvent.ConnectionQualityChanged, onQual);
    return () => { room.off(RoomEvent.ConnectionQualityChanged, onQual); };
  }, [room, rtl]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  Per-subscriber quality store (camera vs screen-share, per peer)   */
/* ------------------------------------------------------------------ */

export type SubQualityTier = "LOW" | "BALANCED" | "HIGH";

const tierOf = (q: VideoQuality): SubQualityTier =>
  q === VideoQuality.LOW ? "LOW" : q === VideoQuality.MEDIUM ? "BALANCED" : "HIGH";

const subQualityStore = (() => {
  const map = new Map<string, SubQualityTier>(); // key = `${identity}::${source}`
  const listeners = new Set<() => void>();
  let snap: Record<string, SubQualityTier> = {};
  const rebuild = () => {
    const o: Record<string, SubQualityTier> = {};
    map.forEach((v, k) => { o[k] = v; });
    snap = o;
  };
  return {
    key(identity: string, source: Track.Source) { return `${identity}::${source}`; },
    set(identity: string, source: Track.Source, tier: SubQualityTier) {
      const k = `${identity}::${source}`;
      if (map.get(k) === tier) return;
      map.set(k, tier);
      rebuild();
      listeners.forEach((l) => l());
    },
    clear(identity: string) {
      let changed = false;
      for (const k of Array.from(map.keys())) {
        if (k.startsWith(identity + "::")) { map.delete(k); changed = true; }
      }
      if (changed) { rebuild(); listeners.forEach((l) => l()); }
    },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    getSnapshot() { return snap; },
  };
})();

function useSubQuality(identity: string, source: Track.Source): SubQualityTier | undefined {
  const snap = useSyncExternalStore(subQualityStore.subscribe, subQualityStore.getSnapshot, subQualityStore.getSnapshot);
  return snap[subQualityStore.key(identity, source)];
}

/**
 * SubscriberQualityAdaptor — per-subscriber, per-source degradation.
 *
 * When THIS client's connection quality drops we ask the SFU to send us a
 * lighter simulcast layer, with an independent policy for camera vs
 * screen-share so shared slides/code stay readable while faces shrink:
 *
 *   Excellent/Good → camera HIGH,     screen HIGH
 *   Poor           → camera LOW,      screen BALANCED  (readability wins)
 *   Lost           → camera LOW,      screen LOW
 *
 * This is a pure receive-side signal (RemoteTrackPublication.setVideoQuality)
 * so strong peers keep getting HIGH from the same publishers. Per-track state
 * is published to `subQualityStore` for the tile badges.
 */
function SubscriberQualityAdaptor({ rtl }: { rtl: boolean }) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const quality = localParticipant?.connectionQuality ?? ConnectionQuality.Unknown;

  const policyRef = useRef<{ cam: VideoQuality; screen: VideoQuality }>({
    cam: VideoQuality.HIGH, screen: VideoQuality.HIGH,
  });

  const policyFor = useCallback((q: ConnectionQuality) => {
    if (q === ConnectionQuality.Lost)  return { cam: VideoQuality.LOW,  screen: VideoQuality.LOW };
    if (q === ConnectionQuality.Poor)  return { cam: VideoQuality.LOW,  screen: VideoQuality.MEDIUM };
    return { cam: VideoQuality.HIGH, screen: VideoQuality.HIGH };
  }, []);

  const applyToPub = useCallback((rpIdentity: string, pub: any) => {
    if (!pub || pub.kind !== Track.Kind.Video) return;
    const isScreen = pub.source === Track.Source.ScreenShare;
    const target = isScreen ? policyRef.current.screen : policyRef.current.cam;
    try { pub.setVideoQuality?.(target); } catch { /* ignore */ }
    subQualityStore.set(rpIdentity, pub.source, tierOf(target));
  }, []);

  const applyToAll = useCallback(() => {
    if (!room) return;
    for (const rp of Array.from(room.remoteParticipants.values())) {
      for (const pub of Array.from(rp.trackPublications.values())) {
        applyToPub(rp.identity, pub);
      }
    }
  }, [room, applyToPub]);

  // React to local quality changes and apply per-source policy.
  useEffect(() => {
    if (!room) return;
    const next = policyFor(quality);
    const prev = policyRef.current;
    const changed = next.cam !== prev.cam || next.screen !== prev.screen;
    policyRef.current = next;
    if (!changed) return;
    applyToAll();

    if (next.cam === VideoQuality.LOW || next.screen !== VideoQuality.HIGH) {
      toast.info(
        rtl
          ? `تكييف الاستقبال محلياً — كاميرا ${tierOf(next.cam)} / شاشة ${tierOf(next.screen)}`
          : `Local receive adapted — camera ${tierOf(next.cam)} / screen ${tierOf(next.screen)}`,
        { id: "sub-quality-adapt" }
      );
    } else {
      toast.success(
        rtl ? "استعادة جودة الاستقبال العالية" : "Restored high receive quality",
        { id: "sub-quality-adapt" }
      );
    }
  }, [quality, room, rtl, applyToAll, policyFor]);

  // Apply the current policy to newly-subscribed tracks and clean up on leave.
  useEffect(() => {
    if (!room) return;
    const onSub = (_track: any, pub: any, rp: any) => {
      if (!rp?.identity) return;
      applyToPub(rp.identity, pub);
    };
    const onUnsub = (_track: any, pub: any, rp: any) => {
      if (!rp?.identity || !pub) return;
      // Remove just this track's badge state.
      const k = subQualityStore.key(rp.identity, pub.source);
      // Reuse clear() for full-participant tidy on disconnect; single-key drop:
      if ((subQualityStore.getSnapshot() as any)[k]) subQualityStore.set(rp.identity, pub.source, "HIGH");
    };
    const onPartLeft = (p: any) => { if (p?.identity) subQualityStore.clear(p.identity); };
    room.on(RoomEvent.TrackSubscribed, onSub);
    room.on(RoomEvent.TrackUnsubscribed, onUnsub);
    room.on(RoomEvent.ParticipantDisconnected, onPartLeft);
    return () => {
      room.off(RoomEvent.TrackSubscribed, onSub);
      room.off(RoomEvent.TrackUnsubscribed, onUnsub);
      room.off(RoomEvent.ParticipantDisconnected, onPartLeft);
    };
  }, [room, applyToPub]);

  return null;
}

/**
 * SubQualityBadge — small pill showing the currently-subscribed simulcast
 * tier for one participant/source pair (LOW / BALANCED / HIGH). Only visible
 * when a tier has been recorded for this tile.
 */
function SubQualityBadge({
  identity, source, rtl,
}: { identity: string; source: Track.Source; rtl: boolean }) {
  const tier = useSubQuality(identity, source);
  if (!tier) return null;
  const isScreen = source === Track.Source.ScreenShare;
  const label = rtl
    ? `${isScreen ? "شاشة" : "كاميرا"}: ${tier === "LOW" ? "منخفضة" : tier === "BALANCED" ? "متوازنة" : "عالية"}`
    : `${isScreen ? "Screen" : "Camera"}: ${tier}`;
  const cls =
    tier === "HIGH"     ? "bg-emerald-500/20 text-emerald-200 border-emerald-400/40" :
    tier === "BALANCED" ? "bg-amber-500/20 text-amber-100 border-amber-400/40" :
                          "bg-rose-500/25 text-rose-100 border-rose-400/40";
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={cn(
        "absolute bottom-2 z-20 select-none rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide backdrop-blur-md",
        rtl ? "right-2" : "left-2",
        cls
      )}
    >
      {isScreen ? (rtl ? "شاشة" : "SCR") : (rtl ? "كام" : "CAM")} · {tier}
    </span>
  );
}





/**
 * PerfEffectsGuard — toggles a `data-perf-lite` attribute on the room root
 * whenever the effective profile is "lite" or the local quality is poor.
 * A tiny scoped stylesheet then disables backdrop-blur, heavy shadows and
 * animations to preserve frame budget on weak devices.
 */
function PerfEffectsGuard({ pref }: { pref: CallPerfPref }) {
  const { localParticipant } = useLocalParticipant();
  const q = localParticipant?.connectionQuality ?? ConnectionQuality.Unknown;
  const lite = pref === "lite" || q === ConnectionQuality.Poor || q === ConnectionQuality.Lost;

  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-lk-theme]");
    if (!root) return;
    if (lite) root.setAttribute("data-perf-lite", "1");
    else root.removeAttribute("data-perf-lite");
    return () => root.removeAttribute("data-perf-lite");
  }, [lite]);

  return (
    <style>{`
      [data-lk-theme][data-perf-lite="1"] .backdrop-blur-xl,
      [data-lk-theme][data-perf-lite="1"] .backdrop-blur-md,
      [data-lk-theme][data-perf-lite="1"] .backdrop-blur { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
      [data-lk-theme][data-perf-lite="1"] * { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
      [data-lk-theme][data-perf-lite="1"] .shadow-lg,
      [data-lk-theme][data-perf-lite="1"] .shadow-xl,
      [data-lk-theme][data-perf-lite="1"] .shadow-2xl { box-shadow: none !important; }
    `}</style>
  );
}

/**
 * QualityInsights — a compact button that opens a dialog explaining WHY the
 * call quality dropped (network / CPU-frame drops / packet loss) and offers
 * one-click suggestions.
 */
function QualityInsights({
  rtl, shareState, onSwitchLite,
}: {
  rtl: boolean;
  shareState: ReturnType<typeof useScreenShareMonitor>;
  onSwitchLite: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const q = localParticipant?.connectionQuality ?? ConnectionQuality.Unknown;

  // Detect frame-drop / CPU pressure from any local video sender.
  const [frameDrop, setFrameDrop] = useState<number>(0); // % lost
  const [rttMs, setRttMs] = useState<number>(0);
  const [lossPct, setLossPct] = useState<number>(0);
  useEffect(() => {
    if (!room) return;
    let stop = false;
    const last: Record<string, { sent: number; lost: number; ts: number }> = {};
    const tick = async () => {
      const local = room.localParticipant;
      const pubs = Array.from(local.trackPublications.values());
      let totalFramesSent = 0, totalFramesDropped = 0, totalPktSent = 0, totalPktLost = 0, rtt = 0;
      for (const pub of pubs) {
        const sender = (pub as any).track?.sender as RTCRtpSender | undefined;
        if (!sender?.getStats) continue;
        try {
          const s = await sender.getStats();
          s.forEach((r: any) => {
            if (r.type === "outbound-rtp" && r.kind === "video") {
              totalFramesSent += r.framesSent || 0;
              totalFramesDropped += (r.framesEncoded && r.framesSent) ? Math.max(0, r.framesEncoded - r.framesSent) : 0;
            }
            if (r.type === "remote-inbound-rtp") {
              totalPktLost += r.packetsLost || 0;
              rtt = Math.max(rtt, Math.round((r.roundTripTime || 0) * 1000));
            }
            if (r.type === "outbound-rtp") totalPktSent += r.packetsSent || 0;
          });
        } catch { /* ignore */ }
      }
      if (!stop) {
        setFrameDrop(totalFramesSent > 0 ? Math.round((totalFramesDropped / totalFramesSent) * 100) : 0);
        setLossPct(totalPktSent > 0 ? Math.min(100, Math.round((totalPktLost / totalPktSent) * 100)) : 0);
        setRttMs(rtt);
      }
    };
    const iv = window.setInterval(tick, 2500);
    return () => { stop = true; clearInterval(iv); };
  }, [room]);

  const netBad = q === ConnectionQuality.Poor || q === ConnectionQuality.Lost;
  const cpuBad = frameDrop > 12 || (shareState.latest?.fps != null && shareState.latest.fps > 0 && shareState.latest.fps < 10);
  const lossBad = lossPct > 5;

  let reason: { icon: any; title: string; detail: string; tone: string; key: string } | null = null;
  if (netBad) reason = { key: "net", icon: WifiOff, tone: "amber", title: rtl ? "الشبكة ضعيفة" : "Network is weak", detail: rtl ? `RTT ${rttMs}ms · فقد ${lossPct}%` : `RTT ${rttMs}ms · loss ${lossPct}%` };
  else if (lossBad) reason = { key: "loss", icon: Activity, tone: "amber", title: rtl ? "فقد حزم مرتفع" : "High packet loss", detail: `${lossPct}%` };
  else if (cpuBad) reason = { key: "cpu", icon: Cpu, tone: "amber", title: rtl ? "ضغط على المعالج" : "CPU / frame pressure", detail: rtl ? `إسقاط إطارات ${frameDrop}%` : `Dropped frames ${frameDrop}%` };

  // aria-live announcement: fire once when a reason appears/changes, and once
  // when quality recovers. Debounced via key comparison so we don't spam SRs.
  const lastKeyRef = useRef<string | null>(null);
  const [announce, setAnnounce] = useState<string>("");
  useEffect(() => {
    const nextKey = reason?.key ?? null;
    if (nextKey === lastKeyRef.current) return;
    if (nextKey && reason) {
      setAnnounce(rtl
        ? `تنبيه جودة المكالمة: ${reason.title}. ${reason.detail}. توجد اقتراحات لتحسين الاتصال.`
        : `Call quality alert: ${reason.title}. ${reason.detail}. Suggestions available.`);
    } else if (lastKeyRef.current && !nextKey) {
      setAnnounce(rtl ? "تحسّنت جودة المكالمة." : "Call quality has recovered.");
    }
    lastKeyRef.current = nextKey;
  }, [reason?.key, reason?.title, reason?.detail, rtl]);

  return (
    <>
      {/* Screen-reader live region — always mounted so recovery is announced */}
      <div aria-live="polite" aria-atomic="true" role="status" className="sr-only">
        {announce}
      </div>
      {reason ? (
      <>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "absolute top-16 left-4 z-20 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-md shadow",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300",
          "border-amber-400/40 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30"
        )}
        dir={rtl ? "rtl" : "ltr"}
        aria-label={`${reason.title} — ${rtl ? "اقتراحات" : "suggestions"}`}
        title={reason.detail}
      >
        {reason.icon ? <reason.icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
        <span>{reason.title}</span>
        <span className="opacity-70">·</span>
        <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{rtl ? "اقتراحات" : "Tips"}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md bg-neutral-950 text-white border-white/10" dir={rtl ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5 text-amber-300" />
              {rtl ? "تحسين جودة المكالمة" : "Improve call quality"}
            </DialogTitle>
            <DialogDescription className="text-white/70">
              {rtl ? `السبب المرجّح: ${reason.title} (${reason.detail})` : `Likely cause: ${reason.title} (${reason.detail})`}
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-2 text-sm">
            {netBad && <li className="flex gap-2"><WifiOff className="h-4 w-4 mt-0.5 text-amber-300" /> {rtl ? "اقترب من الراوتر أو انتقل إلى شبكة أقوى." : "Move closer to your router or switch to a stronger network."}</li>}
            {lossBad && <li className="flex gap-2"><Activity className="h-4 w-4 mt-0.5 text-amber-300" /> {rtl ? "أغلق التحميلات/البث في الخلفية." : "Pause background downloads or streaming."}</li>}
            {cpuBad && <li className="flex gap-2"><Cpu className="h-4 w-4 mt-0.5 text-amber-300" /> {rtl ? "أغلق التبويبات والتطبيقات الثقيلة." : "Close heavy tabs and apps."}</li>}
            <li className="flex gap-2"><Feather className="h-4 w-4 mt-0.5 text-amber-300" /> {rtl ? "بدّل وضع الأداء إلى «خفيف» لأقصى سلاسة." : "Switch performance mode to “Lite” for max smoothness."}</li>
            <li className="flex gap-2"><VideoOff className="h-4 w-4 mt-0.5 text-amber-300" /> {rtl ? "أوقف الكاميرا مؤقتاً — الصوت وحده أكثر استقراراً." : "Turn camera off temporarily — audio-only is more stable."}</li>
          </ul>

          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {rtl ? "إغلاق" : "Close"}
            </Button>
            <Button
              onClick={() => { onSwitchLite(); setOpen(false); }}
              className="bg-amber-500 text-black hover:bg-amber-400"
            >
              <Feather className="h-4 w-4 me-2" />
              {rtl ? "تفعيل الوضع الخفيف" : "Enable Lite mode"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </>
      ) : null}
    </>
  );
}

/**
 * CameraFailureRetry — listens for camera track failures and transparently
 * re-requests the camera at a lower resolution so a device that can't do
 * 720p still stays on video at 180p instead of dropping to audio-only.
 */
function CameraFailureRetry({ rtl }: { rtl: boolean }) {
  const room = useRoomContext();
  const retryRef = useRef(0);
  useEffect(() => {
    if (!room) return;
    const onFailed = async (_pub: TrackPublication, _p: Participant) => {
      // no-op placeholder to make LiveKit types happy
    };
    const onLocalPublishError = async (err: any) => {
      if (retryRef.current >= 2) return;
      retryRef.current += 1;
      try {
        await room.localParticipant.setCameraEnabled(false);
        await new Promise((r) => setTimeout(r, 300));
        await room.localParticipant.setCameraEnabled(true, {
          resolution: retryRef.current === 1 ? VideoPresets.h360.resolution : VideoPresets.h180.resolution,
        });
        toast.info(
          rtl ? "إعادة تشغيل الكاميرا بدقة أقل لتفادي الفشل" : "Camera restarted at lower resolution to avoid failure",
          { id: "cam-retry" }
        );
      } catch { /* swallow */ }
    };
    room.on(RoomEvent.TrackSubscriptionFailed as any, onFailed);
    room.on(RoomEvent.MediaDevicesError as any, onLocalPublishError);
    return () => {
      room.off(RoomEvent.TrackSubscriptionFailed as any, onFailed);
      room.off(RoomEvent.MediaDevicesError as any, onLocalPublishError);
    };
  }, [room, rtl]);
  return null;
}

/* ------------------------------------------------------------------ */
/*  Room options                                                      */
/* ------------------------------------------------------------------ */

/**
 * Detect device / network capability once per call to build a resilient
 * RoomOptions profile. Weak CPUs, low memory, cellular links, and Data-Saver
 * mode start on the lowest simulcast rung and a conservative capture size.
 */
type CapProfile = "lite" | "balanced" | "hi";
function detectCapProfile(): CapProfile {
  if (typeof navigator === "undefined") return "balanced";
  const nav: any = navigator;
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 4;
  const saveData = !!conn?.saveData;
  const eff = String(conn?.effectiveType || "");
  const downlink = Number(conn?.downlink ?? 10);
  if (saveData || /^(slow-)?2g$/.test(eff) || cores <= 2 || mem <= 2 || downlink < 1) return "lite";
  if (eff === "3g" || cores <= 4 || mem <= 4 || downlink < 3) return "balanced";
  return "hi";
}

/**
 * Preflight probe — pings the LiveKit server a few times to estimate RTT and
 * combines it with the static capability detector to recommend Auto / Lite /
 * Balanced. Runs for ~1.2s max; returns immediately if offline or errored.
 */
async function runNetworkPreflight(url: string): Promise<{
  profile: CapProfile;
  rttMs: number;
  jitterMs: number;
  reason: string;
}> {
  const base = detectCapProfile();
  // Convert wss:// → https:// for a same-origin HEAD probe
  const probeUrl = (() => {
    try {
      const u = new URL(url);
      u.protocol = u.protocol === "wss:" ? "https:" : "http:";
      u.pathname = "/";
      u.search = "";
      return u.toString();
    } catch { return null; }
  })();
  if (!probeUrl || typeof fetch === "undefined") {
    return { profile: base, rttMs: 0, jitterMs: 0, reason: "no-probe" };
  }
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    try {
      await fetch(probeUrl + "?_pf=" + Date.now() + i, {
        method: "HEAD",
        mode: "no-cors",
        cache: "no-store",
      });
      samples.push(performance.now() - t0);
    } catch { /* skip failed sample */ }
    if (samples.length && samples[samples.length - 1] > 1500) break;
  }
  if (!samples.length) return { profile: base, rttMs: 0, jitterMs: 0, reason: "unreachable" };
  const rtt = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  const jitter = Math.round(Math.max(...samples) - Math.min(...samples));

  // Merge probe with static detector — network wins if worse
  let profile: CapProfile = base;
  let reason = "static";
  if (rtt > 450 || jitter > 250) { profile = "lite"; reason = "high-latency"; }
  else if (rtt > 220 || jitter > 120) {
    if (base === "hi") profile = "balanced";
    reason = "moderate-latency";
  } else {
    reason = "healthy";
  }
  return { profile, rttMs: rtt, jitterMs: jitter, reason };
}

/**
 * Merge the user's saved call-perf pref with detected capability. The user
 * can force "lite" or "balanced"; "auto" defers to the detector.
 */
function effectiveProfile(pref: CallPerfPref, override?: CapProfile | null): CapProfile {
  if (pref === "lite") return "lite";
  if (pref === "balanced") return "balanced";
  return override ?? detectCapProfile();
}

function buildRoomOptions(profile: CapProfile): RoomOptions {
  const isLite = profile === "lite";
  const isBal = profile === "balanced";
  return {
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: {
      simulcast: true,
      videoSimulcastLayers: isLite
        ? [VideoPresets.h180]
        : isBal
        ? [VideoPresets.h180, VideoPresets.h360]
        : [VideoPresets.h180, VideoPresets.h360, VideoPresets.h720],
      videoCodec: isLite ? "vp8" : "vp9",
      dtx: true,
      red: true,
      audioPreset: {
        maxBitrate: isLite ? 20_000 : 32_000,
        priority: "high",
      },
      videoEncoding: isLite
        ? { maxBitrate: 300_000, maxFramerate: 20, priority: "low" }
        : isBal
        ? { maxBitrate: 900_000, maxFramerate: 24, priority: "medium" }
        : { maxBitrate: 1_700_000, maxFramerate: 30, priority: "medium" },
      degradationPreference: "maintain-framerate",
      screenShareEncoding: isLite
        ? { maxBitrate: 800_000, maxFramerate: 15, priority: "high" }
        : ScreenSharePresets.h1080fps30.encoding,
      screenShareSimulcastLayers: isLite
        ? [ScreenSharePresets.h720fps15]
        : [ScreenSharePresets.h720fps15, ScreenSharePresets.h1080fps30],
    },
    audioCaptureDefaults: {
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: 1,
      sampleRate: 48_000,
    },
    videoCaptureDefaults: {
      resolution: isLite
        ? VideoPresets.h180.resolution
        : isBal
        ? VideoPresets.h360.resolution
        : VideoPresets.h720.resolution,
    },
    stopLocalTrackOnUnpublish: true,
    reconnectPolicy: {
      nextRetryDelayInMs: (ctx: { retryCount: number }) =>
        Math.min(1000 * Math.pow(1.5, ctx.retryCount), 10_000),
    },
  };
}


/* ------------------------------------------------------------------ */

export function CallStage({ open, onClose, url, token, video, onLeave }: Props) {
  const { lang } = useI18n();
  const rtl = lang === "ar";
  const [autoSpeaker, setAutoSpeaker] = useAutoSpeaker();
  const [focusLock, setFocusLock, setFocusLockTransient] = useFocusLock();
  const [callPerf, setCallPerf] = useCallPerf();

  // Preflight — run once per call-open. If pref is "auto" the probe result
  // drives room options; otherwise we still measure so we can announce it.
  const [preflight, setPreflight] = useState<null | {
    profile: CapProfile;
    rttMs: number;
    jitterMs: number;
    reason: string;
  }>(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    if (!open || !url) { setPreflight(null); return; }
    let cancelled = false;
    setProbing(true);
    const timeout = window.setTimeout(() => {
      // Hard timeout — never block the call more than 1.6s
      if (!cancelled) { setProbing(false); }
    }, 1600);
    runNetworkPreflight(url).then((res) => {
      if (cancelled) return;
      setPreflight(res);
      setProbing(false);
      clearTimeout(timeout);
      const labels: Record<CapProfile, string> = {
        lite: rtl ? "خفيف" : "Lite",
        balanced: rtl ? "متوازن" : "Balanced",
        hi: rtl ? "عالي (Auto)" : "High (Auto)",
      };
      const msg = res.reason === "healthy"
        ? (rtl ? `الشبكة ممتازة (RTT ${res.rttMs}ms) — الوضع: ${labels[res.profile]}` : `Network healthy (RTT ${res.rttMs}ms) — mode: ${labels[res.profile]}`)
        : res.reason === "moderate-latency"
        ? (rtl ? `شبكة متوسطة (RTT ${res.rttMs}ms · Jitter ${res.jitterMs}ms) — اقتراح: ${labels[res.profile]}` : `Moderate network (RTT ${res.rttMs}ms · jitter ${res.jitterMs}ms) — suggesting ${labels[res.profile]}`)
        : res.reason === "high-latency"
        ? (rtl ? `شبكة ضعيفة (RTT ${res.rttMs}ms) — تفعيل الوضع الخفيف تلقائياً` : `Weak network (RTT ${res.rttMs}ms) — auto-enabling Lite`)
        : (rtl ? `تعذّر فحص الشبكة — استخدام الافتراضي` : `Preflight skipped — using defaults`);
      toast.info(msg, { id: "call-preflight", duration: 4500 });
    }).catch(() => { if (!cancelled) { setProbing(false); clearTimeout(timeout); } });
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [open, url, rtl]);

  const roomOptions = useMemo(
    () => buildRoomOptions(effectiveProfile(callPerf, preflight?.profile ?? null)),
    [callPerf, preflight]
  );

  const preflightAnnouncement = preflight
    ? (rtl
        ? `اكتمل فحص الشبكة. زمن الاستجابة ${preflight.rttMs} مللي ثانية. الوضع المقترح ${preflight.profile === "lite" ? "خفيف" : preflight.profile === "balanced" ? "متوازن" : "عالي"}.`
        : `Network preflight complete. Round-trip ${preflight.rttMs} ms. Suggested mode ${preflight.profile}.`)
    : probing
    ? (rtl ? "جاري فحص جودة الشبكة قبل الاتصال" : "Measuring network quality before connecting")
    : "";

  // Focus lock only makes sense while speaker sort is on — disable at
  // runtime WITHOUT wiping the persisted preference so it restores next call.
  useEffect(() => {
    if (!autoSpeaker && focusLock) setFocusLockTransient(false);
    if (autoSpeaker && !focusLock && readLS(LS_FOCUSLOCK, "0") === "1") {
      setFocusLockTransient(true);
    }
  }, [autoSpeaker, focusLock, setFocusLockTransient]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const ready = open && !!url && !!token && !probing;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="h-[100dvh] w-full p-0 border-0 bg-black text-white"
        dir={rtl ? "rtl" : "ltr"}
      >
        {/* aria-live for screen readers — preflight status */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {preflightAnnouncement}
        </div>

        {open && probing ? (
          <div
            className="flex h-[100dvh] w-full flex-col items-center justify-center gap-4 bg-black text-white"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-10 w-10 animate-spin text-amber-300" aria-hidden="true" />
            <div className="text-center">
              <div className="text-base font-semibold">
                {rtl ? "فحص جودة الشبكة…" : "Checking network quality…"}
              </div>
              <div className="mt-1 text-xs text-white/60">
                {rtl ? "نقيس زمن الاستجابة لاختيار أفضل وضع للمكالمة" : "Measuring latency to pick the best call profile"}
              </div>
            </div>
          </div>
        ) : ready ? (
          <LiveKitRoom
            serverUrl={url!}
            token={token!}
            connect
            video={video}
            audio
            options={roomOptions}
            data-lk-theme="default"
            style={{ height: "100dvh", background: "black", position: "relative" }}
            onDisconnected={() => {
              onLeave();
              onClose();
            }}
            onMediaDeviceFailure={(e) => {
              toast.error(
                rtl ? `تعذّر الوصول للميكروفون/الكاميرا (${e ?? "غير معروف"}) — جاري المحاولة بدقة أقل` : `Media device error (${e ?? "unknown"}) — retrying at lower resolution`
              );
            }}
            onError={(e) => {
              toast.error(rtl ? `خطأ في المكالمة: ${e.message}` : `Call error: ${e.message}`);
            }}
          >
            <ShareDiagnosticsMount
              rtl={rtl}
              autoSpeaker={autoSpeaker}
              setAutoSpeaker={setAutoSpeaker}
              focusLock={focusLock}
              setFocusLock={setFocusLock}
              callPerf={callPerf}
              setCallPerf={setCallPerf}
            />
          </LiveKitRoom>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Composes ScreenShareWithPreview, the stats monitor, live quality badge,
 * diagnostics dialog and auto-fallback controller inside the LiveKitRoom.
 */
function ShareDiagnosticsMount({
  rtl, autoSpeaker, setAutoSpeaker, focusLock, setFocusLock, callPerf, setCallPerf,
}: {
  rtl: boolean;
  autoSpeaker: boolean;
  setAutoSpeaker: (v: boolean) => void;
  focusLock: boolean;
  setFocusLock: (v: boolean) => void;
  callPerf: CallPerfPref;
  setCallPerf: (v: CallPerfPref) => void;
}) {
  const ctrlRef = useRef<ShareController | null>(null);
  const surfaceRef = useRef<Surface>(
    (readLS(LS_SURFACE, "monitor") as Surface)
  );
  const [diagOpen, setDiagOpen] = useState(false);

  const requestFallback = (reason: string) => {
    if (!ctrlRef.current) return;
    fallback(reason);
  };
  const monitor = useScreenShareMonitor({ onUnstable: requestFallback });

  const fallback = useAutoFallback({
    rtl,
    isSharing: monitor.isSharing,
    currentSurface: surfaceRef.current,
    onSwitchTo: (s) => {
      surfaceRef.current = s;
      writeLS(LS_SURFACE, s);
      ctrlRef.current?.setSurface(s as DisplaySurface);
    },
    onRestart: () => { ctrlRef.current?.openPicker(); },
  });

  return (
    <>
      <PerfEffectsGuard pref={callPerf} />
      <ShareQualityBadge rtl={rtl} state={monitor} onOpenDiagnostics={() => setDiagOpen(true)} />
      <ShareDiagnosticsDialog rtl={rtl} open={diagOpen} onOpenChange={setDiagOpen} state={monitor} />

      <NetworkQualityBadge rtl={rtl} />
      <ParticipantCountBadge rtl={rtl} />
      <LocalMediaStatusBadge rtl={rtl} />
      <MediaStateAnnouncer rtl={rtl} />
      <PinRestorer />
      <NetworkResilience rtl={rtl} />
      <AutoBitrateCap rtl={rtl} />
      <SubscriberQualityAdaptor rtl={rtl} />

      <CameraFailureRetry rtl={rtl} />
      <QualityInsights rtl={rtl} shareState={monitor} onSwitchLite={() => setCallPerf("lite")} />
      <Stage autoSpeaker={autoSpeaker} focusLock={focusLock} />
      <PresenterTools rtl={rtl} />
      <RoomAudioRenderer />
      <AutoSpeakerToggle rtl={rtl} on={autoSpeaker} setOn={setAutoSpeaker} />
      <FocusLockToggle rtl={rtl} on={focusLock} setOn={setFocusLock} disabled={!autoSpeaker} />
      <KeyboardShortcuts
        rtl={rtl}
        autoSpeaker={autoSpeaker}
        setAutoSpeaker={setAutoSpeaker}
        focusLock={focusLock}
        setFocusLock={setFocusLock}
      />

      <div
        className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent pt-6 pb-3"
        role="toolbar"
        aria-label={rtl ? "أدوات التحكم في المكالمة" : "Call controls"}
      >
        <div className="mx-auto mb-2 flex max-w-4xl flex-wrap items-center justify-center gap-2 px-4">
          <CallPerfSelector rtl={rtl} value={callPerf} onChange={setCallPerf} />
          <ScreenShareWithPreview
            rtl={rtl}
            bindController={(c) => { ctrlRef.current = c; }}
          />
          <DiagnosticsLaunchButton
            rtl={rtl}
            onClick={() => setDiagOpen(true)}
            quality={monitor.quality}
            isSharing={monitor.isSharing}
          />
        </div>
        <ControlBar
          variation="verbose"
          controls={{
            microphone: true,
            camera: true,
            screenShare: false,
            chat: false,
            leave: true,
            settings: true,
          }}
        />
      </div>
    </>
  );
}


