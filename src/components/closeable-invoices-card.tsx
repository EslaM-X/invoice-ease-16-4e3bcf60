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

type IncomingSlot = {
  po_number: string;
  shipment_code: string | null;
  shipment_type: string | null;
  eta: string | null;
  invoiceIds: Set<string>;
};

export function CloseableInvoicesCard() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [counts, setCounts] = useState<{ nowFull: number; incomingFull: number; total: number } | null>(null);
  const [incomingSlots, setIncomingSlots] = useState<IncomingSlot[]>([]);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const reloadRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  void reloadRef;

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

      if (invs.length === 0) {
        setCounts({ nowFull: 0, incomingFull: 0, total: 0 });
        setIncomingSlots([]);
        return;
      }

      const invIds = invs.map((i) => i.id);
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
        supabase.from("purchase_orders").select("id, po_number, status, expected_arrival_at, shipment_code, shipment_type").then(({ data }) => (data as (FPORow & { shipment_code: string | null; shipment_type: string | null })[]) ?? []),
      ]);

      const suggestions = computeSuggestions({
        invoices: invs,
        items,
        deliveredRows,
        products: new Map(prodRows.map(p => [p.id, p])),
        poItems,
        pos: new Map(posRows.map(p => [p.id, p])),
        mode: DEFAULT_DELIVERY_MODE,
      });

      let nowFull = 0, incomingFull = 0;
      const slots = new Map<string, IncomingSlot>();
      
      suggestions.forEach(s => {
        if (s.tier === "now_full") nowFull++;
        else if (s.tier === "incoming_full") {
          incomingFull++;
          s.needs.forEach(need => need.incomingPOs.forEach(ip => {
            const meta = posRows.find(p => p.po_number === ip.po_number);
            if (!slots.has(ip.po_number)) {
              slots.set(ip.po_number, { po_number: ip.po_number, shipment_code: meta?.shipment_code || null, shipment_type: meta?.shipment_type || null, eta: ip.eta, invoiceIds: new Set() });
            }
            slots.get(ip.po_number)!.invoiceIds.add(s.invoice.id);
          }));
        }
      });

      setCounts({ nowFull, incomingFull, total: suggestions.length });
      setIncomingSlots(Array.from(slots.values()).sort((a, b) => (a.eta || "").localeCompare(b.eta || "")));
    } catch (e) {
      console.error("Error loading dashboard data:", e);
    } finally {
      setIsFirstLoad(false);
    }
  };

  useEffect(() => { if (user) void load(); }, [user?.id]);
  useBatchedRealtimeTables(["invoices", "invoice_items", "purchase_orders"], () => load(), [user?.id]);

  const shipIcon = (t: string | null) => t === "air" ? Plane : t === "door_to_door" ? Truck : Ship;
  const shipTone = (t: string | null) => t === "air" ? "bg-sky-500/10 text-sky-700 border-sky-500/20" : t === "door_to_door" ? "bg-violet-500/10 text-violet-700 border-violet-500/20" : "bg-amber-500/10 text-amber-700 border-amber-500/20";

  return (
    <div className="space-y-3">
      <Link to="/fulfillment" className="group relative block rounded-2xl border bg-card p-5 shadow-sm transition hover:shadow-md">
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              {isAr ? "اقتراحات الإقفال الذكية" : "Smart closure suggestions"}
            </div>
            <div className="mt-2 flex gap-6">
              <div className="flex flex-col">
                <span className="text-2xl font-bold">{isLoading ? "..." : counts?.nowFull ?? 0}</span>
                <span className="text-xs text-muted-foreground">{isAr ? "جاهزة للإقفال الآن" : "Ready now"}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-2xl font-bold text-blue-600">{isLoading ? "..." : counts?.incomingFull ?? 0}</span>
                <span className="text-xs text-muted-foreground">{isAr ? "إقفال بعد الوصول" : "After arrival"}</span>
              </div>
            </div>
          </div>
        </div>
      </Link>

      {incomingSlots.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none]">
          {incomingSlots.map((s) => {
            const Icon = shipIcon(s.shipment_type);
            return (
              <div key={s.po_number} className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs ${shipTone(s.shipment_type)}`}>
                <Icon className="h-3 w-3" />
                <span className="font-bold">{s.shipment_code || s.po_number}</span>
                <span>{s.eta ? new Date(s.eta).toLocaleDateString() : "---"}</span>
                <span className="rounded-full bg-white/50 px-1.5 font-bold">{s.invoiceIds.size}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
