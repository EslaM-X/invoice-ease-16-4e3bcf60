// Offline-write outbox: queues mutations when offline, flushes when online.
//
// Usage:
//   await enqueueOrRun({
//     table: "customers",
//     op: "update",
//     row_id: customer.id,
//     payload: { name, phone, address },
//     run: async () => {
//       const { error } = await supabase.from("customers").update(payload).eq("id", customer.id);
//       if (error) throw error;
//     },
//   });
//
// If the device is online and `run()` succeeds, nothing is queued.
// If offline OR `run()` throws a network error, the mutation is persisted to
// IndexedDB and replayed by the sync engine when connectivity returns.
//
// IMPORTANT: This MUST NOT be used for operations that depend on
// server-generated values (invoice_number, receipt_number, auto stock decrement),
// because the queued payload is replayed verbatim. See README in offline-db.ts.

import { getOfflineDb, type OutboxEntry } from "./offline-db";

export type OutboxOp = "insert" | "update" | "delete";

export interface EnqueueArgs {
  table: string;
  op: OutboxOp;
  row_id: string;
  payload: Record<string, any>;
  /** The actual Supabase mutation. Throws on network/auth/RLS errors. */
  run: () => Promise<void>;
}

function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/** True if the error looks like a transient network/connectivity issue. */
function isNetworkError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message ?? err).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("load failed") ||
    msg.includes("timeout") ||
    msg.includes("offline") ||
    err?.name === "AbortError" ||
    err?.name === "TypeError"
  );
}

export async function enqueueOutbox(args: Omit<EnqueueArgs, "run">): Promise<void> {
  const entry: OutboxEntry = {
    table: args.table,
    op: args.op,
    row_id: args.row_id,
    payload: args.payload,
    created_at: Date.now(),
    retry_count: 0,
  };
  await getOfflineDb().outbox.add(entry);
  notifyOutboxChanged();
}

/**
 * Try the mutation immediately; if offline OR a network failure happens,
 * persist to outbox and resolve successfully (so the UI feels instant).
 * Other errors (auth, RLS, validation) re-throw so the user sees them.
 */
export async function enqueueOrRun(args: EnqueueArgs): Promise<{ queued: boolean }> {
  if (!isOnline()) {
    await enqueueOutbox(args);
    return { queued: true };
  }
  try {
    await args.run();
    return { queued: false };
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueOutbox(args);
      return { queued: true };
    }
    throw err;
  }
}

function notifyOutboxChanged() {
  try { window.dispatchEvent(new CustomEvent("app:outbox-changed")); } catch {}
}

export async function getPendingOutbox(): Promise<OutboxEntry[]> {
  if (typeof window === "undefined") return [];
  try {
    return await getOfflineDb().outbox.orderBy("created_at").toArray();
  } catch {
    return [];
  }
}

export async function deleteOutboxEntry(id: number): Promise<void> {
  await getOfflineDb().outbox.delete(id);
  notifyOutboxChanged();
}

export async function bumpRetry(id: number, error: string): Promise<void> {
  const db = getOfflineDb();
  const e = await db.outbox.get(id);
  if (!e) return;
  await db.outbox.update(id, {
    retry_count: (e.retry_count ?? 0) + 1,
    last_error: error.slice(0, 500),
  });
  notifyOutboxChanged();
}
