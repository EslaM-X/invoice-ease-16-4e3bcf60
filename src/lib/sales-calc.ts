/**
 * Pure, deterministic sales calculation library.
 *
 * SINGLE SOURCE OF TRUTH for "what was sold on day X".
 *
 * Definition (immutable):
 *   sold_qty(product, day) =
 *     SUM( invoice_items.quantity )
 *     WHERE invoice_items.invoice_id = invoices.id
 *       AND invoices.status <> 'voided'
 *       AND invoices.created_at IN [day 00:00, next-day 00:00) (LOCAL day window)
 *
 * Deleted invoices are gone from the DB → automatically excluded.
 * Voided invoices are excluded by status filter.
 * inventory_logs movements (sale/void/edit-resale/edit-revert/delete/manual)
 *   are NEVER used to compute sold_qty — they are display/audit detail only.
 *
 * This file has NO React, NO Supabase, NO side effects → fully unit-testable.
 */

export type InvoiceStatus = "completed" | "voided" | string;

export interface CalcInvoice {
  id: string;
  invoice_number: string;
  status: InvoiceStatus;
  created_at: string; // ISO
}

export interface CalcInvoiceItem {
  invoice_id: string;
  product_id: string | null;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  quantity: number;
  unit_price: number;
}

export interface CalcInventoryLog {
  product_id: string;
  change: number; // negative = out (sale/edit-resale), positive = in (void/delete/edit-revert/manual+)
  reason: string | null;
  invoice_id: string | null;
  created_at: string;
}

export type MovementKind =
  | "sale"
  | "void"
  | "delete"
  | "edit-resale"
  | "edit-revert"
  | "manual"
  | "other";

export function classifyReason(reason: string | null): MovementKind {
  if (!reason) return "other";
  const r = reason.toLowerCase().trim();
  if (r.startsWith("sale ")) return "sale";
  if (r.startsWith("void ")) return "void";
  if (r.startsWith("delete ")) return "delete";
  if (r.startsWith("edit-resale ")) return "edit-resale";
  if (r.startsWith("edit-revert ")) return "edit-revert";
  if (r.startsWith("manual:") || r.startsWith("manual ")) return "manual";
  return "other";
}

/** Local-day window [start, end) as ISO strings, given YYYY-MM-DD. */
export function dayWindow(yyyyMmDd: string): { startISO: string; endISO: string } {
  const start = new Date(yyyyMmDd + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

export function isWithin(iso: string, startISO: string, endISO: string): boolean {
  return iso >= startISO && iso < endISO;
}

/** A row in the day's sales summary, computed strictly from invoice_items + invoices. */
export interface SoldRow {
  product_id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  unit_price: number;
  sold_qty: number;
  total_value: number;
  invoice_numbers: string[];
}

export interface CalcInputs {
  date: string; // YYYY-MM-DD (local)
  invoices: CalcInvoice[];
  items: CalcInvoiceItem[];
}

/**
 * THE one function that computes "what was sold today".
 * Deterministic. Pure. Idempotent. Same inputs → same outputs.
 */
export function computeSold(inp: CalcInputs): {
  rows: SoldRow[];
  totals: { units: number; value: number; distinct: number };
  excluded: { voided_invoices: number; outside_day: number; non_product_lines: number };
} {
  const { startISO, endISO } = dayWindow(inp.date);

  let voidedCount = 0;
  let outsideCount = 0;
  const validInvoiceIds = new Set<string>();
  const invoiceMeta = new Map<string, CalcInvoice>();

  for (const inv of inp.invoices) {
    if (inv.status === "voided") {
      voidedCount++;
      continue;
    }
    if (!isWithin(inv.created_at, startISO, endISO)) {
      outsideCount++;
      continue;
    }
    validInvoiceIds.add(inv.id);
    invoiceMeta.set(inv.id, inv);
  }

  const map = new Map<string, SoldRow>();
  let nonProductLines = 0;

  for (const it of inp.items) {
    if (!validInvoiceIds.has(it.invoice_id)) continue;
    if (!it.product_id) {
      nonProductLines++;
      continue;
    }
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;
    const price = Number(it.unit_price) || 0;

    const cur = map.get(it.product_id) ?? {
      product_id: it.product_id,
      product_name: it.product_name,
      serial_number: it.serial_number,
      color: it.color,
      unit_price: price,
      sold_qty: 0,
      total_value: 0,
      invoice_numbers: [] as string[],
    };
    cur.sold_qty += qty;
    cur.total_value += qty * price;
    if (price) cur.unit_price = price;
    const invNum = invoiceMeta.get(it.invoice_id)?.invoice_number;
    if (invNum && !cur.invoice_numbers.includes(invNum)) cur.invoice_numbers.push(invNum);
    map.set(it.product_id, cur);
  }

  const rows = Array.from(map.values()).sort((a, b) => b.sold_qty - a.sold_qty);
  const totals = rows.reduce(
    (acc, r) => {
      acc.units += r.sold_qty;
      acc.value += r.total_value;
      return acc;
    },
    { units: 0, value: 0, distinct: rows.length }
  );

  return {
    rows,
    totals,
    excluded: {
      voided_invoices: voidedCount,
      outside_day: outsideCount,
      non_product_lines: nonProductLines,
    },
  };
}

/**
 * Reconciliation: compare invoice-derived sold_qty against
 * inventory_logs net change for the same day.
 *
 * Expected invariant for a healthy day:
 *   For each product:
 *     sold_qty (from invoices) === -SUM(inventory_logs.change)
 *     where logs are kind ∈ {sale, void, edit-resale, edit-revert}
 *     in the same day window AND for invoices that still exist & not voided.
 *
 * Any non-zero diff is reported and surfaced in the audit UI.
 */
export interface ReconcileRow {
  product_id: string;
  product_name: string;
  invoices_sold_qty: number;
  logs_net_out: number; // positive = units that left stock per logs (sale-like)
  diff: number; // invoices_sold_qty - logs_net_out (0 == OK)
  notes: string[];
}

export function reconcileDay(
  inp: CalcInputs & { logs: CalcInventoryLog[] }
): { rows: ReconcileRow[]; ok: boolean; mismatches: number } {
  const { startISO, endISO } = dayWindow(inp.date);
  const sold = computeSold(inp);

  // Logs map: product_id -> net "out" units (positive number)
  const logOut = new Map<string, { out: number; notes: string[] }>();
  for (const l of inp.logs) {
    if (!isWithin(l.created_at, startISO, endISO)) continue;
    const kind = classifyReason(l.reason);
    // Only counters of true sales for the day:
    //   sale: -qty (out)        → counts as +qty out
    //   edit-resale: -qty (out) → counts as +qty out
    //   void: +qty (in)         → counts as -qty out (cancels a same-day sale)
    //   edit-revert: +qty (in)  → counts as -qty out
    //   delete: +qty (in)       → invoice no longer exists → we still net it (cancels its sale row, which we already excluded)
    //   manual: ignored — out-of-band correction
    //   other: ignored
    let outDelta = 0;
    if (kind === "sale" || kind === "edit-resale") outDelta = -l.change; // change is negative
    else if (kind === "void" || kind === "edit-revert" || kind === "delete") outDelta = -l.change; // change positive → outDelta negative
    else continue;

    const cur = logOut.get(l.product_id) ?? { out: 0, notes: [] };
    cur.out += outDelta;
    cur.notes.push(`${kind} ${l.change > 0 ? "+" : ""}${l.change}`);
    logOut.set(l.product_id, cur);
  }

  const productIds = new Set<string>([
    ...sold.rows.map((r) => r.product_id),
    ...Array.from(logOut.keys()),
  ]);

  const rows: ReconcileRow[] = [];
  for (const pid of productIds) {
    const s = sold.rows.find((r) => r.product_id === pid);
    const l = logOut.get(pid);
    const invQty = s?.sold_qty ?? 0;
    const logNet = l?.out ?? 0;
    rows.push({
      product_id: pid,
      product_name: s?.product_name ?? "(unknown)",
      invoices_sold_qty: invQty,
      logs_net_out: logNet,
      diff: invQty - logNet,
      notes: l?.notes ?? [],
    });
  }

  rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const mismatches = rows.filter((r) => r.diff !== 0).length;
  return { rows, ok: mismatches === 0, mismatches };
}
