import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribe to realtime changes on a table. Calls `onChange` for every
 * INSERT/UPDATE/DELETE coming from any session (including other users).
 * Also reacts to global `app:resync` events (manual refresh, reconnection)
 * and to tab visibility regaining focus, so lists self-heal after offline.
 */
export function useRealtimeTable(
  table: string,
  onChange: (payload: { eventType: "INSERT" | "UPDATE" | "DELETE"; new: any; old: any }) => void,
  deps: any[] = []
) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    const fire = (eventType: "INSERT" | "UPDATE" | "DELETE" = "UPDATE") =>
      cbRef.current({ eventType, new: null, old: null });

    const channel = supabase
      .channel(`rt-${table}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload: any) => {
          cbRef.current({
            eventType: payload.eventType,
            new: payload.new,
            old: payload.old,
          });
        }
      )
      .subscribe();

    const onResync = () => fire();
    const onVis = () => { if (!document.hidden) fire(); };
    window.addEventListener("app:resync", onResync);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("app:resync", onResync);
      document.removeEventListener("visibilitychange", onVis);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, ...deps]);
}
