import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Sparkles, ArrowLeft, Ship, Plane, Truck, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useBatchedRealtimeTables } from "@/lib/realtime";
import {
  computeSuggestions, DEFAULT_DELIVERY_MODE,
  type FInvoice, type FInvItem, type FDeliveredRow, type FProductRow, type FPOItemRow, type FPORow,
} from "@/lib/fulfillment-engine";

/** Aggregated incoming-shipment slot shown in the "after arrival" strip. */
type IncomingSlot = {
  po_number: string;
  shipment_code: string | null;
  shipment_type: string | null;
  eta: string | null;
  invoiceIds: Set<string>;
};

/**
 * Realtime dashboard card. Shows:
 *  - "Ready to close now" big number (tier === "now_full")
 *  - "After incoming arrival" sibling number (tier === "incoming_full")
 *  - Horizontal scrollable strip of the actual shipments those incoming-full
 *    invoices are waiting on (shipment code D1/A1/G1 + ETA + invoice count)
 */
export function CloseableInvoicesCard() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [counts, setCounts] = useState<{ nowFull: number; incomingFull: number; total: number } | null>(null);
  const [incomingSlots, setIncomingSlots] = useState<IncomingSlot[]>([]);
  const reloadRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    if (!user) return;
    try {
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
      if (invIds.length === 0) { setCounts({ nowFull: 0, incomingFull: 0, total: 0 }); setIncomingSlots([]); return; }

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
        supabase.from("purchase_orders").select("id, po_number, status, expected_arrival_at, shipment_code, shipment_type").then(({ data }) => (data as (FPORow & { shipment_code: string | null; shipment_type: string | null })[]) ?? []),
      ]);

      const productMap = new Map(prodRows.map((p) => [p.id, p]));
      const poMap = new Map(posRows.map((p) => [p.id, p]));
      // po_number → meta so we can enrich engine output (which only carries po_number)
      const poMetaByNumber = new Map<string, { shipment_code: string | null; shipment_type: string | null }>();
      for (const p of posRows) poMetaByNumber.set(p.po_number, { shipment_code: p.shipment_code, shipment_type: p.shipment_type });

      const suggestions = computeSuggestions({
        invoices: invs,
        items,
        deliveredRows,
        products: productMap,
        poItems,
        pos: poMap,
        mode: DEFAULT_DELIVERY_MODE,
      });
      let nowFull = 0, incomingFull = 0;
      const slots = new Map<string, IncomingSlot>();
      for (const s of suggestions) {
        if (s.tier === "now_full") nowFull++;
        else if (s.tier === "incoming_full") {
          incomingFull++;
          for (const need of s.needs) {
            for (const ip of need.incomingPOs) {
              const meta = poMetaByNumber.get(ip.po_number);
              const key = ip.po_number;
              let slot = slots.get(key);
              if (!slot) {
                slot = { po_number: ip.po_number, shipment_code: meta?.shipment_code ?? null, shipment_type: meta?.shipment_type ?? null, eta: ip.eta, invoiceIds: new Set() };
                slots.set(key, slot);
              }
              slot.invoiceIds.add(s.invoice.id);
              // keep earliest eta
              if (ip.eta && (!slot.eta || new Date(ip.eta).getTime() < new Date(slot.eta).getTime())) slot.eta = ip.eta;
            }
          }
        }
      }
      const slotList = Array.from(slots.values()).sort((a, b) => {
        const ea = a.eta ? new Date(a.eta).getTime() : Number.MAX_SAFE_INTEGER;
        const eb = b.eta ? new Date(b.eta).getTime() : Number.MAX_SAFE_INTEGER;
        return ea - eb;
      });
      setCounts({ nowFull, incomingFull, total: suggestions.length });
      setIncomingSlots(slotList);
    } catch {
      // soft-fail
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

  const shipIcon = (t: string | null) => t === "air" ? Plane : t === "door_to_door" ? Truck : Ship;
  const shipTone = (t: string | null) =>
    t === "air"
      ? "bg-sky-500/15 text-sky-700 border-sky-500/30"
      : t === "door_to_door"
        ? "bg-violet-500/15 text-violet-700 border-violet-500/30"
        : "bg-amber-500/15 text-amber-700 border-amber-500/30";

  return (
    <div className="space-y-3">
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
            <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-3xl font-bold tabular-nums tracking-tight text-emerald-700">
                  {counts === null ? "—" : nowFull}
                </span>
                <span className="text-sm font-medium text-foreground/80">
                  {isAr ? "جاهزة للإقفال الآن" : "ready to close now"}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-2xl font-bold tabular-nums tracking-tight text-blue-700">
                  {counts === null ? "—" : incomingFull}
                </span>
                <span className="text-xs font-medium text-foreground/70">
                  {isAr ? "إقفال كامل بعد الوصول" : "full after arrival"}
                </span>
              </div>
            </div>
            {total > 0 && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                {isAr ? `إجمالي مفتوحة: ${total}` : `Total open: ${total}`}
              </div>
            )}
          </div>
          <div className="hidden sm:flex items-center gap-1 text-xs font-semibold text-emerald-700 group-hover:gap-2 transition-all">
            {isAr ? "عرض الاقتراحات" : "View suggestions"}
            <ArrowLeft className={`h-3.5 w-3.5 ${isAr ? "" : "rotate-180"}`} />
          </div>
        </div>
      </Link>

      {incomingSlots.length > 0 && (
        <div className="rounded-2xl border bg-card/60 p-3 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {isAr
              ? `الإقفال الكامل ينتظر وصول ${incomingSlots.length} شحنة`
              : `Full closure awaits ${incomingSlots.length} shipment${incomingSlots.length === 1 ? "" : "s"}`}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:thin]">
            {incomingSlots.map((s) => {
              const Icon = shipIcon(s.shipment_type);
              const tone = shipTone(s.shipment_type);
              const etaLabel = s.eta
                ? new Date(s.eta).toLocaleDateString(isAr ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric" })
                : (isAr ? "بدون تاريخ" : "no ETA");
              const code = s.shipment_code || s.po_number;
              const invCount = s.invoiceIds.size;
              return (
                <Link
                  key={s.po_number}
                  to="/in-transit"
                  className={`group inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs transition hover:-translate-y-0.5 hover:shadow-md ${tone}`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="font-mono font-bold">{code}</span>
                  <span className="text-foreground/60">·</span>
                  <span className="font-medium">{etaLabel}</span>
                  <span className="rounded-full bg-background/70 px-1.5 py-0.5 font-bold tabular-nums">
                    {invCount} {isAr ? "فاتورة" : "inv"}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
