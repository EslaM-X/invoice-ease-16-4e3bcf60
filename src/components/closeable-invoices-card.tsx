import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Sparkles, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useBatchedRealtimeTables } from "@/lib/realtime";
import {
  computeSuggestions, DEFAULT_DELIVERY_MODE,
  type FInvoice, type FInvItem, type FDeliveredRow, type FProductRow, type FPOItemRow, type FPORow,
} from "@/lib/fulfillment-engine";

/**
 * Lightweight realtime card for the dashboard: shows the number of invoices
 * that are FULLY closeable right now from on-hand stock (tier === "now_full"),
 * plus a "needs incoming POs" sibling count. Reuses the exact same engine the
 * /fulfillment page uses, so numbers always agree.
 */
export function CloseableInvoicesCard() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [counts, setCounts] = useState<{ nowFull: number; incomingFull: number; total: number } | null>(null);
  const reloadRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    if (!user) return;
    try {
      // Pull only what the engine needs. Skip voided/draft + delivered invoices.
      const PAGE = 1000;
      const pageAll = async <T,>(build: (from: number, to: number) => any): Promise<T[]> => {
        const out: T[] = []; let from = 0;
        // eslint-disable-next-line no-constant-condition
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
          .order("created_at", { ascending: true })
          .range(from, to),
      );
      const invIds = invs.map((i) => i.id);
      if (invIds.length === 0) { setCounts({ nowFull: 0, incomingFull: 0, total: 0 }); return; }

      const inChunks = async <T,>(table: string, cols: string, key: string, ids: string[]) => {
        const out: T[] = [];
        for (let i = 0; i < ids.length; i += 200) {
          const slice = ids.slice(i, i + 200);
          const rows = await pageAll<T>((from, to) =>
            supabase.from(table as any).select(cols).in(key, slice).range(from, to),
          );
          out.push(...rows);
        }
        return out;
      };

      const [items, deliveredRows, prodRows, poItems, posRows] = await Promise.all([
        inChunks<FInvItem>("invoice_items", "id, invoice_id, product_id, product_name, serial_number, color, quantity, unit_price", "invoice_id", invIds),
        inChunks<FDeliveredRow & { invoice_id?: string }>("delivery_receipt_items", "invoice_item_id, quantity, note, invoice_id", "invoice_id", invIds),
        supabase.from("products").select("id, name, stock_quantity, serial_number, color").then(({ data }) => (data as FProductRow[]) ?? []),
        supabase.from("purchase_order_items").select("po_id, product_id, quantity, received_qty").then(({ data }) => (data as FPOItemRow[]) ?? []),
        supabase.from("purchase_orders").select("id, po_number, status, expected_arrival_at").then(({ data }) => (data as FPORow[]) ?? []),
      ]);

      const productMap = new Map(prodRows.map((p) => [p.id, p]));
      const poMap = new Map(posRows.map((p) => [p.id, p]));

      const suggestions = computeSuggestions({
        invoices: invs,
        items,
        delivered: deliveredRows,
        products: productMap,
        poItems,
        pos: poMap,
        mode: DEFAULT_DELIVERY_MODE,
      });
      let nowFull = 0, incomingFull = 0;
      for (const s of suggestions) {
        if (s.tier === "now_full") nowFull++;
        else if (s.tier === "incoming_full") incomingFull++;
      }
      setCounts({ nowFull, incomingFull, total: suggestions.length });
    } catch {
      // soft-fail: keep prior counts
    }
  };

  useEffect(() => { if (user) void load(); /* eslint-disable-next-line */ }, [user?.id]);

  const scheduleReload = () => {
    if (reloadRef.current) clearTimeout(reloadRef.current);
    reloadRef.current = setTimeout(() => { void load(); }, 400);
  };
  useEffect(() => () => { if (reloadRef.current) clearTimeout(reloadRef.current); }, []);
  useBatchedRealtimeTables(
    ["invoices", "invoice_items", "delivery_receipts", "delivery_receipt_items", "products", "purchase_orders", "purchase_order_items"],
    scheduleReload,
    [user?.id],
  );

  const nowFull = counts?.nowFull ?? 0;
  const incomingFull = counts?.incomingFull ?? 0;
  const total = counts?.total ?? 0;

  return (
    <Link
      to="/fulfillment"
      className="group relative block overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-500/10 via-primary/5 to-transparent p-5 shadow-sm transition hover:shadow-md"
    >
      <div className="absolute -end-8 -top-8 h-32 w-32 rounded-full bg-emerald-500/15 blur-3xl transition group-hover:bg-emerald-500/25" />
      <div className="relative flex flex-wrap items-center gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-700 shadow-sm">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="eyebrow flex items-center gap-1.5 text-[10px] text-emerald-700/80">
            <Sparkles className="h-3 w-3" />
            {isAr ? "اقتراحات الإقفال الذكية · لحظي" : "Smart closure · live"}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold tabular-nums tracking-tight text-emerald-700">
              {counts === null ? "—" : nowFull}
            </span>
            <span className="text-sm font-medium text-foreground/80">
              {isAr ? "فاتورة جاهزة للإقفال الآن" : "invoices ready to close now"}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {incomingFull > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                {isAr ? `${incomingFull} بعد وصول الشحنات` : `${incomingFull} after incoming shipments`}
              </span>
            )}
            {total > 0 && (
              <span>{isAr ? `إجمالي مفتوحة: ${total}` : `Total open: ${total}`}</span>
            )}
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1 text-xs font-semibold text-emerald-700 group-hover:gap-2 transition-all">
          {isAr ? "عرض الاقتراحات" : "View suggestions"}
          <ArrowLeft className={`h-3.5 w-3.5 ${isAr ? "" : "rotate-180"}`} />
        </div>
      </div>
    </Link>
  );
}
