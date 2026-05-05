// Generic localStorage-backed list cache for offline-friendly data lists
// (e.g. products, customers, scanner sessions). TTL + version key.
const PREFIX = "list_cache_v1::";
const DEFAULT_TTL = 10 * 60 * 1000;

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

/** Wrap a network fetcher with cache-first + revalidate behavior. */
export async function cachedListFetch<T>(
  key: string,
  fetcher: () => Promise<T[]>,
  opts: { ttl?: number; forceRefresh?: boolean } = {}
): Promise<{ data: T[]; fromCache: boolean }> {
  const cached = !opts.forceRefresh ? getListCache<T>(key, opts.ttl) : null;
  if (cached) {
    // background revalidate
    void fetcher().then((fresh) => fresh && setListCache(key, fresh)).catch(() => {});
    return { data: cached, fromCache: true };
  }
  const fresh = await fetcher();
  if (fresh) setListCache(key, fresh);
  return { data: fresh, fromCache: false };
}
