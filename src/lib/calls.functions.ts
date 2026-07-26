import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  cancelCallImpl,
  declineCallImpl,
  joinCallImpl,
  leaveCallImpl,
  listMyCallHistoryImpl,
  listRoomCallsImpl,
  refreshCallTokenImpl,
  startCallImpl,
} from "./calls.server";

/** Start a new call in a room. Creates chat_calls + participant rows + a system chat message. */
export const startCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { room_id: string; mode: "audio" | "video" }) => {
    if (!d?.room_id || !["audio", "video"].includes(d?.mode)) {
      throw new Error("room_id ونمط المكالمة مطلوبان");
    }
    return d;
  })
  .handler(startCallImpl);

/** Accept an incoming call — mint a token and mark self as joined. */
export const joinCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { call_id: string }) => {
    if (!d?.call_id) throw new Error("call_id مطلوب");
    return d;
  })
  .handler(joinCallImpl);

/** Re-mint a fresh LiveKit token for a still-running call. */
export const refreshCallToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { call_id: string }) => {
    if (!d?.call_id) throw new Error("call_id مطلوب");
    return d;
  })
  .handler(refreshCallTokenImpl);

/** Decline an incoming call. */
export const declineCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { call_id: string }) => d)
  .handler(declineCallImpl);

/** Initiator cancels a ringing call before anyone joins. */
export const cancelCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { call_id: string }) => d)
  .handler(cancelCallImpl);

/** Leave / end the call — the last to leave finalises status + duration. */
export const leaveCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { call_id: string }) => d)
  .handler(leaveCallImpl);

/** List recent calls for a room. */
export const listRoomCalls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { room_id: string; limit?: number }) => d)
  .handler(listRoomCallsImpl);

/**
 * List every call across every room the current user is a member of,
 * with per-participant details. For the Call History page.
 */
export const listMyCallHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number } | undefined) => d ?? {})
  .handler(listMyCallHistoryImpl);
