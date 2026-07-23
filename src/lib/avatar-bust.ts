/**
 * Global avatar cache-bust store.
 *
 * - Any component can call `bumpAvatarBust()` to force a fresh fetch of every
 *   avatar in the UI (bypassing browser + Supabase CDN cache).
 * - Automatically bumps when the browser's devicePixelRatio changes (e.g. user
 *   zoomed, dragged the window to a different-DPI screen, or plugged in an
 *   external monitor) so avatar variants are re-requested at the new density.
 * - `useAvatarBust()` gives components a reactive token that changes whenever
 *   the global bust changes.
 * - `detectImageSupport()` reports whether the browser can decode AVIF / WebP
 *   (used by the diagnostics panel).
 */

import { useSyncExternalStore, useEffect, useState } from "react";

let bust: number = 0;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }

export function getAvatarBust(): number { return bust; }

export function bumpAvatarBust(): number {
  bust = Date.now();
  emit();
  return bust;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useAvatarBust(): number {
  return useSyncExternalStore(subscribe, getAvatarBust, () => 0);
}

// ---- DPR watcher ---------------------------------------------------------
let dprWatchInstalled = false;
function installDprWatcher() {
  if (dprWatchInstalled || typeof window === "undefined") return;
  dprWatchInstalled = true;
  let lastDpr = window.devicePixelRatio || 1;
  let mql: MediaQueryList | null = null;
  const attach = () => {
    const dpr = window.devicePixelRatio || 1;
    lastDpr = dpr;
    try { mql?.removeEventListener?.("change", handler); } catch {}
    mql = window.matchMedia(`(resolution: ${dpr}dppx)`);
    try { mql.addEventListener("change", handler); } catch { mql.addListener?.(handler); }
  };
  const handler = () => {
    const dpr = window.devicePixelRatio || 1;
    if (Math.abs(dpr - lastDpr) > 0.01) {
      bumpAvatarBust();
      attach();
    }
  };
  attach();
  // Belt-and-braces: window resize can also change DPR on some browsers.
  window.addEventListener("resize", handler, { passive: true });
}
installDprWatcher();

// ---- Reactive DPR --------------------------------------------------------
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState<number>(() =>
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    let mql: MediaQueryList | null = null;
    const handler = () => {
      const next = window.devicePixelRatio || 1;
      setDpr(next);
      try { mql?.removeEventListener?.("change", handler); } catch {}
      mql = window.matchMedia(`(resolution: ${next}dppx)`);
      try { mql.addEventListener("change", handler); } catch { mql.addListener?.(handler); }
    };
    handler();
    window.addEventListener("resize", handler, { passive: true });
    return () => {
      window.removeEventListener("resize", handler);
      try { mql?.removeEventListener?.("change", handler); } catch {}
    };
  }, []);
  return dpr;
}

// ---- AVIF / WebP support detection --------------------------------------
export type ImageSupport = { avif: boolean; webp: boolean };

const AVIF_TEST =
  "data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=";

const WEBP_TEST =
  "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";

let cachedSupport: ImageSupport | null = null;
let inflight: Promise<ImageSupport> | null = null;

function testImage(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") return resolve(false);
    const img = new Image();
    img.onload = () => resolve(img.width > 0 && img.height > 0);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

export async function detectImageSupport(): Promise<ImageSupport> {
  if (cachedSupport) return cachedSupport;
  if (inflight) return inflight;
  inflight = (async () => {
    const [avif, webp] = await Promise.all([testImage(AVIF_TEST), testImage(WEBP_TEST)]);
    cachedSupport = { avif, webp };
    return cachedSupport;
  })();
  return inflight;
}

/** Fetches `Content-Type` (and length) via HEAD to reveal what Supabase actually served. */
export async function probeDeliveredFormat(url: string): Promise<{ contentType: string | null; contentLength: number | null } | null> {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (!res.ok) return null;
    return {
      contentType: res.headers.get("content-type"),
      contentLength: Number(res.headers.get("content-length") ?? 0) || null,
    };
  } catch {
    return null;
  }
}
