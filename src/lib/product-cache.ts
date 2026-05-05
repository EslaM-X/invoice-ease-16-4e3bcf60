// Lightweight client-side cache for product fetches after QR scans.
// Reduces Supabase round-trips on weak networks. TTL + LRU + localStorage persistence.
import { supabase } from "@/integrations/supabase/client";

type Product = Record<string, any> & { id: string };

const KEY = "qr_product_cache_v1";
const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX = 200;

type Entry = { p: Product; at: number };
const mem = new Map<string, Entry>();
let loaded = false;

function load() {
  if (loaded || typeof localStorage === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, Entry>;
    const now = Date.now();
    for (const [k, v] of Object.entries(obj)) {
      if (v && now - v.at < TTL_MS) mem.set(k, v);
    }
  } catch {}
}

function persist() {
  if (typeof localStorage === "undefined") return;
  try {
    const obj: Record<string, Entry> = {};
    for (const [k, v] of mem) obj[k] = v;
    localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {}
}

function touch(id: string, p: Product) {
  mem.delete(id);
  mem.set(id, { p, at: Date.now() });
  while (mem.size > MAX) {
    const first = mem.keys().next().value;
    if (!first) break;
    mem.delete(first);
  }
  persist();
}

export function getCachedProduct(id: string, opts: { allowStale?: boolean } = {}): Product | null {
  load();
  const e = mem.get(id);
  if (!e) return null;
  if (!opts.allowStale && Date.now() - e.at > TTL_MS) {
    mem.delete(id);
    return null;
  }
  return e.p;
}

export function getCachedProductMeta(id: string): { at: number } | null {
  load();
  const e = mem.get(id);
  return e ? { at: e.at } : null;
}

/** Most recent write time across the whole cache. */
export function getLastCacheUpdate(): number | null {
  load();
  let max = 0;
  for (const v of mem.values()) if (v.at > max) max = v.at;
  return max || null;
}

export function getCacheSize(): number {
  load();
  return mem.size;
}

export function setCachedProduct(p: Product) {
  if (!p?.id) return;
  load();
  touch(p.id, p);
}

/** Fetch product with cache-first strategy. Falls back to network. */
export async function fetchProductCached(
  id: string,
  opts: { forceRefresh?: boolean } = {}
): Promise<{ product: Product | null; fromCache: boolean; stale?: boolean; error?: any }> {
  load();
  const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;

  if (!opts.forceRefresh) {
    const c = getCachedProduct(id);
    if (c) {
      if (!isOffline) {
        void supabase.from("products").select("*").eq("id", id).maybeSingle()
          .then(({ data }) => { if (data) touch(id, data); });
      }
      return { product: c, fromCache: true };
    }
  }

  // Offline: return stale cache if any rather than failing
  if (isOffline) {
    const stale = getCachedProduct(id, { allowStale: true });
    if (stale) return { product: stale, fromCache: true, stale: true };
    return { product: null, fromCache: false, error: new Error("OFFLINE") };
  }

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (data) touch(id, data);
  if (!data && error) {
    const stale = getCachedProduct(id, { allowStale: true });
    if (stale) return { product: stale, fromCache: true, stale: true, error };
  }
  return { product: data ?? null, fromCache: false, error };
}

export function clearProductCache() {
  mem.clear();
  if (typeof localStorage !== "undefined") {
    try { localStorage.removeItem(KEY); } catch {}
  }
}
