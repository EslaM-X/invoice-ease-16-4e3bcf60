// Tracks last successful sync time + pending row ids for any table.
// Persisted in localStorage and broadcast via events for live UI updates.

import { getOfflineDb } from "./offline-db";

const LAST_SYNC_KEY = "app:last-sync-at";

export function setLastSync(ts: number = Date.now()) {
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(ts));
    window.dispatchEvent(new CustomEvent("app:last-sync", { detail: ts }));
  } catch {}
}

export function getLastSync(): number | null {
  try {
    const v = typeof window !== "undefined" ? localStorage.getItem(LAST_SYNC_KEY) : null;
    return v ? parseInt(v, 10) : null;
  } catch {
    return null;
  }
}

/** Return Set of row_ids in outbox for a given table (pending sync). */
export async function getPendingRowIds(table: string): Promise<Set<string>> {
  if (typeof window === "undefined") return new Set();
  try {
    const rows = await getOfflineDb().outbox.where("table").equals(table).toArray();
    return new Set(rows.map((r) => r.row_id));
  } catch {
    return new Set();
  }
}

export function formatRelativeTime(ts: number | null, lang: "ar" | "en"): string {
  if (!ts) return lang === "ar" ? "لم تتم بعد" : "never";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return lang === "ar" ? "الآن" : "just now";
  if (diff < 60) return lang === "ar" ? `منذ ${diff} ث` : `${diff}s ago`;
  const m = Math.floor(diff / 60);
  if (m < 60) return lang === "ar" ? `منذ ${m} د` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return lang === "ar" ? `منذ ${h} س` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return lang === "ar" ? `منذ ${d} ي` : `${d}d ago`;
}
