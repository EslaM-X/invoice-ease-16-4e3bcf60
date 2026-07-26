import { useCallback, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { declineCall, joinCall, leaveCall } from "@/lib/calls.functions";
import { CallStage } from "./CallStage";
import { IncomingCallDialog } from "./IncomingCallDialog";
import { useIncomingCall } from "./useIncomingCall";

type ActiveCall = {
  call_id: string;
  url: string;
  token: string;
  video: boolean;
};

export function GlobalCallNotifier() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const joinCallFn = useServerFn(joinCall);
  const declineCallFn = useServerFn(declineCall);
  const leaveCallFn = useServerFn(leaveCall);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const { incoming, dismiss } = useIncomingCall(user?.id, activeCall?.call_id ?? null);

  const handleAccept = useCallback(async () => {
    if (!incoming) return;
    const call = incoming;
    dismiss();
    try {
      const joined = await joinCallFn({ data: { call_id: call.call_id } });
      setActiveCall({
        call_id: call.call_id,
        url: joined.url,
        token: joined.token,
        video: call.mode === "video",
      });
    } catch (error: any) {
      toast.error(error?.message || (lang === "ar" ? "تعذّر الانضمام للمكالمة" : "Could not join call"));
    }
  }, [dismiss, incoming, joinCallFn, lang]);

  const handleDecline = useCallback(async () => {
    if (!incoming) return;
    const callId = incoming.call_id;
    dismiss();
    try { await declineCallFn({ data: { call_id: callId } }); } catch { /* ignore */ }
  }, [declineCallFn, dismiss, incoming]);

  const handleLeave = useCallback(async () => {
    if (!activeCall) return;
    const callId = activeCall.call_id;
    setActiveCall(null);
    try { await leaveCallFn({ data: { call_id: callId } }); } catch { /* ignore */ }
  }, [activeCall, leaveCallFn]);

  if (!user) return null;

  return (
    <>
      <IncomingCallDialog call={incoming} onAccept={handleAccept} onDecline={handleDecline} />
      {activeCall && (
        <CallStage
          open={!!activeCall}
          onClose={() => setActiveCall(null)}
          url={activeCall.url}
          token={activeCall.token}
          video={activeCall.video}
          onLeave={handleLeave}
        />
      )}
    </>
  );
}