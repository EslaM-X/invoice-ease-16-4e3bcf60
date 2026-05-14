// Background sync engine.
//
// Drains the outbox by replaying queued mutations against Supabase. Runs:
//   - on app start
//   - whenever the browser fires `online`
//   - on a 30s interval as a safety net
//   - on `app:outbox-changed` (a new entry was just queued)
//
// Each entry is replayed as a generic insert/update/delete on its table.
// On success: entry is removed and a refetch is broadcast.
// On retryable error: retry_count++ and we move on (next tick will try again).
// On a hard error after 5 attempts: the entry stays in the outbox with
// `last_error` set so the user can see / clear it manually.

import { supabase } from "@/integrations/supabase/client";
import {
  bumpRetry,
  deleteOutboxEntry,
  getPendingOutbox,
} from "./outbox";

const MAX_RETRIES = 5;
let running = false;
let started = false;

async function flushOnce(): Promise<void> {
  if (running) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  running = true;
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
      } catch (err: any) {
        if (e.id != null) await bumpRetry(e.id, String(err?.message ?? err));
      }
    }
    // Tell the rest of the app to refetch data after a flush.
    try { window.dispatchEvent(new CustomEvent("app:resync")); } catch {}
  } finally {
    running = false;
  }
}

export function startSyncEngine() {
  if (started || typeof window === "undefined") return;
  started = true;

  // Initial drain (slight delay so app finishes mounting first)
  setTimeout(() => { void flushOnce(); }, 1500);

  window.addEventListener("online", () => { void flushOnce(); });
  window.addEventListener("app:outbox-changed", () => { void flushOnce(); });
  window.addEventListener("app:resync", () => { void flushOnce(); });
  setInterval(() => { void flushOnce(); }, 30_000);
}

export async function flushOutboxNow() { await flushOnce(); }
