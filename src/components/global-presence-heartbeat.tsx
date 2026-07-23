import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { updatePresence } from "@/lib/chat.functions";
import { useAuth } from "@/lib/auth";

/**
 * Global presence heartbeat.
 *
 * Ensures every signed-in user is reported as "online" across the whole app,
 * not only inside the team-chat page. This is what powers the "online now"
 * count in Message Info, the presence dots on avatars, and the
 * `chat_presence.last_seen_at` freshness used by delivery/seen inference.
 *
 * - Pings once on mount, then every 45s while the tab is visible.
 * - Switches to "away" when the tab is hidden, back to "online" on focus.
 * - Fires a best-effort "offline" beacon on page unload.
 */
export function GlobalPresenceHeartbeat() {
  const { user } = useAuth();
  const ping = useServerFn(updatePresence);

  useEffect(() => {
    if (!user?.id) return;

    let stopped = false;
    const safePing = (status: "online" | "away" | "offline") => {
      if (stopped) return;
      try {
        const p = ping({ data: { status } }) as unknown as Promise<unknown> | undefined;
        if (p && typeof (p as Promise<unknown>).catch === "function") {
          (p as Promise<unknown>).catch(() => {});
        }
      } catch {
        /* swallow — presence must never break the app */
      }
    };

    // Initial ping.
    safePing("online");

    // Periodic heartbeat.
    const HEARTBEAT_MS = 45_000;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") safePing("online");
      else safePing("away");
    }, HEARTBEAT_MS);

    const onVisibility = () => {
      safePing(document.visibilityState === "visible" ? "online" : "away");
    };
    const onFocus = () => safePing("online");
    const onBlur = () => safePing("away");
    const onBeforeUnload = () => safePing("offline");

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onBeforeUnload);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onBeforeUnload);
      safePing("offline");
    };
  }, [user?.id, ping]);

  return null;
}
