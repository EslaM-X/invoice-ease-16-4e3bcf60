import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

type Payload = { eventType: "INSERT" | "UPDATE" | "DELETE"; new: any; old: any };

/**
 * Subscribe to realtime changes on a table. Reliable across network drops:
 *
 * - Tracks CHANNEL_ERROR / TIMED_OUT / CLOSED and rebuilds the channel with
 *   exponential backoff (capped). The `supabase-js` realtime client also
 *   reconnects internally, but channels can end up in a permanently failed
 *   state on long offlines — recreating the channel is the safe path.
 * - On every successful (re)subscribe, fires `onChange` so callers refetch
 *   and recover any events that were missed while disconnected.
 * - Reacts to `app:resync` and visibility regaining focus.
 */
export function useRealtimeTable(
  table: string,
  onChange: (payload: Payload) => void,
  deps: any[] = []
) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    let attempt = 0;
    let backoffTimer: ReturnType<typeof setTimeout> | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    const fire = (eventType: Payload["eventType"] = "UPDATE") =>
      cbRef.current({ eventType, new: null, old: null });

    const cleanupChannel = () => {
      if (channel) {
        try { supabase.removeChannel(channel); } catch {}
        channel = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      attempt = Math.min(attempt + 1, 6);
      // 1s, 2s, 4s, 8s, 16s, 30s (cap)
      const delay = Math.min(1000 * 2 ** (attempt - 1), 30000);
      if (backoffTimer) clearTimeout(backoffTimer);
      backoffTimer = setTimeout(connect, delay);
    };

    const connect = () => {
      if (cancelled) return;
      cleanupChannel();
      const ch = supabase.channel(`rt-${table}-${Math.random().toString(36).slice(2, 8)}`);
      channel = ch;

      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload: any) => {
          cbRef.current({
            eventType: payload.eventType,
            new: payload.new,
            old: payload.old,
          });
        }
      );

      ch.subscribe((status: string) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          // Reset backoff and refetch — recovers events missed during downtime
          attempt = 0;
          if (backoffTimer) { clearTimeout(backoffTimer); backoffTimer = null; }
          fire();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          scheduleReconnect();
        }
      });
    };

    connect();

    const onResync = () => fire();
    const onVis = () => {
      if (document.hidden) return;
      fire();
      // If channel went stale while hidden, force a reconnect cycle
      if (!channel || (channel as any).state !== "joined") {
        attempt = 0;
        connect();
      }
    };
    const onOnline = () => { attempt = 0; connect(); };

    window.addEventListener("app:resync", onResync);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      if (backoffTimer) clearTimeout(backoffTimer);
      window.removeEventListener("app:resync", onResync);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis);
      cleanupChannel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, ...deps]);
}
