import { getAvatarSrc, getAvatarSrcSet } from "@/lib/avatar-url";

/**
 * Warms the browser image cache for a batch of avatar URLs so they render
 * instantly the next time they enter the viewport (filter/sort/tab switch).
 *
 * - Uses `new Image()` with the same `src` + `srcset` variants LuxuryAvatar
 *   requests, so the exact bytes get pinned in the HTTP cache.
 * - De-dupes across calls via a module-level Set — repeated prefetches of the
 *   same URL become no-ops.
 * - Fires with low priority and never rejects; safe to call from render effects.
 */
const PREFETCHED = new Set<string>();

export function prefetchAvatars(
  urls: Array<string | null | undefined>,
  sizePx: number,
  bust?: string | number | null,
): void {
  if (typeof window === "undefined") return;
  for (const url of urls) {
    if (!url) continue;
    const src = getAvatarSrc(url, sizePx, bust);
    const srcSet = getAvatarSrcSet(url, sizePx, bust);
    const key = `${src ?? ""}||${srcSet ?? ""}`;
    if (!src || PREFETCHED.has(key)) continue;
    PREFETCHED.add(key);
    try {
      const img = new Image();
      img.decoding = "async";
      (img as unknown as { fetchPriority?: string }).fetchPriority = "low";
      img.loading = "eager";
      if (srcSet) img.srcset = srcSet;
      img.sizes = `${sizePx}px`;
      img.src = src;
    } catch {
      /* noop */
    }
  }
}
