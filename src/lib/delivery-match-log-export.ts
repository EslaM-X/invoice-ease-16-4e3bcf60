import { supabase } from "@/integrations/supabase/client";

export type MatchLogRow = {
  id: string;
  invoice_id: string | null;
  invoice_item_id: string | null;
  receipt_id: string | null;
  receipt_item_id: string | null;
  match_rule: string | null;
  matched_qty: number | null;
  notes: string | null;
  computed_at: string;
};

const CSV_HEADER = [
  "computed_at",
  "invoice_number",
  "receipt_number",
  "match_rule",
  "matched_qty",
  "product_name",
  "serial_number",
  "color",
  "notes",
  "invoice_id",
  "receipt_id",
  "invoice_item_id",
  "receipt_item_id",
];

const escapeCsv = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function download(filename: string, csv: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function enrichAndBuildCsv(rows: MatchLogRow[]): Promise<string> {
  const invIds = Array.from(new Set(rows.map((r) => r.invoice_id).filter(Boolean))) as string[];
  const rcIds = Array.from(new Set(rows.map((r) => r.receipt_id).filter(Boolean))) as string[];
  const invItemIds = Array.from(new Set(rows.map((r) => r.invoice_item_id).filter(Boolean))) as string[];
  const rcItemIds = Array.from(new Set(rows.map((r) => r.receipt_item_id).filter(Boolean))) as string[];

  const [invRes, rcRes, invItemRes, rcItemRes] = await Promise.all([
    invIds.length
      ? supabase.from("invoices").select("id, invoice_number").in("id", invIds)
      : Promise.resolve({ data: [] as any[] }),
    rcIds.length
      ? supabase.from("delivery_receipts" as any).select("id, receipt_number").in("id", rcIds)
      : Promise.resolve({ data: [] as any[] }),
    invItemIds.length
      ? supabase
          .from("invoice_items")
          .select("id, product_name, serial_number, color")
          .in("id", invItemIds)
      : Promise.resolve({ data: [] as any[] }),
    rcItemIds.length
      ? supabase
          .from("delivery_receipt_items" as any)
          .select("id, product_name, serial_number, color")
          .in("id", rcItemIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const invMap = new Map<string, string>((invRes.data ?? []).map((r: any) => [r.id, r.invoice_number]));
  const rcMap = new Map<string, string>((rcRes.data ?? []).map((r: any) => [r.id, r.receipt_number]));
  const invItemMap = new Map<string, any>((invItemRes.data ?? []).map((r: any) => [r.id, r]));
  const rcItemMap = new Map<string, any>((rcItemRes.data ?? []).map((r: any) => [r.id, r]));

  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    const invItem = r.invoice_item_id ? invItemMap.get(r.invoice_item_id) : null;
    const rcItem = r.receipt_item_id ? rcItemMap.get(r.receipt_item_id) : null;
    const productName = invItem?.product_name ?? rcItem?.product_name ?? "";
    const serial = invItem?.serial_number ?? rcItem?.serial_number ?? "";
    const color = invItem?.color ?? rcItem?.color ?? "";
    lines.push(
      [
        r.computed_at,
        r.invoice_id ? invMap.get(r.invoice_id) ?? "" : "",
        r.receipt_id ? rcMap.get(r.receipt_id) ?? "" : "",
        r.match_rule ?? "",
        r.matched_qty ?? "",
        productName,
        serial,
        color,
        r.notes ?? "",
        r.invoice_id ?? "",
        r.receipt_id ?? "",
        r.invoice_item_id ?? "",
        r.receipt_item_id ?? "",
      ]
        .map(escapeCsv)
        .join(","),
    );
  }
  return lines.join("\n");
}

export async function exportMatchLogForInvoice(invoiceId: string, invoiceNumber: string): Promise<number> {
  const { data, error } = await supabase
    .from("delivery_match_log" as any)
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("computed_at", { ascending: false })
    .range(0, 9999);
  if (error) throw error;
  const rows = (data ?? []) as unknown as MatchLogRow[];
  const csv = await enrichAndBuildCsv(rows);
  download(`delivery-match-log-${invoiceNumber}.csv`, csv);
  return rows.length;
}

export async function exportMatchLogByPeriod(fromISO: string, toISO: string): Promise<number> {
  let q = supabase
    .from("delivery_match_log" as any)
    .select("*")
    .order("computed_at", { ascending: false })
    .range(0, 49999);
  if (fromISO) q = q.gte("computed_at", fromISO);
  if (toISO) q = q.lte("computed_at", toISO + "T23:59:59");
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as unknown as MatchLogRow[];
  const csv = await enrichAndBuildCsv(rows);
  const label = `${fromISO || "all"}_to_${toISO || "now"}`;
  download(`delivery-match-log-${label}.csv`, csv);
  return rows.length;
}
