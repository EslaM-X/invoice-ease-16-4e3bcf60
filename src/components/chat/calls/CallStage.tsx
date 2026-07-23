import { useEffect, useRef } from "react";
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
} from "@livekit/components-react";
import {
  Track,
  ConnectionState,
  ConnectionQuality,
  VideoPresets,
  ScreenSharePresets,
  RoomEvent,
  type RoomOptions,
} from "livekit-client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useI18n } from "@/lib/i18n";
import { Signal, SignalHigh, SignalLow, SignalMedium, WifiOff, Loader2, Mic, MicOff, Video as VideoIcon, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  url: string;
  token: string;
  video: boolean;
  onLeave: () => void;
};

/**
 * Adaptive stage:
 * - Screen share present → focus layout (big share + carousel of participants)
 * - 1–5 participants → symmetric grid
 * - 6+ participants → grid still, but tiles auto-shrink; CarouselLayout is used as overflow
 *   inside FocusLayoutContainer when a share is pinned.
 */
function Stage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const screenShareTracks = tracks.filter(
    (t) => t.source === Track.Source.ScreenShare
  );
  const cameraTracks = tracks.filter((t) => t.source === Track.Source.Camera);
  const pinned = usePinnedTracks() ?? [];
  const focusTrack = pinned[0] ?? screenShareTracks[0];

  if (focusTrack) {
    const carousel = cameraTracks.length > 0 ? cameraTracks : tracks;
    return (
      <FocusLayoutContainer style={{ height: "calc(100% - 128px)" }}>
        <CarouselLayout tracks={carousel}>
          <ParticipantTile />
        </CarouselLayout>
        <FocusLayout trackRef={focusTrack} />
      </FocusLayoutContainer>
    );
  }

  return (
    <GridLayout tracks={tracks} style={{ height: "calc(100% - 128px)" }}>
      <ParticipantTile />
    </GridLayout>
  );
}

/** Toasts + status announcements when any participant mutes / unmutes / shares screen. */
function MediaStateAnnouncer({ rtl }: { rtl: boolean }) {
  const room = useRoomContext();
  const seenRef = useRef(false);

  useEffect(() => {
    if (!room) return;

    const nameOf = (identity: string) => {
      const p = room.getParticipantByIdentity(identity);
      return p?.name || p?.identity || (rtl ? "مشارك" : "Participant");
    };

    const onMuted = (pub: any, participant: any) => {
      if (!seenRef.current) return;
      const isLocal = participant?.identity === room.localParticipant?.identity;
      const who = isLocal ? (rtl ? "أنت" : "You") : nameOf(participant.identity);
      if (pub.source === Track.Source.Microphone) {
        toast(rtl ? `${who}: كتم الميكروفون` : `${who} muted the mic`, { icon: "🎙️" });
      } else if (pub.source === Track.Source.Camera) {
        toast(rtl ? `${who}: أغلق الكاميرا` : `${who} turned camera off`, { icon: "📷" });
      }
    };
    const onUnmuted = (pub: any, participant: any) => {
      if (!seenRef.current) return;
      const isLocal = participant?.identity === room.localParticipant?.identity;
      const who = isLocal ? (rtl ? "أنت" : "You") : nameOf(participant.identity);
      if (pub.source === Track.Source.Microphone) {
        toast.success(rtl ? `${who}: فتح الميكروفون` : `${who} unmuted the mic`);
      } else if (pub.source === Track.Source.Camera) {
        toast.success(rtl ? `${who}: فتح الكاميرا` : `${who} turned camera on`);
      }
    };
    const onPub = (pub: any, participant: any) => {
      if (pub.source === Track.Source.ScreenShare) {
        const who = participant?.identity === room.localParticipant?.identity
          ? (rtl ? "أنت" : "You")
          : nameOf(participant.identity);
        toast.success(rtl ? `${who}: بدأ مشاركة الشاشة` : `${who} started screen share`, { icon: "🖥️" });
      }
    };
    const onUnpub = (pub: any, participant: any) => {
      if (pub.source === Track.Source.ScreenShare) {
        const who = participant?.identity === room.localParticipant?.identity
          ? (rtl ? "أنت" : "You")
          : nameOf(participant.identity);
        toast(rtl ? `${who}: أوقف مشاركة الشاشة` : `${who} stopped screen share`);
      }
    };

    room.on(RoomEvent.TrackMuted, onMuted);
    room.on(RoomEvent.TrackUnmuted, onUnmuted);
    room.on(RoomEvent.TrackPublished, onPub);
    room.on(RoomEvent.LocalTrackPublished, onPub as any);
    room.on(RoomEvent.TrackUnpublished, onUnpub);
    room.on(RoomEvent.LocalTrackUnpublished, onUnpub as any);

    // Skip initial join-time mute events
    const t = setTimeout(() => { seenRef.current = true; }, 1200);
    return () => {
      clearTimeout(t);
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

/** Small pill showing connection quality + reconnection state + participants count. */
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
      if (state === ConnectionState.Connected) {
        // silent — the recovery toast above handles quality bounce
      }
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

/** Live mic + camera status pill for the local participant. */
function LocalMediaStatusBadge({ rtl }: { rtl: boolean }) {
  const { localParticipant } = useLocalParticipant();
  const micEnabled = localParticipant?.isMicrophoneEnabled ?? false;
  const camEnabled = localParticipant?.isCameraEnabled ?? false;

  return (
    <div
      className="absolute top-4 right-4 z-20 flex items-center gap-2 rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur-xl shadow-lg"
      dir={rtl ? "rtl" : "ltr"}
    >
      <span
        className={cn(
          "flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors",
          micEnabled
            ? "bg-emerald-500/20 text-emerald-200"
            : "bg-red-500/25 text-red-200"
        )}
        title={rtl ? (micEnabled ? "الميكروفون مفتوح" : "الميكروفون مقفول") : micEnabled ? "Mic on" : "Mic muted"}
      >
        {micEnabled ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{rtl ? (micEnabled ? "مفتوح" : "مكتوم") : micEnabled ? "On" : "Muted"}</span>
      </span>
      <span
        className={cn(
          "flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors",
          camEnabled
            ? "bg-sky-500/20 text-sky-200"
            : "bg-white/10 text-white/70"
        )}
        title={rtl ? (camEnabled ? "الكاميرا مفتوحة" : "الكاميرا مقفولة") : camEnabled ? "Camera on" : "Camera off"}
      >
        {camEnabled ? <VideoIcon className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{rtl ? (camEnabled ? "مفتوحة" : "مقفولة") : camEnabled ? "On" : "Off"}</span>
      </span>
    </div>
  );
}

// Premium quality options: high-def video, echo cancel + noise suppression audio,
// simulcast for bandwidth resilience, dynacast to save CPU on unseen tracks,
// adaptiveStream for weak networks.
const roomOptions: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  publishDefaults: {
    simulcast: true,
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360, VideoPresets.h720],
    videoCodec: "vp9",
    dtx: true,
    red: true,
    audioPreset: {
      maxBitrate: 32_000,
      priority: "high",
    },
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
            <Stage />
            <RoomAudioRenderer />
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent pt-6 pb-3">
              <ControlBar
                variation="verbose"
                controls={{
                  microphone: true,
                  camera: true,
                  screenShare: true,
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
