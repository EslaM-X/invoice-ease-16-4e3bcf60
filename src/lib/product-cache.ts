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

export function getCachedProduct(id: string): Product | null {
  load();
  const e = mem.get(id);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) {
    mem.delete(id);
    return null;
  }
  return e.p;
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
): Promise<{ product: Product | null; fromCache: boolean; error?: any }> {
  load();
  if (!opts.forceRefresh) {
    const c = getCachedProduct(id);
    if (c) {
      // Stale-while-revalidate in background
      void supabase
        .from("products")
        .select("*")
        .eq("id", id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) touch(id, data);
        });
      return { product: c, fromCache: true };
    }
  }
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (data) touch(id, data);
  return { product: data ?? null, fromCache: false, error };
}

export function clearProductCache() {
  mem.clear();
  if (typeof localStorage !== "undefined") {
    try { localStorage.removeItem(KEY); } catch {}
  }
}
