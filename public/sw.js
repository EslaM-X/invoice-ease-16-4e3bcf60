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

const SW_VERSION = "v5-2026-07-26-global-call-ring";
const HTML_CACHE = `html-${SW_VERSION}`;
const ASSET_CACHE = `assets-${SW_VERSION}`;
const ALL_CACHES = [HTML_CACHE, ASSET_CACHE];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(HTML_CACHE);
      // Pre-cache the root and common assets to ensure the shell works offline.
      // We ignore errors here so installation continues even if network fails.
      try { await cache.add("/"); } catch (e) { console.warn("[sw] pre-cache failed", e); }
      return self.skipWaiting();
    })()
  );
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
      const windowClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      await Promise.allSettled(windowClients.map((client) => client.postMessage({ type: "SW_ACTIVATED", version: SW_VERSION })));
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "PING") {
    event.source?.postMessage?.({ type: "PONG", version: SW_VERSION });
  }
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

  // ────────── HTML navigations: NetworkFirst with 3s timeout ──────────
  // On strong networks we always serve the freshest HTML (deploys land
  // immediately). On weak/flaky networks we fall back to the cached shell
  // after 3 seconds instead of leaving the user staring at a blank tab,
  // and keep the network request in flight to refresh the cache in the
  // background so the next navigation is already fresh.
  if (isHtmlNavigation(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(HTML_CACHE);
        const networkPromise = fetch(request, { cache: "no-store" }).then((res) => {
          if (res.ok) cache.put(request, res.clone()).catch(() => {});
          return res;
        });

        const cached = await cache.match(request);
        // Root fallback so deep links work offline even if that URL was never cached.
        const fallback = cached || (await caches.match("/", { cacheName: HTML_CACHE }));

        if (!fallback) {
          // Nothing cached — we MUST wait for the network. No timeout here or
          // the user gets a broken shell on first visit.
          try {
            return await networkPromise;
          } catch {
            return new Response(
              "<!doctype html><html><body><h1>غير متصل بالإنترنت</h1><p>افتح التطبيق مرة بعد الاتصال لتفعيل وضع الـ offline.</p></body></html>",
              { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
            );
          }
        }

        // Race the network against a 3s budget; cached HTML wins the race
        // only if the network is slow.
        return await new Promise((resolve) => {
          let settled = false;
          const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(fallback);
          }, 3000);
          networkPromise
            .then((res) => {
              clearTimeout(timeout);
              if (settled) return;
              settled = true;
              resolve(res);
            })
            .catch(() => {
              clearTimeout(timeout);
              if (settled) return;
              settled = true;
              resolve(fallback);
            });
        });
      })(),
    );
    return;
  }

  if (isStaticAsset(url)) {
    // Vite emits filename hashes for built assets, so cached copies are safe
    // to serve immediately while a background fetch refreshes the entry.
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((res) => {
            if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => cached);
        return cached || networkPromise;
      })(),
    );
  }
});

// ───────────── Push Notifications ─────────────
const VIBRATION_PATTERNS = {
  default: [200, 100, 200],
  short: [80],
  long: [600],
  pulse: [120, 80, 120, 80, 120, 80, 400],
  call: [450, 140, 450, 140, 900, 220, 450, 140, 450],
  off: [],
};

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: event.data?.text?.() || "إشعار جديد" }; }

  const title = data.title || "إشعار جديد";
  const vibrationKey = data.vibration || "default";
  const vibrate = VIBRATION_PATTERNS[vibrationKey] ?? VIBRATION_PATTERNS.default;
  const iconUrl = data.icon || new URL("/icon-512.png", self.location.origin).toString();
  const badgeUrl = data.badge || new URL("/icon-192.png", self.location.origin).toString();
  const isIncomingCall = data.type === "incoming_call" || data.meta?.kind === "incoming_call";

  const options = {
    body: data.body || "",
    icon: iconUrl,
    badge: badgeUrl,
    image: data.image || iconUrl,
    tag: data.tag || data.id || undefined,
    renotify: true,
    vibrate,
    silent: false,
    requireInteraction: data.requireInteraction !== false,
    timestamp: Date.now(),
    dir: "rtl",
    lang: "ar",
    actions: isIncomingCall
      ? [
        { action: "answer", title: "رد" },
        { action: "dismiss", title: "رفض" },
      ]
      : [
        { action: "open", title: "فتح" },
        { action: "dismiss", title: "إغلاق" },
      ],
    data: {
      url: data.url || "/",
      sound: data.sound || "default",
      customUrl: data.customUrl || null,
      id: data.id,
      type: data.type,
      callId: data.meta?.call_id || null,
    },
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    // Ask any open clients to play the user's chosen sound
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientsList) {
      client.postMessage({ type: "PUSH_SOUND", sound: options.data.sound, customUrl: options.data.customUrl, payload: data });
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;
  const url = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      const cu = new URL(client.url);
      if (cu.origin === self.location.origin) {
        if ("navigate" in client) {
          await client.navigate(url);
        } else {
          client.postMessage({ type: "NAVIGATE", url });
        }
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
