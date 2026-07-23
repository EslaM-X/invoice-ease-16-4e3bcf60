import { useEffect, useRef } from "react";
import "@livekit/components-styles";
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  ControlBar,
  RoomAudioRenderer,
  useTracks,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
} from "@livekit/components-react";
import {
  Track,
  ConnectionState,
  ConnectionQuality,
  VideoPresets,
  RoomEvent,
  type RoomOptions,
} from "livekit-client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useI18n } from "@/lib/i18n";
import { Signal, SignalHigh, SignalLow, SignalMedium, WifiOff, Loader2 } from "lucide-react";
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

function Stage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );
  return (
    <GridLayout tracks={tracks} style={{ height: "calc(100% - 128px)" }}>
      <ParticipantTile />
    </GridLayout>
  );
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
            <Stage />
            <RoomAudioRenderer />
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent pt-6 pb-3">
              <ControlBar
                variation="verbose"
                controls={{
                  microphone: true,
                  camera: video,
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
