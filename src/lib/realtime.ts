import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

type Payload = { eventType: "INSERT" | "UPDATE" | "DELETE"; new: any; old: any };

// Debounce window for coalescing realtime bursts. A few hundred ms is
// imperceptible to humans but collapses dozens of "items inserted at once"
// events into a single refetch, dramatically reducing re-renders.
const DEBOUNCE_MS = 500;
// If a burst keeps firing, still flush at least once per this window so the
// UI never stalls behind continuous activity.
const MAX_WAIT_MS = 1500;

/**
 * Subscribe to realtime changes on a table. Reliable across network drops.
 *
 * - Debounces bursts (multiple inserts / cascade updates) into one refetch.
 * - Skips firing while the tab is hidden (saves CPU + network); when the tab
 *   becomes visible again we trigger a single refresh.
 * - Auto-reconnects with exponential backoff after disconnects.
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
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingPayload: Payload | null = null;
    let pendingWhileHidden = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    let hadFailure = false;

    // Emit a lightweight status event so a top-level toaster can surface
    // realtime health without every subscription writing its own toasts.
    // status: "reconnecting" | "reconnected" | "failed"
    const emit = (status: "reconnecting" | "reconnected" | "failed", detail: Record<string, unknown> = {}) => {
      try {
        window.dispatchEvent(
          new CustomEvent("app:realtime-status", { detail: { table, status, ...detail } }),
        );
      } catch { /* noop for SSR */ }
    };

    const flush = () => {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      if (maxWaitTimer) { clearTimeout(maxWaitTimer); maxWaitTimer = null; }
      const payload = pendingPayload ?? { eventType: "UPDATE" as const, new: null, old: null };
      pendingPayload = null;
      if (cancelled) return;
      // Skip work for hidden tabs — refresh once they come back.
      if (typeof document !== "undefined" && document.hidden) {
        pendingWhileHidden = true;
        return;
      }
      try { cbRef.current(payload); } catch { /* swallow */ }
    };

    const fire = (payload: Payload = { eventType: "UPDATE", new: null, old: null }) => {
      pendingPayload = payload;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(flush, DEBOUNCE_MS);
      if (!maxWaitTimer) {
        maxWaitTimer = setTimeout(flush, MAX_WAIT_MS);
      }
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
      hadFailure = true;
      emit("reconnecting", { attempt, delayMs: delay });
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
        if (status === "SUBSCRIBED") {
          attempt = 0;
          if (backoffTimer) { clearTimeout(backoffTimer); backoffTimer = null; }
          if (hadFailure) { emit("reconnected"); hadFailure = false; }
          fire();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (attempt >= 6) emit("failed", { attempt });
          scheduleReconnect();
        }
      });
    };

    connect();

    const onResync = () => fire();
    const onVis = () => {
      if (document.hidden) return;
      // Coming back to the tab — flush anything that was queued while hidden.
      if (pendingWhileHidden || pendingPayload) {
        pendingWhileHidden = false;
        flush();
      } else {
        fire();
      }
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
      if (debounceTimer) clearTimeout(debounceTimer);
      if (maxWaitTimer) clearTimeout(maxWaitTimer);
      window.removeEventListener("app:resync", onResync);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis);
      cleanupChannel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, ...deps]);
}

/**
 * Subscribe to realtime changes across MULTIPLE tables, but coalesce every
 * event into a single debounced callback. Use this on pages that aggregate
 * data from many tables (e.g. fulfillment, in-transit) so one network burst
 * triggers one refetch instead of one per table.
 *
 * The callback receives the table name that fired most recently — useful for
 * lightweight branching, but most callers just call their `load()` function.
 */
export function useBatchedRealtimeTables(
  tables: string[],
  onChange: (table: string, payload: Payload) => void,
  deps: any[] = []
) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
    let lastTable = tables[0] ?? "";
    let lastPayload: Payload = { eventType: "UPDATE", new: null, old: null };
    let pendingWhileHidden = false;
    const channels: ReturnType<typeof supabase.channel>[] = [];

    const flush = () => {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      if (maxWaitTimer) { clearTimeout(maxWaitTimer); maxWaitTimer = null; }
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) {
        pendingWhileHidden = true;
        return;
      }
      try { cbRef.current(lastTable, lastPayload); } catch { /* swallow */ }
    };

    const fire = (table: string, payload: Payload) => {
      lastTable = table;
      lastPayload = payload;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(flush, DEBOUNCE_MS);
      if (!maxWaitTimer) maxWaitTimer = setTimeout(flush, MAX_WAIT_MS);
    };

    const cleanup = () => {
      while (channels.length) {
        const ch = channels.pop();
        if (ch) { try { supabase.removeChannel(ch); } catch {} }
      }
    };

    const connect = () => {
      cleanup();
      for (const table of tables) {
        const ch = supabase.channel(`rtb-${table}-${Math.random().toString(36).slice(2, 8)}`);
        ch.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          (payload: any) => fire(table, {
            eventType: payload.eventType,
            new: payload.new,
            old: payload.old,
          }),
        );
        ch.subscribe((status: string) => {
          if (status === "SUBSCRIBED") {
            // Trigger an initial fetch (once per table is fine — they coalesce).
            fire(table, { eventType: "UPDATE", new: null, old: null });
          }
        });
        channels.push(ch);
      }
    };

    connect();

    const onResync = () => fire(lastTable, { eventType: "UPDATE", new: null, old: null });
    const onVis = () => {
      if (document.hidden) return;
      if (pendingWhileHidden) { pendingWhileHidden = false; flush(); }
      else fire(lastTable, { eventType: "UPDATE", new: null, old: null });
    };
    const onOnline = () => connect();

    window.addEventListener("app:resync", onResync);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (maxWaitTimer) clearTimeout(maxWaitTimer);
      window.removeEventListener("app:resync", onResync);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis);
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join("|"), ...deps]);
}
