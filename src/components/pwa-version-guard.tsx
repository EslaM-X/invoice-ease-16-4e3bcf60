import { useEffect } from "react";

/**
 * Stability guard: actively removes any previously-installed service worker
 * and clears all caches on every device. The app now runs as a plain
 * always-fresh website to avoid "cannot find website" / blank screen issues
 * caused by stale PWA shells on different devices and networks.
 */
export function PwaVersionGuard() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const cleanup = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
        if ("caches" in window) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map((name) => caches.delete(name)));
        }
      } catch (error) {
        console.warn("[pwa] cleanup failed", error);
      }
    };

    void cleanup();
  }, []);

  return null;
}
