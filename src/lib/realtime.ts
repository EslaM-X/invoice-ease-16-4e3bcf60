import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

type Payload = { eventType: "INSERT" | "UPDATE" | "DELETE"; new: any; old: any };

/**
 * Subscribe to realtime changes on a table. Reliable across network drops.
 * Includes a small debounce to prevent "event storms" (e.g. multiple items inserted at once)
 * from triggering dozens of expensive refetches in the same frame.
 */
export function useRealtimeTable(
  table: string,
  onChange: (payload: Payload) => void,
  deps: any[] = []
) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let attempt = 0;
    let backoffTimer: ReturnType<typeof setTimeout> | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    const fire = (payload: Payload = { eventType: "UPDATE", new: null, old: null }) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        if (!cancelled) cbRef.current(payload);
      }, 150); // 150ms debounce
    };

    const cleanupChannel = () => {
      if (channel) {
        try { supabase.removeChannel(channel); } catch {}
        channel = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      attempt = Math.min(attempt + 1, 6);
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
          fire({
            eventType: payload.eventType,
            new: payload.new,
            old: payload.old,
          });
        }
      );

      ch.subscribe((status: string) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
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
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      window.removeEventListener("app:resync", onResync);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis);
      cleanupChannel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, ...deps]);
}
