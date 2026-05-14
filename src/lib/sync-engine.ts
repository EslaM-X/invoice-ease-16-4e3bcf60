// Background sync engine. Drains the outbox by replaying queued mutations.
// On success: bumps last-sync timestamp + emits success notifications.
// On hard failure (>= MAX_RETRIES): emits a failure event so the UI can toast.

import { supabase } from "@/integrations/supabase/client";
import {
  bumpRetry,
  deleteOutboxEntry,
  getPendingOutbox,
} from "./outbox";
import { setLastSync } from "./sync-state";

export const MAX_RETRIES = 5;
let running = false;
let started = false;

function emit(name: string, detail?: any) {
  try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch {}
}

async function flushOnce(): Promise<void> {
  if (running) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  running = true;
  let succeeded = 0;
  const failed: { table: string; row_id: string; error: string }[] = [];
  try {
    const entries = await getPendingOutbox();
    for (const e of entries) {
      if ((e.retry_count ?? 0) >= MAX_RETRIES) continue;
      try {
        const tbl = supabase.from(e.table as any);
        let err: any = null;
        if (e.op === "insert") {
          const r = await tbl.insert(e.payload);
          err = r.error;
        } else if (e.op === "update") {
          const r = await tbl.update(e.payload).eq("id", e.row_id);
          err = r.error;
        } else if (e.op === "delete") {
          const r = await tbl.delete().eq("id", e.row_id);
          err = r.error;
        }
        if (err) throw err;
        if (e.id != null) await deleteOutboxEntry(e.id);
        succeeded++;
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (e.id != null) await bumpRetry(e.id, msg);
        const newCount = (e.retry_count ?? 0) + 1;
        if (newCount >= MAX_RETRIES) {
          failed.push({ table: e.table, row_id: e.row_id, error: msg });
        }
      }
    }
    setLastSync();
    if (succeeded > 0) emit("app:sync-success", { count: succeeded });
    if (failed.length > 0) emit("app:sync-failed", { items: failed });
    emit("app:resync");
  } finally {
    running = false;
  }
}

export function startSyncEngine() {
  if (started || typeof window === "undefined") return;
  started = true;
  setTimeout(() => { void flushOnce(); }, 1500);
  window.addEventListener("online", () => { void flushOnce(); });
  window.addEventListener("app:outbox-changed", () => { void flushOnce(); });
  setInterval(() => { void flushOnce(); }, 30_000);
}

export async function flushOutboxNow() { await flushOnce(); }

/** Reset retry count on a specific entry then flush — used by manual retry button. */
export async function retryOutboxEntry(id: number) {
  const { getOfflineDb } = await import("./offline-db");
  await getOfflineDb().outbox.update(id, { retry_count: 0, last_error: undefined });
  emit("app:outbox-changed");
  await flushOnce();
}
