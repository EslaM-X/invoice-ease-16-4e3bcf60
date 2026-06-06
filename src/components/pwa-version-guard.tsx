import { useEffect } from "react";
import { logPwaEvent } from "@/lib/pwa-diagnostics";
import { shouldDisablePwaFeatures } from "@/lib/pwa-runtime";

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

    const run = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        
        // Cleanup foreign/old workers
        for (const reg of registrations) {
          const scriptUrl = reg.active?.scriptURL ?? reg.waiting?.scriptURL ?? reg.installing?.scriptURL ?? "";
          const isOurs = scriptUrl.endsWith(SW_PATH) || scriptUrl.endsWith("/service-worker.js");
          if (!isOurs || skipRegister) {
            await reg.unregister();
            logPwaEvent("info", "sw_unregister", { scriptUrl });
          }
        }

        if (skipRegister) {
          if ("caches" in window) {
            const names = await caches.keys();
            for (const name of names) await caches.delete(name);
          }
          return;
        }

        // Handle reloads when a new service worker takes control
        let refreshing = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (refreshing) return;
          refreshing = true;
          logPwaEvent("info", "sw_controller_changed_reload");
          window.location.reload();
        });

        // Register the canonical SW
        const reg = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
        
        // Auto-skip-waiting when an update is found
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              logPwaEvent("info", "sw_update_available_skipping_waiting");
              newWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });

        // Check for updates frequently
        setInterval(() => { reg.update(); }, 1000 * 60 * 60); // Every hour
        
      } catch (error) {
        logPwaEvent("error", "sw_bootstrap_failed", String(error));
      }
    };

    void run();
  }, []);

  return null;
}
