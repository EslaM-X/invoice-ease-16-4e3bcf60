import { createFileRoute } from "@tanstack/react-router";
import { createHmac } from "crypto";

// Backoff schedule in seconds by attempt count (attempts already incremented).
const BACKOFF_SECONDS = [30, 120, 600, 3600, 21600, 21600, 21600, 21600];
const MAX_ATTEMPTS = 8;
const BATCH_SIZE = 25;

async function deliver(payload: unknown, secret: string, url: string) {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-steinheim-signature": signature,
    },
    body,
  });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, text };
}

async function runWorker() {
  const url = process.env.WARRANTY_SYNC_URL;
  const secret = process.env.WARRANTY_SYNC_SECRET;
  if (!url || !secret) {
    return { ok: false, error: "WARRANTY_SYNC_URL or WARRANTY_SYNC_SECRET not configured" };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: rows, error } = await supabaseAdmin
    .from("warranty_outbox_events")
    .select("id, event, payload, attempts")
    .is("delivered_at", null)
    .lte("next_retry_at", new Date().toISOString())
    .lt("attempts", MAX_ATTEMPTS)
    .order("next_retry_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) return { ok: false, error: error.message };
  if (!rows || rows.length === 0) return { ok: true, processed: 0 };

  let delivered = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const result = await deliver(row.payload, secret, url);
      if (result.ok) {
        await supabaseAdmin
          .from("warranty_outbox_events")
          .update({
            delivered_at: new Date().toISOString(),
            last_status: result.status,
            last_error: null,
            attempts: (row.attempts ?? 0) + 1,
          })
          .eq("id", row.id);
        delivered++;
      } else {
        const nextAttempts = (row.attempts ?? 0) + 1;
        const backoff = BACKOFF_SECONDS[Math.min(nextAttempts - 1, BACKOFF_SECONDS.length - 1)];
        await supabaseAdmin
          .from("warranty_outbox_events")
          .update({
            attempts: nextAttempts,
            next_retry_at: new Date(Date.now() + backoff * 1000).toISOString(),
            last_status: result.status,
            last_error: result.text?.slice(0, 500) || `HTTP ${result.status}`,
          })
          .eq("id", row.id);
        failed++;
      }
    } catch (e) {
      const nextAttempts = (row.attempts ?? 0) + 1;
      const backoff = BACKOFF_SECONDS[Math.min(nextAttempts - 1, BACKOFF_SECONDS.length - 1)];
      await supabaseAdmin
        .from("warranty_outbox_events")
        .update({
          attempts: nextAttempts,
          next_retry_at: new Date(Date.now() + backoff * 1000).toISOString(),
          last_error: (e instanceof Error ? e.message : String(e)).slice(0, 500),
        })
        .eq("id", row.id);
      failed++;
    }
  }

  return { ok: true, processed: rows.length, delivered, failed };
}

export const Route = createFileRoute("/api/public/hooks/warranty-sync-worker")({
  server: {
    handlers: {
      GET: async () => Response.json(await runWorker()),
      POST: async () => Response.json(await runWorker()),
    },
  },
});
