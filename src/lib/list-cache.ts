// Generic localStorage-backed list cache for offline-friendly data lists
// (e.g. products, customers, scanner sessions).
//
// Behaviour:
// - Cache is kept for 7 days by default so the app stays usable across long
//   offline windows.
// - `cachedListFetch` always returns cached data immediately when present,
//   then revalidates in the background. If the network fetch fails (offline,
//   server error), the previously-cached snapshot is preserved AND returned
//   as the result so pages keep working without internet.
const PREFIX = "list_cache_v1::";
const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

type Wrap<T> = { at: number; data: T[] };

export function getListCache<T>(key: string, ttl = DEFAULT_TTL): T[] | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const w = JSON.parse(raw) as Wrap<T>;
    if (!w?.at || Date.now() - w.at > ttl) return null;
    return w.data ?? null;
  } catch {
    return null;
  }
}

/** Read cached data ignoring TTL — used as a last resort when offline. */
export function getStaleListCache<T>(key: string): T[] | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const w = JSON.parse(raw) as Wrap<T>;
    return w?.data ?? null;
  } catch {
    return null;
  }
}

export function setListCache<T>(key: string, data: T[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data }));
  } catch {}
}

export function clearListCache(key?: string) {
  if (typeof localStorage === "undefined") return;
  if (key) {
    try { localStorage.removeItem(PREFIX + key); } catch {}
    return;
  }
  try {
    Object.keys(localStorage).forEach((k) => k.startsWith(PREFIX) && localStorage.removeItem(k));
  } catch {}
}

/**
 * Cache-first + revalidate. When network fails, falls back to whatever is in
 * cache (even past TTL) instead of throwing — so the UI keeps rendering data
 * during outages.
 */
export async function cachedListFetch<T>(
  key: string,
  fetcher: () => Promise<T[]>,
  opts: { ttl?: number; forceRefresh?: boolean } = {}
): Promise<{ data: T[]; fromCache: boolean; offline?: boolean }> {
  const cached = !opts.forceRefresh ? getListCache<T>(key, opts.ttl) : null;
  if (cached) {
    // background revalidate; don't crash the page if offline
    void fetcher().then((fresh) => fresh && setListCache(key, fresh)).catch(() => {});
    return { data: cached, fromCache: true };
  }
  try {
    const fresh = await fetcher();
    if (fresh) setListCache(key, fresh);
    return { data: fresh ?? [], fromCache: false };
  } catch (err) {
    // Network failed and we had no fresh cache — try stale cache as a
    // last-ditch fallback so the page still renders something useful.
    const stale = getStaleListCache<T>(key);
    if (stale) return { data: stale, fromCache: true, offline: true };
    throw err;
  }
}
