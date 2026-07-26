import { useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff, Video } from "lucide-react";
import { LuxuryAvatar } from "@/components/chat/luxury-avatar";
import { useI18n } from "@/lib/i18n";
import { playIphoneRingLoop } from "@/lib/push";

export type IncomingCall = {
  call_id: string;
  room_id: string;
  mode: "audio" | "video";
  initiator_id: string;
  initiator_name?: string | null;
  initiator_avatar?: string | null;
  room_name?: string | null;
};

type Props = {
  call: IncomingCall | null;
  onAccept: () => void;
  onDecline: () => void;
};

export function IncomingCallDialog({ call, onAccept, onDecline }: Props) {
  const { lang } = useI18n();
  const rtl = lang === "ar";

  // iPhone-style ring loop + gentle vibration cadence.
  useEffect(() => {
    if (!call) return;
    const stopRing = playIphoneRingLoop();
    let vibrateIv: number | null = null;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      const buzz = () => { try { (navigator as any).vibrate?.([300, 200, 300, 1200]); } catch {} };
      buzz();
      vibrateIv = window.setInterval(buzz, 2000);
    }
    // Auto-miss after 30s
    const to = window.setTimeout(() => onDecline(), 30_000);
    return () => {
      stopRing();
      if (vibrateIv) window.clearInterval(vibrateIv);
      clearTimeout(to);
      try { (navigator as any).vibrate?.(0); } catch {}
    };
  }, [call, onDecline]);

  if (!call) return null;
  const name = call.initiator_name ?? (rtl ? "متصل" : "Caller");

  return (
    <Dialog open={!!call} onOpenChange={(o) => !o && onDecline()}>
      <DialogContent
        className="max-w-sm rounded-3xl overflow-hidden border-primary/20"
        dir={rtl ? "rtl" : "ltr"}
      >
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="relative">
            <span className="absolute inset-0 rounded-full animate-ping bg-primary/30" />
            <LuxuryAvatar url={call.initiator_avatar} name={name} size={128} ring="gold" showSkeleton={false} />
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold">{name}</div>
            <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1 justify-center">
              {call.mode === "video" ? <Video className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
              {rtl
                ? call.mode === "video" ? "مكالمة فيديو واردة..." : "مكالمة صوت واردة..."
                : call.mode === "video" ? "Incoming video call..." : "Incoming voice call..."}
            </div>
            {call.room_name && (
              <div className="text-xs text-muted-foreground mt-1">{call.room_name}</div>
            )}
          </div>
          <div className="flex items-center gap-6 mt-2">
            <Button
              size="icon"
              className="h-14 w-14 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg"
              onClick={onDecline}
              aria-label="Decline"
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
            <Button
              size="icon"
              className="h-14 w-14 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg animate-pulse"
              onClick={onAccept}
              aria-label="Accept"
            >
              {call.mode === "video" ? <Video className="h-6 w-6" /> : <Phone className="h-6 w-6" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
