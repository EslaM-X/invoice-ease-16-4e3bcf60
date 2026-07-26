import { useEffect } from "react";
import { logPwaEvent } from "@/lib/pwa-diagnostics";
import { shouldDisablePwaFeatures } from "@/lib/pwa-runtime";
import {
  fetchLatestVersion,
  recordActivation,
  recordCurrentVersion,
} from "@/lib/pwa-version";

const SW_PATH = "/sw.js";

/**
 * Phase 1 PWA bootstrap — registers the canonical service worker at /sw.js.
 */
export function PwaVersionGuard() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      logPwaEvent("info", "sw_unsupported");
      return;
    }

    const skipRegister = shouldDisablePwaFeatures();
    const inIframe = (() => {
      try { return window.self !== window.top; } catch { return true; }
    })();
    const isPreviewHost = skipRegister && !inIframe;
    let refreshing = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      logPwaEvent("info", "sw_controller_changed_reload");
      window.location.reload();
    };

    const run = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        logPwaEvent("info", "sw_registrations_found", { count: registrations.length, inIframe, isPreviewHost });
        
        // Cleanup foreign/old workers
        for (const reg of registrations) {
          const scriptUrl = reg.active?.scriptURL ?? reg.waiting?.scriptURL ?? reg.installing?.scriptURL ?? "";
          const isOurs = scriptUrl.endsWith(SW_PATH) || scriptUrl.endsWith("/service-worker.js");
          if (!isOurs || skipRegister) {
            const ok = await reg.unregister();
            logPwaEvent(ok ? "info" : "warn", "sw_unregister", { scriptUrl, ok });
          }
        }

        if (skipRegister) {
          logPwaEvent("info", "sw_skip_register", { reason: inIframe ? "iframe" : "preview-host" });
          return;
        }

        navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

        // Register the canonical SW
        const reg = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
        logPwaEvent("info", "sw_register_ok", { scope: reg.scope });
        await reg.update().catch((error) => {
          logPwaEvent("warn", "sw_update_check_failed", String(error));
        });
        
        // Auto-skip-waiting when an update is found
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          logPwaEvent("info", "sw_update_found");
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              logPwaEvent("info", "sw_update_available_skipping_waiting");
              newWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });

        const checkForUpdate = (reason: string) => {
          void reg.update().catch((error) =>
            logPwaEvent("warn", "sw_update_check_failed", { reason, error: String(error) }),
          );
        };

        // Fast polling — every 30s while the tab is visible.
        intervalId = setInterval(() => {
          if (document.visibilityState === "visible") checkForUpdate("interval");
        }, 1000 * 30);

        // Instant check whenever the user returns to the app (unlocking phone,
        // switching tabs, coming back online). This is what actually delivers
        // deploys "live" on mobile.
        onVisibility = () => {
          if (document.visibilityState === "visible") checkForUpdate("visibility");
        };
        onFocus = () => checkForUpdate("focus");
        onOnline = () => checkForUpdate("online");
        onPageShow = (e: PageTransitionEvent) => {
          if (e.persisted) checkForUpdate("pageshow-bfcache");
        };
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("focus", onFocus);
        window.addEventListener("online", onOnline);
        window.addEventListener("pageshow", onPageShow);

      } catch (error) {
        logPwaEvent("error", "sw_bootstrap_failed", String(error));
      }
    };

    let onVisibility: (() => void) | null = null;
    let onFocus: (() => void) | null = null;
    let onOnline: (() => void) | null = null;
    let onPageShow: ((e: PageTransitionEvent) => void) | null = null;

    void run();

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      if (intervalId) clearInterval(intervalId);
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
      if (onFocus) window.removeEventListener("focus", onFocus);
      if (onOnline) window.removeEventListener("online", onOnline);
      if (onPageShow) window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return null;
}
