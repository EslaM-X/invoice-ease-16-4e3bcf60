import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Daily scheduled audit: recomputes invoice delivery state and writes a
// concise event to delivery_match_log for every discrepancy found.
// Triggered by pg_cron via net.http_post (see cron.schedule for
// "delivery-audit-daily"). The endpoint is idempotent and safe to call
// on demand from an admin.
export const Route = createFileRoute("/api/public/hooks/delivery-audit-scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("apikey") ?? request.headers.get("authorization")?.replace("Bearer ", "");
        const anon = process.env.SUPABASE_ANON_KEY
          ?? process.env.SUPABASE_PUBLISHABLE_KEY;
        const url = process.env.SUPABASE_URL;
        if (!url || !anon) return json({ error: "server_misconfigured" }, 500);
        if (!authHeader || authHeader !== anon) {
          return json({ error: "unauthorized" }, 401);
        }

        // Use service role for the audit sweep — it must read across users
        // and write to delivery_match_log. Guard via the shared apikey above.
        const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!svc) return json({ error: "no_service_key" }, 500);
        const supabase = createClient<Database>(url, svc, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const startedAt = Date.now();
        // Recompute state for all non-draft/voided invoices — cheap and durable.
        const { data: invs } = await supabase
          .from("invoices")
          .select("id, invoice_number, total, delivery_computed_state")
          .not("status", "in", "(draft,voided)")
          .range(0, 9999);

        let scanned = 0;
        let discrepancies = 0;
        let stateChanges = 0;
        const logRows: Array<{
          invoice_id: string;
          match_rule: string;
          matched_qty: number;
          notes: string;
        }> = [];

        for (const inv of invs ?? []) {
          scanned += 1;
          const previous = (inv as any).delivery_computed_state;
          const { data: newState } = await supabase.rpc("compute_invoice_delivery_state_v2" as any, {
            _invoice_id: (inv as any).id,
          } as any);
          if (newState && newState !== previous) {
            stateChanges += 1;
            logRows.push({
              invoice_id: (inv as any).id,
              match_rule: "auto_state_change",
              matched_qty: 0,
              notes: `state: ${previous} → ${newState}`,
            });
          }

          // Detect quantity discrepancies: signed vs required
          const [{ data: items }, { data: drs }] = await Promise.all([
            supabase.from("invoice_items").select("quantity, product_id").eq("invoice_id", (inv as any).id),
            supabase.from("delivery_receipts" as any).select("id, status").eq("invoice_id", (inv as any).id),
          ]);
          const required = (items ?? []).filter((i: any) => i.product_id).reduce((s: number, i: any) => s + Number(i.quantity ?? 0), 0);
          const drIds = ((drs ?? []) as any[]).map((d) => d.id);
          let signed = 0;
          if (drIds.length) {
            const signedIds = ((drs ?? []) as any[]).filter((d) => ["signed", "paid"].includes(d.status)).map((d) => d.id);
            if (signedIds.length) {
              const { data: dris } = await supabase
                .from("delivery_receipt_items" as any)
                .select("quantity")
                .in("receipt_id", signedIds);
              signed = ((dris ?? []) as any[]).reduce((s, r) => s + Number(r.quantity ?? 0), 0);
            }
          }
          if (required > 0 && signed !== required) {
            discrepancies += 1;
            logRows.push({
              invoice_id: (inv as any).id,
              match_rule: signed > required ? "over_delivered" : signed === 0 ? "no_signed_receipts" : "under_delivered",
              matched_qty: signed,
              notes: `required=${required}, signed=${signed}, delta=${signed - required}`,
            });
          }
        }

        // Bulk insert audit log (chunked)
        if (logRows.length) {
          const chunkSize = 500;
          for (let i = 0; i < logRows.length; i += chunkSize) {
            await supabase.from("delivery_match_log" as any).insert(logRows.slice(i, i + chunkSize) as any);
          }
        }

        return json({
          ok: true,
          scanned,
          stateChanges,
          discrepancies,
          durationMs: Date.now() - startedAt,
        });
      },
    },
  },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
