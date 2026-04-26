import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribe to realtime changes on a table. Calls `onChange` for every
 * INSERT/UPDATE/DELETE coming from any session (including other users).
 * Cleans up automatically on unmount.
 */
export function useRealtimeTable(
  table: string,
  onChange: (payload: { eventType: "INSERT" | "UPDATE" | "DELETE"; new: any; old: any }) => void,
  deps: any[] = []
) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
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
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, ...deps]);
}
