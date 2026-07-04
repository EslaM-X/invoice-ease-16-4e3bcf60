import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCircle2, Sparkles, Ship, Plane, Truck, Lock, ChevronDown, ChevronUp, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useBatchedRealtimeTables } from "@/lib/realtime";
import { useEffect } from "react";
import { useSuggestionsLive } from "@/lib/fulfillment-live";
import { reasonLabel } from "@/lib/fulfillment-engine";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type ReservedInv = { invoice_id: string; invoice_number: string; customer_name: string | null; reserved_units: number; reserved_lines: number };

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

  const { suggestions, posMeta, loading } = useSuggestionsLive();
  const [reserved, setReserved] = useState<ReservedInv[]>([]);
  const [reservedOpen, setReservedOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);

  const loadReserved = async () => {
    const { data } = await supabase.rpc("get_reserved_invoices_summary" as any);
    setReserved(((data as any) ?? []).map((r: any) => ({
      invoice_id: r.invoice_id, invoice_number: r.invoice_number, customer_name: r.customer_name,
      reserved_units: Number(r.reserved_units || 0), reserved_lines: Number(r.reserved_lines || 0),
    })));
  };
  useEffect(() => { if (user) void loadReserved(); }, [user?.id]);
  useBatchedRealtimeTables(["invoices", "invoice_items", "delivery_receipts", "delivery_receipt_items", "invoice_po_reservations"], () => loadReserved(), [user?.id]);

  const { counts, incomingSlots } = useMemo(() => {
    let nowFull = 0, incomingFull = 0;
    const slots = new Map<string, IncomingSlot>();
    for (const s of suggestions) {
      if (s.tier === "now_full") nowFull++;
      else if (s.tier === "incoming_full") {
        incomingFull++;
        s.needs.forEach(need => need.incomingPOs.forEach(ip => {
          const meta = Array.from(posMeta.values()).find(p => p.po_number === ip.po_number);
          if (!slots.has(ip.po_number)) {
            slots.set(ip.po_number, { po_number: ip.po_number, shipment_code: meta?.shipment_code || null, shipment_type: meta?.shipment_type || null, eta: ip.eta, invoiceIds: new Set() });
          }
          slots.get(ip.po_number)!.invoiceIds.add(s.invoice.id);
        }));
      }
    }
    return {
      counts: { nowFull, incomingFull, total: suggestions.length },
      incomingSlots: Array.from(slots.values()).sort((a, b) => (a.eta || "").localeCompare(b.eta || "")),
    };
  }, [suggestions, posMeta]);

  const shipIcon = (t: string | null) => t === "air" ? Plane : t === "door_to_door" ? Truck : Ship;
  const shipTone = (t: string | null) => t === "air" ? "bg-sky-500/10 text-sky-700 border-sky-500/20" : t === "door_to_door" ? "bg-violet-500/10 text-violet-700 border-violet-500/20" : "bg-amber-500/10 text-amber-700 border-amber-500/20";

  return (
    <div className="space-y-3">
      <div className="group relative rounded-2xl border bg-card p-4 sm:p-5 shadow-sm transition hover:shadow-md">
        <Link to="/fulfillment" className="absolute inset-0 rounded-2xl" aria-label={isAr ? "افتح صفحة الاقتراحات" : "Open suggestions"} />
        <div className="relative flex items-center gap-3 sm:gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-3 w-3 shrink-0" />
              <span className="truncate">{isAr ? "اقتراحات الإقفال الذكية" : "Smart closure suggestions"}</span>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setWhyOpen(true); }}
                className="relative z-10 ms-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted"
                title={isAr ? "لماذا هذه الأرقام؟" : "Why these numbers?"}
              >
                <Info className="h-3 w-3" />
                {isAr ? "لماذا؟" : "Why?"}
              </button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-2 sm:flex sm:flex-wrap sm:gap-x-6">
              <div className="flex flex-col">
                <span className="text-2xl font-bold tabular-nums transition-all">{loading && !suggestions.length ? "—" : counts.nowFull}</span>
                <span className="text-xs text-muted-foreground">{isAr ? "جاهزة الآن" : "Ready now"}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-2xl font-bold tabular-nums text-blue-600 transition-all">{loading && !suggestions.length ? "—" : counts.incomingFull}</span>
                <span className="text-xs text-muted-foreground">{isAr ? "بعد الوصول" : "After arrival"}</span>
              </div>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setReservedOpen(v => !v); }}
                className="relative z-10 flex flex-col text-start hover:opacity-80 transition"
              >
                <span className="text-2xl font-bold tabular-nums text-amber-600 inline-flex items-center gap-1">
                  <Lock className="h-4 w-4" />
                  {loading && reserved.length === 0 ? "—" : reserved.length}
                  {reservedOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </span>
                <span className="text-xs text-muted-foreground">{isAr ? "محجوزة" : "Reserved"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

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

      {reservedOpen && reserved.length > 0 && (
        <div className="rounded-xl border bg-card p-3 text-xs">
          <div className="mb-2 flex items-center justify-between text-muted-foreground">
            <span>{isAr ? "الفواتير المحجوزة (لحظياً)" : "Reserved invoices (live)"}</span>
            <span className="font-bold text-amber-600">
              {reserved.reduce((s, r) => s + r.reserved_units, 0)} {isAr ? "قطعة" : "units"}
            </span>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {reserved.map(r => (
              <Link
                key={r.invoice_id}
                to="/invoices/$id"
                params={{ id: r.invoice_id }}
                className="flex items-center justify-between rounded-lg border bg-background px-3 py-2 hover:bg-muted transition"
              >
                <div className="min-w-0 truncate">
                  <span className="font-bold">{r.invoice_number}</span>
                  {r.customer_name && <span className="ms-2 text-muted-foreground">· {r.customer_name}</span>}
                </div>
                <div className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 font-bold text-amber-700">
                  {r.reserved_units}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <Dialog open={whyOpen} onOpenChange={setWhyOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              {isAr ? "شرح قرارات الإقفال" : "Closure decision breakdown"}
            </DialogTitle>
          </DialogHeader>
          <div className="text-xs text-muted-foreground mb-3">
            {isAr
              ? "كل فاتورة يظهر لها السبب: المخزون الحر المتاح، والحجوزات السابقة، والشحنات القادمة."
              : "Each invoice shows why it was classified: free stock, prior reservations, and incoming shipments."}
          </div>
          {suggestions.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">{isAr ? "لا توجد فواتير مفتوحة" : "No open invoices"}</div>
          ) : (
            <ul className="space-y-2">
              {suggestions.slice(0, 100).map(s => (
                <li key={s.invoice.id} className="rounded-lg border bg-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <Link
                      to="/invoices/$id" params={{ id: s.invoice.id }}
                      onClick={() => setWhyOpen(false)}
                      className="font-bold hover:underline"
                    >
                      {s.invoice.invoice_number}
                    </Link>
                    <TierChip tier={s.tier} isAr={isAr} />
                  </div>
                  {s.invoice.customer_name && <div className="text-xs text-muted-foreground mb-2">{s.invoice.customer_name}</div>}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <Metric label={isAr ? "مطلوب" : "Needed"} value={s.totalNeeded} tone="" />
                    <Metric label={isAr ? "من المخزون" : "From stock"} value={s.totalFromStock} tone="text-emerald-600" />
                    <Metric label={isAr ? "من الشحنات" : "From incoming"} value={s.totalFromIncoming} tone="text-blue-600" />
                    <Metric label={isAr ? "نقص" : "Shortfall"} value={s.totalShortfall} tone={s.totalShortfall > 0 ? "text-red-600" : ""} />
                  </div>
                  {s.reasons.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.reasons.map((r, i) => (
                        <span key={i} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
                          {reasonLabel(r.code, isAr)}{r.detail ? ` · ${r.detail}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="pt-3">
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link to="/fulfillment-decisions" onClick={() => setWhyOpen(false)}>
                {isAr ? "الصفحة التفصيلية الكاملة" : "Full audit page"}
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-md bg-muted/40 p-1.5">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function TierChip({ tier, isAr }: { tier: string; isAr: boolean }) {
  const map: Record<string, { ar: string; en: string; cls: string }> = {
    now_full:         { ar: "جاهزة الآن",       en: "Ready now",      cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
    now_partial:      { ar: "جزئي من المخزون",  en: "Partial stock",  cls: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
    incoming_full:    { ar: "بعد الوصول",       en: "After arrival",  cls: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
    incoming_partial: { ar: "جزئي بعد الوصول",  en: "Partial after",  cls: "bg-violet-500/10 text-violet-700 border-violet-500/30" },
    blocked:          { ar: "محجوبة",           en: "Blocked",        cls: "bg-red-500/10 text-red-700 border-red-500/30" },
  };
  const m = map[tier] || map.blocked;
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${m.cls}`}>{isAr ? m.ar : m.en}</span>;
}
