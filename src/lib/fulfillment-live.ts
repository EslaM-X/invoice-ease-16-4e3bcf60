// Shared live loader for smart-closure suggestions. Used by the dashboard
// card and the standalone /fulfillment-decisions audit page so both share
// the exact same math and realtime refresh behavior.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBatchedRealtimeTables } from "@/lib/realtime";
import {
  computeSuggestions, DEFAULT_DELIVERY_MODE, INCOMING_PO_STATUSES,
  type FInvoice, type FInvItem, type FDeliveredRow, type FProductRow, type FPOItemRow, type FPORow,
  type Suggestion,
} from "@/lib/fulfillment-engine";

export type ShipmentPO = FPORow & { shipment_code: string | null; shipment_type: string | null };

export function useSuggestionsLive() {
  const { user } = useAuth();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [posMeta, setPosMeta] = useState<Map<string, ShipmentPO>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    try {
      const PAGE = 1000;
      const pageAll = async <T,>(build: (from: number, to: number) => any): Promise<T[]> => {
        const out: T[] = []; let from = 0;
        while (true) {
          const { data, error } = await build(from, from + PAGE - 1);
          if (error) throw error;
          const rows = (data ?? []) as T[];
          out.push(...rows);
          if (rows.length < PAGE) break;
          from += PAGE;
        }
        return out;
      };

      const invs = await pageAll<FInvoice>((from, to) =>
        supabase.from("invoices")
          .select("id, invoice_number, customer_name, customer_phone, total, created_at, delivery_status, status")
          .not("status", "in", "(voided,draft)")
          .or("delivery_status.is.null,delivery_status.neq.delivered")
          .range(from, to),
      );

      if (invs.length === 0) { setSuggestions([]); setPosMeta(new Map()); return; }

      const invIds = invs.map(i => i.id);
      const inChunks = async <T,>(table: string, cols: string, key: string, ids: string[]) => {
        const out: T[] = [];
        for (let i = 0; i < ids.length; i += 200) {
          const slice = ids.slice(i, i + 200);
          const { data } = await supabase.from(table as any).select(cols).in(key, slice);
          if (data) out.push(...(data as T[]));
        }
        return out;
      };

      const [items, deliveredRows, prodRows, poItems, posRows] = await Promise.all([
        inChunks<FInvItem>("invoice_items", "id, invoice_id, product_id, product_name, serial_number, color, quantity, unit_price", "invoice_id", invIds),
        inChunks<FDeliveredRow & { invoice_id?: string }>("delivery_receipt_items", "invoice_item_id, quantity, note, invoice_id", "invoice_id", invIds),
        supabase.from("products").select("id, name, stock_quantity, serial_number, color").then(({ data }) => (data as FProductRow[]) ?? []),
        supabase.from("purchase_order_items").select("po_id, product_id, quantity, received_qty").then(({ data }) => (data as FPOItemRow[]) ?? []),
        supabase.from("purchase_orders").select("id, po_number, status, expected_arrival_at, shipment_code, shipment_type").in("status", Array.from(INCOMING_PO_STATUSES)).then(({ data }) => (data as ShipmentPO[]) ?? []),
      ]);

      const posMap = new Map(posRows.map(p => [p.id, p]));
      const s = computeSuggestions({
        invoices: invs,
        items,
        deliveredRows,
        products: new Map(prodRows.map(p => [p.id, p])),
        poItems: poItems.filter(pi => posMap.has(pi.po_id)),
        pos: posMap,
        mode: DEFAULT_DELIVERY_MODE,
      });
      setSuggestions(s);
      setPosMeta(posMap);
    } catch (e) {
      console.error("useSuggestionsLive error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) void load(); }, [user?.id]);
  useBatchedRealtimeTables(
    ["invoices", "invoice_items", "purchase_orders", "delivery_receipts", "delivery_receipt_items"],
    () => load(), [user?.id],
  );

  return { suggestions, posMeta, loading, reload: load };
}
