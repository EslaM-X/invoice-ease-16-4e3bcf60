import { useEffect } from "react";
import "@livekit/components-styles";
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  ControlBar,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useI18n } from "@/lib/i18n";

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
    <GridLayout tracks={tracks} style={{ height: "calc(100% - 88px)" }}>
      <ParticipantTile />
    </GridLayout>
  );
}

export function CallStage({ open, onClose, url, token, video, onLeave }: Props) {
  const { lang } = useI18n();
  const rtl = lang === "ar";

  // Ensure body scroll lock while call is open
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
            data-lk-theme="default"
            style={{ height: "100dvh", background: "black" }}
            onDisconnected={() => {
              onLeave();
              onClose();
            }}
          >
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
