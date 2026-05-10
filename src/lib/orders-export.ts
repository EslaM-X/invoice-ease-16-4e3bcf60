import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

type InvMeta = { id: string; invoice_number: string; customer_name: string | null };

export async function exportInvoicesOrdersStyle(invoices: InvMeta[]) {
  if (invoices.length === 0) throw new Error("No invoices selected");

  const ids = invoices.map((i) => i.id);
  const { data: items, error } = await supabase
    .from("invoice_items")
    .select("invoice_id, product_name, serial_number, color, quantity")
    .in("invoice_id", ids);
  if (error) throw error;

  // Group items per invoice, merging duplicates (serial+name+color)
  const byInvoice = new Map<string, Map<string, { code: string; name: string; qty: number }>>();
  for (const inv of invoices) byInvoice.set(inv.id, new Map());
  for (const it of items ?? []) {
    const code = (it.serial_number ?? "").trim();
    const name = [(it.product_name ?? "").trim(), (it.color ?? "").trim()].filter(Boolean).join(" ");
    const key = `${code}||${name}`;
    const map = byInvoice.get(it.invoice_id);
    if (!map) continue;
    const ex = map.get(key);
    if (ex) ex.qty += Number(it.quantity ?? 0);
    else map.set(key, { code, name, qty: Number(it.quantity ?? 0) });
  }

  // Build Orders sheet (AOA)
  const aoa: any[][] = [];
  aoa.push([null, null, "Ordered items"]);
  aoa.push(["Inv #", "invoice Name", "Code", "Name", "Quantity"]);

  // Summary aggregator
  const summary = new Map<string, { code: string; name: string; qty: number; invSet: Set<string> }>();

  for (const inv of invoices) {
    const map = byInvoice.get(inv.id)!;
    const rows = Array.from(map.values());
    let invTotal = 0;
    let firstRow = true;
    for (const r of rows) {
      aoa.push([
        firstRow ? inv.invoice_number : null,
        firstRow ? inv.customer_name ?? "" : null,
        r.code,
        r.name,
        r.qty,
      ]);
      firstRow = false;
      invTotal += r.qty;

      const key = `${r.code}||${r.name}`;
      const s = summary.get(key);
      if (s) {
        s.qty += r.qty;
        s.invSet.add(inv.id);
      } else {
        summary.set(key, { code: r.code, name: r.name, qty: r.qty, invSet: new Set([inv.id]) });
      }
    }
    if (rows.length === 0) {
      aoa.push([inv.invoice_number, inv.customer_name ?? "", "", "(no items)", 0]);
    }
    // Invoice total row
    aoa.push([null, null, null, "Invoice Total", invTotal]);
    // Blank separator
    aoa.push([]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 10 }, { wch: 26 }, { wch: 22 }, { wch: 42 }, { wch: 12 }];
  ws["!merges"] = [{ s: { r: 0, c: 2 }, e: { r: 0, c: 4 } }];

  // Summary sheet
  const summaryRows = Array.from(summary.values()).sort((a, b) => b.qty - a.qty);
  const sumAoa: any[][] = [["Code", "Name", "Total Quantity", "Invoices Count"]];
  let grand = 0;
  for (const s of summaryRows) {
    sumAoa.push([s.code, s.name, s.qty, s.invSet.size]);
    grand += s.qty;
  }
  sumAoa.push([]);
  sumAoa.push(["", "TOTAL", grand, ""]);
  const ws2 = XLSX.utils.aoa_to_sheet(sumAoa);
  ws2["!cols"] = [{ wch: 22 }, { wch: 42 }, { wch: 16 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Orders");
  XLSX.utils.book_append_sheet(wb, ws2, "Summary");

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `orders_${date}_${invoices.length}invoices.xlsx`);
}
