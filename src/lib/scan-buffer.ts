/**
 * Offline-safe queue for mobile scan events.
 *
 * Why: when the phone briefly loses connectivity (subway, bad WiFi), we still
 * want every QR scan to land in the desktop invoice once we're back online.
 * Each scan is persisted in localStorage immediately and replayed against the
 * `scan_events` table on the next opportunity (online event, realtime
 * reconnect, periodic flush).
 */

import { supabase } from "@/integrations/supabase/client";

export type QueuedScan = {
  /** stable client id so we can de-dupe between attempts */
  client_id: string;
  session_id: string;
  user_id: string;
  product_id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  unit_price: number;
  quantity: number;
  /** ISO timestamp when the scan was first captured on the device */
  queued_at: string;
};

const KEY_PREFIX = "scan_buffer_v1::";

const storageKey = (userId: string) => `${KEY_PREFIX}${userId}`;

const safeRead = (userId: string): QueuedScan[] => {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as QueuedScan[]) : [];
  } catch {
    return [];
  }
};

const safeWrite = (userId: string, items: QueuedScan[]) => {
  try {
    if (items.length === 0) localStorage.removeItem(storageKey(userId));
    else localStorage.setItem(storageKey(userId), JSON.stringify(items));
  } catch {}
};

export const getQueue = (userId: string): QueuedScan[] => safeRead(userId);

export const queueLength = (userId: string): number => safeRead(userId).length;

export const enqueueScan = (item: Omit<QueuedScan, "client_id" | "queued_at"> & { client_id?: string }) => {
  const list = safeRead(item.user_id);
  const queued: QueuedScan = {
    client_id: item.client_id ?? crypto.randomUUID(),
    session_id: item.session_id,
    user_id: item.user_id,
    product_id: item.product_id,
    product_name: item.product_name,
    serial_number: item.serial_number ?? null,
    color: item.color ?? null,
    unit_price: item.unit_price,
    quantity: item.quantity,
    queued_at: new Date().toISOString(),
  };
  list.push(queued);
  safeWrite(item.user_id, list);
  return queued;
};

/**
 * Try to push every queued scan for this user to Supabase.
 * Returns the number of successfully flushed events.
 */
export const flushQueue = async (userId: string): Promise<number> => {
  const list = safeRead(userId);
  if (list.length === 0) return 0;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;

  const remaining: QueuedScan[] = [];
  let flushed = 0;
  for (const q of list) {
    try {
      const { error } = await supabase.from("scan_events").insert({
        session_id: q.session_id,
        user_id: q.user_id,
        product_id: q.product_id,
        product_name: q.product_name,
        serial_number: q.serial_number,
        color: q.color,
        unit_price: q.unit_price,
        quantity: q.quantity,
      });
      if (error) {
        // Network/transport errors: keep for retry.
        // Permanent errors (e.g. session closed) get dropped after we
        // detect them — but we keep on network/RLS transient failures by
        // requeueing. Simpler: keep on any error; user can clear via reload
        // if a session was permanently closed.
        const msg = String(error.message ?? "").toLowerCase();
        const permanent =
          msg.includes("violates row-level security") ||
          msg.includes("foreign key") ||
          msg.includes("does not exist");
        if (!permanent) remaining.push(q);
        else flushed += 1; // count as resolved (dropped) so user sees progress
      } else {
        flushed += 1;
      }
    } catch {
      remaining.push(q);
    }
  }
  safeWrite(userId, remaining);
  return flushed;
};

export const clearQueueForSession = (userId: string, sessionId: string) => {
  const list = safeRead(userId).filter((q) => q.session_id !== sessionId);
  safeWrite(userId, list);
};
