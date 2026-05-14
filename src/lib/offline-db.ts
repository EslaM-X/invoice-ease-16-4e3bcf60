// IndexedDB layer (Dexie) — Phase 1 scaffolding.
//
// This module sets up the local database that will mirror Supabase tables for
// offline reads (Phase 2) and queue mutations for sync when offline (Phase 3).
//
// In Phase 1 the DB is created and exported but not yet wired into the
// application code paths. Adding it now lets us iterate safely without
// changing any current behaviour.

import Dexie, { type Table } from "dexie";

/**
 * Generic mirror row: full snapshot of a row from a Supabase table.
 * `_id` is the row's primary key (always uuid in our schema).
 * `_table` is the source table name.
 * `_synced_at` is the local timestamp of the last successful pull.
 */
export interface MirrorRow {
  _key: string;            // composite: `${table}:${id}` — unique
  _table: string;
  _id: string;
  _synced_at: number;
  data: Record<string, any>;
}

/**
 * Outbox entry: a mutation that needs to be flushed to Supabase.
 * Created when a write happens offline (Phase 3).
 */
export interface OutboxEntry {
  id?: number;             // auto-increment local id
  table: string;
  op: "insert" | "update" | "delete";
  /** Server-side primary key. For new offline rows this is a temporary uuid. */
  row_id: string;
  payload: Record<string, any>;
  /** ms epoch */
  created_at: number;
  /** Number of failed sync attempts. */
  retry_count: number;
  /** Last error message, if any. */
  last_error?: string;
}

class OfflineDb extends Dexie {
  mirror!: Table<MirrorRow, string>;
  outbox!: Table<OutboxEntry, number>;

  constructor() {
    super("steinheim_offline_v1");
    this.version(1).stores({
      // mirror: primary key is composite _key, indexed by _table for fast scans
      mirror: "_key, _table, _id, _synced_at",
      // outbox: auto-inc id, indexed by table + created_at for ordered flush
      outbox: "++id, table, created_at, row_id",
    });
  }
}

let _db: OfflineDb | null = null;

/** Lazy singleton — only opens IndexedDB on first use (avoids SSR issues). */
export function getOfflineDb(): OfflineDb {
  if (typeof window === "undefined") {
    throw new Error("getOfflineDb() called on the server");
  }
  if (!_db) _db = new OfflineDb();
  return _db;
}

/** Convenience: count pending outbox entries (for status badge UI later). */
export async function getPendingCount(): Promise<number> {
  if (typeof window === "undefined") return 0;
  try {
    return await getOfflineDb().outbox.count();
  } catch {
    return 0;
  }
}
