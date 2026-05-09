import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createClient } from "@supabase/supabase-js";

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
    const { data, error } = await (supabaseAdmin.from(t as any) as any).select("*");
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
    return { ok: false, error: "Backup failed" };
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

  // Do not leak internal storage path
  return { ok: true, tables: TABLES.length, rows: totalRows, size };
}

async function authorize(request: Request): Promise<{ ok: boolean; triggered: string }> {
  const secret = process.env.BACKUP_WEBHOOK_SECRET;
  const providedSecret = request.headers.get("x-backup-secret");
  if (secret && providedSecret && providedSecret === secret) {
    return { ok: true, triggered: "cron" };
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return { ok: false, triggered: "" };
    const client = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: claims } = await client.auth.getClaims(token);
    const userId = claims?.claims?.sub;
    if (!userId) return { ok: false, triggered: "" };
    const { data: isAdmin } = await client.rpc("is_admin");
    if (isAdmin === true) return { ok: true, triggered: "manual" };
  }
  return { ok: false, triggered: "" };
}

export const Route = createFileRoute("/api/public/hooks/daily-backup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorize(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }
        let triggered = auth.triggered;
        try {
          const body = await request.json();
          if (body?.triggered_by) triggered = String(body.triggered_by);
        } catch {}
        const result = await runBackup(triggered);
        return Response.json(result, { status: result.ok ? 200 : 500 });
      },
    },
  },
});
