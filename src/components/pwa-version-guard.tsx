import { useEffect } from "react";
import { PWA_ASSET_VERSION } from "@/lib/pwa-version";
import { shouldDisablePwaFeatures } from "@/lib/pwa-runtime";

const CACHE_PREFIX = "steinheim-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${PWA_ASSET_VERSION}`;

export function PwaVersionGuard() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let disposed = false;

    const syncPwaVersion = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();

        if (shouldDisablePwaFeatures()) {
          await Promise.all(registrations.map((registration) => registration.unregister()));
          if ("caches" in window) {
            const cacheNames = await caches.keys();
            await Promise.all(
              cacheNames
                .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX))
                .map((cacheName) => caches.delete(cacheName)),
            );
          }
          return;
        }

        await Promise.all(
          registrations.map(async (registration) => {
            const scriptUrl =
              registration.active?.scriptURL ??
              registration.waiting?.scriptURL ??
              registration.installing?.scriptURL ??
              "";

            if (scriptUrl && !scriptUrl.includes(`v=${PWA_ASSET_VERSION}`)) {
              await registration.unregister();
            }
          }),
        );

        const registration = await navigator.serviceWorker.register(`/sw.js?v=${PWA_ASSET_VERSION}`, {
          scope: "/",
          updateViaCache: "none",
        });

        await registration.update();
        registration.waiting?.postMessage({ type: "SKIP_WAITING" });

        if ("caches" in window) {
          const cacheNames = await caches.keys();
          await Promise.all(
            cacheNames
              .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
              .map((cacheName) => caches.delete(cacheName)),
          );
        }
      } catch (error) {
        console.warn("[pwa] version sync failed", error);
      }
    };

    void syncPwaVersion();

    const onMessage = async (event: MessageEvent) => {
      if (disposed) return;
      if (event.data?.type !== "PWA_VERSION") return;

      if ("caches" in window) {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName)),
        );
      }
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}
