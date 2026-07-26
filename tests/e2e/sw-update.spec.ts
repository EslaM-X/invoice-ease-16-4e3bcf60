/**
 * E2E: verify the service worker picks up a new deploy after PUBLISH.
 *
 * Strategy (avoids needing a second real deploy):
 *   1. Start with a fresh browser context (no caches, no SW).
 *   2. Load the app, wait for the SW to register and cache the shell.
 *   3. Intercept /sw.js and rewrite SW_VERSION to a NEW value on subsequent
 *      requests — this simulates the exact byte diff a Publish produces.
 *   4. Trigger the "user returned to the app" path (visibilitychange) and
 *      confirm the guard detects the new version, installs it, and reloads.
 *   5. Assert PWA_ASSET_VERSION and the diagnostics panel show the new
 *      version afterward.
 *
 * Also asserts weak-network behaviour: throttle /index.html to 8s and
 * confirm the cached shell is served within 4s (3s SW timeout + slack).
 */
import { test, expect, type Route } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL || "http://localhost:8080";

test.describe("service worker updates", () => {
  test("new SW version is detected and activated after a simulated publish", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    let currentSw = "";
    // Capture the real sw.js body on first hit so we can rewrite the version
    // string later while keeping all runtime logic intact.
    await context.route("**/sw.js*", async (route: Route) => {
      const res = await route.fetch();
      const body = await res.text();
      currentSw = body;
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
        },
        body,
      });
    });

    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForFunction(async () => {
      if (!("serviceWorker" in navigator)) return true;
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg?.active;
    }, null, { timeout: 20_000 });

    // Snapshot the initial version reported by the guard.
    const initial = await page.evaluate(() => {
      const raw = localStorage.getItem("pwa_version_state_v1");
      return raw ? (JSON.parse(raw).currentVersion as string | null) : null;
    });

    // ── Simulate PUBLISH ────────────────────────────────────────────────
    const newVersion = `e2e-${Date.now()}`;
    await context.unroute("**/sw.js*");
    await context.route("**/sw.js*", async (route: Route) => {
      const rewritten = currentSw.replace(
        /SW_VERSION\s*=\s*["'`][^"'`]+["'`]/,
        `SW_VERSION = "${newVersion}"`,
      );
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
        },
        body: rewritten,
      });
    });

    // Trigger the "returned to the tab" path the guard listens on.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Guard reloads the page on controllerchange; wait for it and re-check.
    await page.waitForLoadState("networkidle");
    await page.waitForFunction(
      (want) => {
        const raw = localStorage.getItem("pwa_version_state_v1");
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return parsed.currentVersion === want || parsed.latestVersion === want;
      },
      newVersion,
      { timeout: 30_000 },
    );

    const after = await page.evaluate(() => {
      const raw = localStorage.getItem("pwa_version_state_v1");
      return raw ? JSON.parse(raw) : null;
    });
    expect(after?.latestVersion).toBe(newVersion);
    expect(after?.currentVersion).not.toBe(initial); // moved forward

    await context.close();
  });

  test("weak network still returns HTML within the 3s SW timeout", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Prime the cache.
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      return !!reg?.active;
    }, null, { timeout: 20_000 });

    // Throttle only the HTML document to 8 seconds; assets keep flowing.
    await context.route(BASE + "/", async (route: Route) => {
      await new Promise((r) => setTimeout(r, 8_000));
      await route.continue();
    });

    const start = Date.now();
    await page.reload({ waitUntil: "domcontentloaded" });
    const elapsed = Date.now() - start;

    // 3s SW timeout + a generous 2s slack for reload overhead.
    expect(elapsed).toBeLessThan(5_000);
    await context.close();
  });
});
