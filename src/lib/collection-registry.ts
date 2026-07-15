// Live registry of collections (code -> {label, color_hex, sort_order}).
// Populated by useCollections() and read synchronously by collectionStyle().
// Seeded with the four defaults so the very first render has correct colors.

export type CollectionEntry = {
  id?: string;
  code: string;
  label: string;
  color_hex: string;
  sort_order: number;
  is_active: boolean;
};

const SEED: CollectionEntry[] = [
  { code: "JOY", label: "JOY", color_hex: "#F43F5E", sort_order: 10, is_active: true },
  { code: "UP", label: "UP", color_hex: "#0EA5E9", sort_order: 20, is_active: true },
  { code: "ART", label: "ART", color_hex: "#8B5CF6", sort_order: 30, is_active: true },
  { code: "QUATRO", label: "QUATRO", color_hex: "#F59E0B", sort_order: 40, is_active: true },
];

const CACHE_KEY = "collections_registry_v1";

const map = new Map<string, CollectionEntry>();
const listeners = new Set<() => void>();
let snapshot: CollectionEntry[] = [];

function recomputeSnapshot() {
  snapshot = Array.from(map.values()).sort(
    (a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999),
  );
}

function seedFromCache() {
  for (const s of SEED) map.set(s.code.toUpperCase(), s);
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as CollectionEntry[];
        if (Array.isArray(arr)) {
          for (const c of arr) if (c?.code) map.set(c.code.toUpperCase(), c);
        }
      }
    }
  } catch {}
  recomputeSnapshot();
}
seedFromCache();

export function setCollectionsRegistry(items: CollectionEntry[]) {
  // Keep defaults present, then overwrite with server truth.
  map.clear();
  for (const s of SEED) map.set(s.code.toUpperCase(), s);
  for (const c of items) if (c?.code) map.set(c.code.toUpperCase(), c);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(CACHE_KEY, JSON.stringify(items));
    }
  } catch {}
  const next = Array.from(map.values()).sort(
    (a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999),
  );
  // Skip notify if nothing effectively changed (prevents render loops).
  const same =
    next.length === snapshot.length &&
    next.every((c, i) => {
      const p = snapshot[i];
      return (
        p &&
        p.code === c.code &&
        p.label === c.label &&
        p.color_hex === c.color_hex &&
        p.sort_order === c.sort_order &&
        p.is_active === c.is_active
      );
    });
  snapshot = next;
  if (!same) listeners.forEach((l) => l());
}

export function getCollectionEntry(code?: string | null): CollectionEntry | null {
  if (!code) return null;
  return map.get(code.toUpperCase()) ?? null;
}

export function listCollectionsSync(): CollectionEntry[] {
  return snapshot;
}

export function subscribeCollections(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
