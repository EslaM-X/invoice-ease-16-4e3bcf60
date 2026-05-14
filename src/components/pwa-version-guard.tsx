import { useEffect } from "react";
import { logPwaEvent } from "@/lib/pwa-diagnostics";

const SW_PATH = "/sw.js";

/**
 * Phase 1 PWA bootstrap — registers the canonical service worker at /sw.js.
 *
 * Safety guarantees:
 *  - Never registers inside an iframe (Lovable editor preview).
 *  - Never registers on Lovable preview / sandbox hosts.
 *  - Unregisters any FOREIGN service workers (different scriptURL than ours)
 *    so legacy installations from prior versions get cleaned up.
 *  - Logs everything to /diagnostics for inspection.
 */
export function PwaVersionGuard() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      logPwaEvent("info", "sw_unsupported");
      return;
    }

    // Guard 1: never inside an iframe (Lovable editor preview)
    let inIframe = false;
    try { inIframe = window.self !== window.top; } catch { inIframe = true; }

    // Guard 2: skip Lovable preview / sandbox hosts
    const host = window.location.hostname;
    const isPreviewHost =
      host.includes("id-preview--") ||
      host.includes("preview--") ||
      host.includes("lovableproject.com") ||
      host.includes("lovableproject-dev.com") ||
      host.includes("lovable.dev");

    const skipRegister = inIframe || isPreviewHost;

    const run = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        logPwaEvent("info", "sw_registrations_found", {
          count: registrations.length,
          inIframe,
          isPreviewHost,
        });

        // Always unregister foreign SWs (different scriptURL than current /sw.js).
        for (const reg of registrations) {
          const scriptUrl =
            reg.active?.scriptURL ??
            reg.waiting?.scriptURL ??
            reg.installing?.scriptURL ??
            "";
          const isOurs =
            scriptUrl.endsWith(SW_PATH) ||
            scriptUrl.endsWith("/service-worker.js");
          if (!isOurs || skipRegister) {
            try {
              const ok = await reg.unregister();
              logPwaEvent(ok ? "info" : "warn", "sw_unregister", { scriptUrl, ok });
            } catch (err) {
              logPwaEvent("error", "sw_unregister_failed", String(err));
            }
          }
        }

        if (skipRegister) {
          // In preview/iframe also clear caches to keep the editor pristine.
          if ("caches" in window) {
            const names = await caches.keys();
            for (const name of names) {
              try { await caches.delete(name); } catch {}
            }
          }
          logPwaEvent("info", "sw_skip_register", { reason: inIframe ? "iframe" : "preview-host" });
          return;
        }

        // Register the canonical SW.
        const reg = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
        logPwaEvent("info", "sw_register_ok", { scope: reg.scope });

        // Auto-update on new versions.
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              installing.postMessage?.({ type: "SKIP_WAITING" });
              logPwaEvent("info", "sw_update_activated");
            }
          });
        });
      } catch (error) {
        logPwaEvent("error", "sw_bootstrap_failed", String(error));
        console.warn("[pwa] bootstrap failed", error);
      }
    };

    void run();
  }, []);

  return null;
}
