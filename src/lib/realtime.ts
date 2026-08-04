import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

type Payload = { eventType: "INSERT" | "UPDATE" | "DELETE"; new: any; old: any };

/**
 * Realtime-js reuses channels with the same topic. If a second component asks
 * for the same topic after the first has subscribed, adding `.on()` throws.
 * Always use a per-mount topic for component-local listeners.
 */
export function uniqueRealtimeTopic(prefix: string): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9:_-]/g, "-");
  const cryptoId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${safePrefix}-${cryptoId}`;
}

// Debounce window for coalescing realtime bursts. A few hundred ms is
// imperceptible to humans but collapses dozens of "items inserted at once"
// events into a single refetch, dramatically reducing re-renders.
const DEBOUNCE_MS = 800;
// If a burst keeps firing, still flush at least once per this window so the
// UI never stalls behind continuous activity.
const MAX_WAIT_MS = 2500;

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

    let generation = 0;

    const scheduleReconnect = () => {
      if (cancelled || backoffTimer) return;
      // Don't spin while the tab is hidden or the device is offline — the
      // focus/online listeners below will reconnect when it makes sense.
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (attempt >= 6) return; // give up quietly until focus/online
      attempt = attempt + 1;
      const delay = Math.min(1000 * 2 ** (attempt - 1), 30000);
      hadFailure = true;
      emit("reconnecting", { attempt, delayMs: delay });
      backoffTimer = setTimeout(() => {
        backoffTimer = null;
        connect();
      }, delay);
    };


    const connect = () => {
      if (cancelled) return;
      generation += 1;
      const gen = generation;
      cleanupChannel();
      const ch = supabase.channel(uniqueRealtimeTopic(`rt-${table}`));
      channel = ch;

      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload: any) => {
          if (cancelled || gen !== generation) return;
          fire({
            eventType: payload.eventType,
            new: payload.new,
            old: payload.old,
          });
        }
      );

      ch.subscribe((status: string) => {
        // Ignore callbacks from superseded channels: removeChannel() emits
        // CLOSED on the old channel and would otherwise trigger a storm.
        if (cancelled || gen !== generation) return;
        if (status === "SUBSCRIBED") {
          attempt = 0;
          if (backoffTimer) { clearTimeout(backoffTimer); backoffTimer = null; }
          if (hadFailure) { emit("reconnected"); hadFailure = false; }
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
    // Desktop/mobile app windows can stay "visible" while the socket dies in
    // the background — re-check the channel on focus and bfcache restore too.
    const ensureJoined = () => {
      if (cancelled) return;
      if (!channel || (channel as any).state !== "joined") {
        attempt = 0;
        connect();
      } else {
        fire();
      }
    };
    const onFocus = () => ensureJoined();
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) ensureJoined(); };

    window.addEventListener("app:resync", onResync);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      if (backoffTimer) clearTimeout(backoffTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (maxWaitTimer) clearTimeout(maxWaitTimer);
      window.removeEventListener("app:resync", onResync);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
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
  deps: any[] = [],
  options: { debounceMs?: number; maxWaitMs?: number } = {}
) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;

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
      debounceTimer = setTimeout(flush, debounceMs);
      if (!maxWaitTimer) maxWaitTimer = setTimeout(flush, maxWaitMs);
    };

    const cleanup = () => {
      while (channels.length) {
        const ch = channels.pop();
        if (ch) { try { supabase.removeChannel(ch); } catch {} }
      }
    };

    // Reconnect bookkeeping — mirrors useRealtimeTable so multi-table pages
    // recover from dropped sockets instead of silently going stale.
    let attempt = 0;
    let backoffTimer: ReturnType<typeof setTimeout> | null = null;
    let hadFailure = false;

    const emit = (status: "reconnecting" | "reconnected" | "failed", detail: Record<string, unknown> = {}) => {
      try {
        window.dispatchEvent(
          new CustomEvent("app:realtime-status", { detail: { table: tables.join(","), status, ...detail } }),
        );
      } catch { /* noop for SSR */ }
    };

    let generation = 0;

    const scheduleReconnect = () => {
      if (cancelled || backoffTimer) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (attempt >= 6) return; // stop retrying until focus/online
      attempt = attempt + 1;
      const delay = Math.min(1000 * 2 ** (attempt - 1), 30000);
      hadFailure = true;
      emit("reconnecting", { attempt, delayMs: delay });
      backoffTimer = setTimeout(() => {
        backoffTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (cancelled) return;
      generation += 1;
      const gen = generation;
      cleanup();
      for (const table of tables) {
        const ch = supabase.channel(uniqueRealtimeTopic(`rtb-${table}`));
        ch.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          (payload: any) => {
            if (cancelled || gen !== generation) return;
            fire(table, {
              eventType: payload.eventType,
              new: payload.new,
              old: payload.old,
            });
          },
        );
        ch.subscribe((status: string) => {
          // Superseded channels emit CLOSED when removed — ignore them,
          // otherwise every reconnect triggers another reconnect.
          if (cancelled || gen !== generation) return;
          if (status === "SUBSCRIBED") {
            attempt = 0;
            if (backoffTimer) { clearTimeout(backoffTimer); backoffTimer = null; }
            if (hadFailure) { emit("reconnected"); hadFailure = false; }
            // Trigger an initial fetch (once per table is fine — they coalesce).
            fire(table, { eventType: "UPDATE", new: null, old: null });
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            scheduleReconnect();
          }
        });
        channels.push(ch);
      }
    };


    connect();

    const allJoined = () => channels.length > 0 && channels.every((ch) => (ch as any).state === "joined");

    const onResync = () => fire(lastTable, { eventType: "UPDATE", new: null, old: null });
    const onVis = () => {
      if (document.hidden) return;
      if (pendingWhileHidden) { pendingWhileHidden = false; flush(); }
      else fire(lastTable, { eventType: "UPDATE", new: null, old: null });
      if (!allJoined()) { attempt = 0; connect(); }
    };
    const onOnline = () => { attempt = 0; connect(); };
    const onFocus = () => {
      if (!allJoined()) { attempt = 0; connect(); }
      else fire(lastTable, { eventType: "UPDATE", new: null, old: null });
    };
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) { attempt = 0; connect(); } };

    window.addEventListener("app:resync", onResync);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (maxWaitTimer) clearTimeout(maxWaitTimer);
      if (backoffTimer) clearTimeout(backoffTimer);
      window.removeEventListener("app:resync", onResync);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVis);
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join("|"), ...deps]);
}
