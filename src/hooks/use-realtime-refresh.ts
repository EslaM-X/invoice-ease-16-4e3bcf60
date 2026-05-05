import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

type Tables = string | string[];

/**
 * Subscribes to Postgres changes on one or more tables and calls `onChange`
 * whenever a row is inserted/updated/deleted. Also listens for the global
 * `app:resync` event (dispatched by the offline banner / manual refresh).
 *
 * Debounces bursts so multiple rapid changes only trigger one refetch.
 */
export function useRealtimeRefresh(
  tables: Tables,
  onChange: () => void,
  opts: { debounceMs?: number; enabled?: boolean } = {}
) {
  const { debounceMs = 250, enabled = true } = opts;
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    const list = Array.isArray(tables) ? tables : [tables];
    if (list.length === 0) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cbRef.current?.(), debounceMs);
    };

    const channel = supabase.channel("rt-" + list.join("-") + "-" + Math.random().toString(36).slice(2, 7));
    for (const t of list) {
      channel.on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: t },
        () => fire()
      );
    }
    channel.subscribe();

    const onResync = () => fire();
    window.addEventListener("app:resync", onResync);
    const onVis = () => { if (!document.hidden) fire(); };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("app:resync", onResync);
      document.removeEventListener("visibilitychange", onVis);
      try { supabase.removeChannel(channel); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(tables) ? tables.join(",") : tables, enabled, debounceMs]);
}
