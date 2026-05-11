import { useEffect } from "react";
import { logPwaEvent } from "@/lib/pwa-diagnostics";

/**
 * Stability guard: actively removes any previously-installed service worker
 * and clears all caches on every device. Logs every step to the PWA
 * diagnostics log so the user can inspect activity at /diagnostics.
 */
export function PwaVersionGuard() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      logPwaEvent("info", "sw_unsupported");
      return;
    }

    const cleanup = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        logPwaEvent("info", "sw_registrations_found", { count: registrations.length });

        for (const registration of registrations) {
          try {
            const scriptUrl =
              registration.active?.scriptURL ??
              registration.waiting?.scriptURL ??
              registration.installing?.scriptURL ??
              "";
            const ok = await registration.unregister();
            logPwaEvent(ok ? "info" : "warn", "sw_unregister", { scriptUrl, ok });
          } catch (err) {
            logPwaEvent("error", "sw_unregister_failed", String(err));
          }
        }

        if ("caches" in window) {
          const cacheNames = await caches.keys();
          logPwaEvent("info", "caches_found", { count: cacheNames.length, names: cacheNames });
          for (const name of cacheNames) {
            try {
              const ok = await caches.delete(name);
              logPwaEvent(ok ? "info" : "warn", "cache_delete", { name, ok });
            } catch (err) {
              logPwaEvent("error", "cache_delete_failed", { name, err: String(err) });
            }
          }
        }

        logPwaEvent("info", "cleanup_done");
      } catch (error) {
        logPwaEvent("error", "cleanup_failed", String(error));
        console.warn("[pwa] cleanup failed", error);
      }
    };

    void cleanup();
  }, []);

  return null;
}
