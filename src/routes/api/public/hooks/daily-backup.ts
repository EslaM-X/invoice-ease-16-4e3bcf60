import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TABLES = [
  "profiles", "user_roles", "company_members",
  "customers", "products", "inventory_logs",
  "invoices", "invoice_items", "invoice_events",
  "call_logs", "customer_ratings", "service_reviews",
  "settings", "company_counters", "audit_log",
];

async function runBackup(triggeredBy: string) {
  const dump: Record<string, any[]> = {};
  let totalRows = 0;
  for (const t of TABLES) {
    const { data, error } = await supabaseAdmin.from(t).select("*");
    if (error) {
      dump[t] = [];
      continue;
    }
    dump[t] = data ?? [];
    totalRows += dump[t].length;
  }
  const json = JSON.stringify({ at: new Date().toISOString(), tables: dump }, null, 2);
  const path = `daily/${new Date().toISOString().slice(0, 10)}/backup-${Date.now()}.json`;

  const { error: upErr } = await supabaseAdmin.storage
    .from("backups")
    .upload(path, new Blob([json], { type: "application/json" }), { upsert: true });

  const size = new Blob([json]).size;

  if (upErr) {
    await supabaseAdmin.from("backups_log").insert({
      status: "failed", error: upErr.message, triggered_by: triggeredBy,
      tables_count: TABLES.length, rows_count: totalRows, size_bytes: size,
    });
    return { ok: false, error: upErr.message };
  }

  await supabaseAdmin.from("backups_log").insert({
    status: "success", storage_path: path, triggered_by: triggeredBy,
    tables_count: TABLES.length, rows_count: totalRows, size_bytes: size,
  });
  await supabaseAdmin.from("notifications").insert({
    recipient_role: "admin", type: "backup",
    title: "✅ تم إنشاء نسخة احتياطية",
    body: `${TABLES.length} جدول · ${totalRows} سجل · ${(size / 1024).toFixed(1)} KB`,
  });

  return { ok: true, path, tables: TABLES.length, rows: totalRows, size };
}

export const Route = createFileRoute("/api/public/hooks/daily-backup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let triggered = "cron";
        try {
          const body = await request.json();
          if (body?.triggered_by) triggered = String(body.triggered_by);
        } catch {}
        const result = await runBackup(triggered);
        return Response.json(result, { status: result.ok ? 200 : 500 });
      },
      GET: async () => {
        const result = await runBackup("manual");
        return Response.json(result, { status: result.ok ? 200 : 500 });
      },
    },
  },
});
