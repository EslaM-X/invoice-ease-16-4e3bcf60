import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "@livekit/components-react";
import {
  Track,
  ConnectionState,
  ConnectionQuality,
  VideoPresets,
  ScreenSharePresets,
  RoomEvent,
  createLocalScreenTracks,
  type RoomOptions,
  type LocalTrack,
  type TrackPublication,
  type Participant,
  type TrackReference,
} from "livekit-client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import {
  Signal, SignalHigh, SignalLow, SignalMedium, WifiOff, Loader2,
  Mic, MicOff, Video as VideoIcon, VideoOff, Pin, PinOff,
  MonitorUp, Keyboard, X, Users, Sparkles, Monitor, AppWindow, Globe,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Persisted preferences (screen-share surface + pinned participant) */
/* ------------------------------------------------------------------ */

type DisplaySurface = "monitor" | "window" | "browser";
const LS_SURFACE = "call.screenShare.displaySurface";
const LS_PIN = "call.pin.identity";
const LS_AUTOSPK = "call.autoSpeakerReorder";

function readLS<T extends string>(key: string, fallback: T): T {
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    return (v as T) || fallback;
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
    } else {
      layoutCtx.pin.dispatch?.({ msg: "set_pin", trackReference: trackRef });
    }
  }, [layoutCtx, isPinned, trackRef]);

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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Adaptive stage                                                    */
/* ------------------------------------------------------------------ */

function Stage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const screenShareTracks = tracks.filter((t) => t.source === Track.Source.ScreenShare);
  const cameraTracks = tracks.filter((t) => t.source === Track.Source.Camera);
  const pinned = usePinnedTracks() ?? [];
  const focusTrack = pinned[0] ?? screenShareTracks[0];

  if (focusTrack) {
    const carousel = cameraTracks.length > 0 ? cameraTracks : tracks;
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
    <GridLayout tracks={tracks} style={{ height: "calc(100% - 128px)" }}>
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
  // key -> latest pending state; single delayed dispatch collapses rapid toggles
  const pendingRef = useRef<Map<string, { timer: any; final: () => void }>>(new Map());

  useEffect(() => {
    if (!room) return;

    const nameOf = (p: any) =>
      p?.name || p?.identity || (rtl ? "مشارك" : "Participant");

    const scheduleToast = (key: string, dispatch: () => void, delay = 900) => {
      const existing = pendingRef.current.get(key);
      if (existing) clearTimeout(existing.timer);
      const timer = setTimeout(() => {
        pendingRef.current.delete(key);
        dispatch();
      }, delay);
      pendingRef.current.set(key, { timer, final: dispatch });
    };

    const whoLabel = (participant: any) =>
      participant?.identity === room.localParticipant?.identity
        ? (rtl ? "أنت" : "You")
        : nameOf(participant);

    const onMuteChange = (pub: TrackPublication, participant: any, muted: boolean) => {
      if (!seenRef.current) return;
      const who = whoLabel(participant);
      const toastId = `mute-${participant.identity}-${pub.source}`;
      if (pub.source === Track.Source.Microphone) {
        scheduleToast(toastId, () => {
          const line = rtl
            ? `${who}: ${muted ? "كتم الميكروفون" : "فتح الميكروفون"}`
            : `${who} ${muted ? "muted the mic" : "unmuted the mic"}`;
          (muted ? toast : toast.success)(line, { id: toastId, icon: "🎙️" });
        });
      } else if (pub.source === Track.Source.Camera) {
        scheduleToast(toastId, () => {
          const line = rtl
            ? `${who}: ${muted ? "أغلق الكاميرا" : "فتح الكاميرا"}`
            : `${who} ${muted ? "turned camera off" : "turned camera on"}`;
          (muted ? toast : toast.success)(line, { id: toastId, icon: "📷" });
        });
      }
    };

    const onMuted = (pub: TrackPublication, participant: any) => onMuteChange(pub, participant, true);
    const onUnmuted = (pub: TrackPublication, participant: any) => onMuteChange(pub, participant, false);

    const onShareChange = (pub: TrackPublication, participant: any, started: boolean) => {
      if (pub.source !== Track.Source.ScreenShare) return;
      const who = whoLabel(participant);
      const id = `share-${participant.identity}`;
      scheduleToast(id, () => {
        const line = rtl
          ? `${who}: ${started ? "بدأ مشاركة الشاشة" : "أوقف مشاركة الشاشة"}`
          : `${who} ${started ? "started screen share" : "stopped screen share"}`;
        (started ? toast.success : toast)(line, { id, icon: "🖥️" });
      }, 250);
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
      pendingRef.current.forEach((v) => clearTimeout(v.timer));
      pendingRef.current.clear();
      room.off(RoomEvent.TrackMuted, onMuted);
      room.off(RoomEvent.TrackUnmuted, onUnmuted);
      room.off(RoomEvent.TrackPublished, onPub);
      room.off(RoomEvent.LocalTrackPublished, onPub as any);
      room.off(RoomEvent.TrackUnpublished, onUnpub);
      room.off(RoomEvent.LocalTrackUnpublished, onUnpub as any);
    };
  }, [room, rtl]);

  return null;
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

function ScreenShareWithPreview({ rtl }: { rtl: boolean }) {
  const { localParticipant } = useLocalParticipant();
  const [tracks, setTracks] = useState<LocalTrack[] | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [busy, setBusy] = useState(false);
  const isSharing = localParticipant?.isScreenShareEnabled ?? false;

  const cleanup = useCallback(() => {
    tracks?.forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    setTracks(null);
  }, [tracks]);

  const openPicker = useCallback(async () => {
    if (isSharing) {
      // stop existing share
      try { await localParticipant?.setScreenShareEnabled(false); } catch { /* ignore */ }
      return;
    }
    setBusy(true);
    try {
      const created = await createLocalScreenTracks({
        audio: true,
        resolution: ScreenSharePresets.h1080fps30.resolution,
      });
      setTracks(created);
    } catch (e: any) {
      // AbortError = user cancelled the picker; stay silent
      if (e?.name !== "AbortError" && e?.name !== "NotAllowedError") {
        toast.error(rtl ? `تعذّر بدء المشاركة: ${e?.message ?? ""}` : `Could not start share: ${e?.message ?? ""}`);
      }
    } finally {
      setBusy(false);
    }
  }, [isSharing, localParticipant, rtl]);

  // Attach preview stream when tracks exist
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
      for (const track of tracks) {
        await localParticipant.publishTrack(track);
      }
      setTracks(null); // dialog closes, tracks now owned by the room
      toast.success(rtl ? "بدأت مشاركة الشاشة بجودة عالية" : "Screen share started in high quality");
    } catch (e: any) {
      cleanup();
      toast.error(rtl ? `فشل نشر المشاركة: ${e?.message ?? ""}` : `Publish failed: ${e?.message ?? ""}`);
    }
  }, [tracks, localParticipant, rtl, cleanup]);

  const cancel = useCallback(() => cleanup(), [cleanup]);

  return (
    <>
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

      <Dialog open={!!tracks} onOpenChange={(o) => { if (!o) cancel(); }}>
        <DialogContent className="max-w-3xl bg-neutral-950 text-white border-white/10" dir={rtl ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{rtl ? "معاينة مشاركة الشاشة" : "Screen share preview"}</DialogTitle>
            <DialogDescription className="text-white/60">
              {rtl
                ? "تأكد من المصدر الذي اخترته قبل إرساله لباقي المشاركين. تقدر ترجع وتختار مصدر مختلف."
                : "Confirm the source you picked before sending it to the other participants."}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg overflow-hidden bg-black ring-1 ring-white/10 aspect-video">
            <video ref={videoRef} className="h-full w-full object-contain" muted playsInline />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={cancel}>
              <X className="h-4 w-4 mr-1" aria-hidden="true" />
              {rtl ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={confirm}
              className="bg-amber-500 hover:bg-amber-400 text-black font-semibold"
            >
              <MonitorUp className="h-4 w-4 mr-1" aria-hidden="true" />
              {rtl ? "بدء المشاركة" : "Start sharing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Keyboard shortcuts + help legend                                  */
/* ------------------------------------------------------------------ */

function KeyboardShortcuts({ rtl }: { rtl: boolean }) {
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
      } else if (key === "?" || (e.shiftKey && key === "/")) {
        e.preventDefault();
        setHelpOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [room, layoutCtx]);

  const rows: Array<[string, string]> = useMemo(() => rtl ? [
    ["M", "كتم/فتح الميكروفون"],
    ["V", "تشغيل/إيقاف الكاميرا"],
    ["S", "بدء/إيقاف مشاركة الشاشة"],
    ["P", "إلغاء تثبيت المشارك"],
    ["?", "عرض/إخفاء هذه القائمة"],
    ["Esc", "إغلاق النوافذ"],
  ] : [
    ["M", "Mute / unmute mic"],
    ["V", "Camera on / off"],
    ["S", "Start / stop screen share"],
    ["P", "Clear pinned participant"],
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
/*  Room options                                                      */
/* ------------------------------------------------------------------ */

const roomOptions: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  publishDefaults: {
    simulcast: true,
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360, VideoPresets.h720],
    videoCodec: "vp9",
    dtx: true,
    red: true,
    audioPreset: { maxBitrate: 32_000, priority: "high" },
    screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
    screenShareSimulcastLayers: [ScreenSharePresets.h720fps15, ScreenSharePresets.h1080fps30],
  },
  audioCaptureDefaults: {
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: true,
    channelCount: 1,
    sampleRate: 48_000,
  },
  videoCaptureDefaults: {
    resolution: VideoPresets.h720.resolution,
  },
  stopLocalTrackOnUnpublish: true,
};

/* ------------------------------------------------------------------ */

export function CallStage({ open, onClose, url, token, video, onLeave }: Props) {
  const { lang } = useI18n();
  const rtl = lang === "ar";

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="h-[100dvh] w-full p-0 border-0 bg-black text-white"
        dir={rtl ? "rtl" : "ltr"}
      >
        {open && url && token ? (
          <LiveKitRoom
            serverUrl={url}
            token={token}
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
                rtl ? `تعذّر الوصول للميكروفون/الكاميرا (${e ?? "غير معروف"})` : `Media device error (${e ?? "unknown"})`
              );
            }}
            onError={(e) => {
              toast.error(rtl ? `خطأ في المكالمة: ${e.message}` : `Call error: ${e.message}`);
            }}
          >
            <NetworkQualityBadge rtl={rtl} />
            <LocalMediaStatusBadge rtl={rtl} />
            <MediaStateAnnouncer rtl={rtl} />
            <KeyboardShortcuts rtl={rtl} />
            <Stage />
            <RoomAudioRenderer />
            <div
              className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent pt-6 pb-3"
              role="toolbar"
              aria-label={rtl ? "أدوات التحكم في المكالمة" : "Call controls"}
            >
              <div className="mx-auto mb-2 flex max-w-3xl items-center justify-center gap-2 px-4">
                <ScreenShareWithPreview rtl={rtl} />
              </div>
              <ControlBar
                variation="verbose"
                controls={{
                  microphone: true,
                  camera: true,
                  screenShare: false, // replaced by our preview-first button above
                  chat: false,
                  leave: true,
                  settings: true,
                }}
              />
            </div>
          </LiveKitRoom>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
