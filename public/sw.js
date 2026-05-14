// Service worker — Phase 1 foundation.
// Behaviour:
//  - NetworkFirst for HTML navigations (so deploys propagate fast, no stale shell)
//  - StaleWhileRevalidate for static assets (faster repeat loads, offline-capable)
//  - Bypasses Supabase / API requests entirely (no caching of data)
//  - Skips entirely on Lovable preview / iframe hosts (registration guard
//    in pwa-version-guard.tsx prevents install there, but defence-in-depth here)
//
// Intentionally minimal: no offline DB writes here. The app's IndexedDB
// outbox layer (src/lib/db.ts) handles write queueing in the page context.

const SW_VERSION = "v1-2026-05-14";
const HTML_CACHE = `html-${SW_VERSION}`;
const ASSET_CACHE = `assets-${SW_VERSION}`;
const ALL_CACHES = [HTML_CACHE, ASSET_CACHE];

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop any old caches not in current set
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => !ALL_CACHES.includes(n)).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

const isHtmlNavigation = (request) =>
  request.mode === "navigate" ||
  (request.method === "GET" &&
    request.headers.get("accept")?.includes("text/html"));

const isStaticAsset = (url) =>
  /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpg|jpeg|svg|webp|ico|gif)(\?|$)/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache cross-origin or API/data calls — pass through.
  if (url.origin !== self.location.origin) return;
  if (/\/(rest|auth|realtime|storage|functions)\/v1\//.test(url.pathname)) return;
  if (url.pathname.startsWith("/api/")) return;

  if (isHtmlNavigation(request)) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(HTML_CACHE);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(request, { cacheName: HTML_CACHE });
          if (cached) return cached;
          // Fallback to root document if available
          const fallback = await caches.match("/", { cacheName: HTML_CACHE });
          if (fallback) return fallback;
          return new Response(
            "<!doctype html><html><body><h1>غير متصل بالإنترنت</h1><p>افتح التطبيق مرة بعد الاتصال لتفعيل وضع الـ offline.</p></body></html>",
            { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }
          );
        }
      })()
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((res) => {
            if (res && res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || networkPromise;
      })()
    );
  }
});
