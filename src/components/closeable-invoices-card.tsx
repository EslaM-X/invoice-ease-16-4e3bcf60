import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCircle2, Sparkles, Ship, Plane, Truck, Lock, ChevronDown, ChevronUp, Info, Clock, ArrowLeft } from "lucide-react";
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

  const isLoading = loading && !suggestions.length;
  const nowVal = isLoading ? "—" : String(counts.nowFull).padStart(2, "0");
  const incVal = isLoading ? "—" : String(counts.incomingFull).padStart(2, "0");
  const rsvVal = loading && reserved.length === 0 ? "—" : String(reserved.length).padStart(2, "0");

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-[#c9a84c]/25 bg-gradient-to-br from-[#161616] to-[#0d0d0d] shadow-2xl shadow-black/50">
        {/* Top decorative gold bar */}
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[#c9a84c] to-transparent opacity-70" />

        <div className="relative p-5 sm:p-6">
          {/* Header */}
          <div className="mb-6 flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#c9a84c]/30 bg-[#c9a84c]/10">
                <Sparkles className="h-5 w-5 text-[#c9a84c]" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold text-[#fdfcfb] sm:text-lg">
                  {isAr ? "اقتراحات الإقفال الذكية" : "Smart closure suggestions"}
                </h3>
                <p className="mt-0.5 truncate text-[11px] text-white/50">
                  {isAr ? "تحديثات فورية للحالات المعلقة" : "Live pending fulfillment updates"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setWhyOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#c9a84c]/25 bg-[#c9a84c]/5 px-2.5 py-1.5 text-xs font-medium text-[#c9a84c] transition-colors hover:bg-[#c9a84c]/15"
              title={isAr ? "لماذا هذه الأرقام؟" : "Why these numbers?"}
            >
              <Info className="h-3.5 w-3.5" />
              {isAr ? "لماذا؟" : "Why?"}
            </button>
          </div>

          {/* Metrics */}
          <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
            <MetricTile
              as={Link}
              to="/fulfillment"
              tone="emerald"
              icon={<CheckCircle2 className="h-4 w-4" />}
              value={nowVal}
              label={isAr ? "جاهزة الآن" : "Ready now"}
            />
            <MetricTile
              as={Link}
              to="/fulfillment"
              tone="blue"
              icon={<Clock className="h-4 w-4" />}
              value={incVal}
              label={isAr ? "بعد الوصول" : "After arrival"}
            />
            <MetricTile
              as="button"
              onClick={() => setReservedOpen(v => !v)}
              tone="amber"
              icon={<Lock className="h-4 w-4" />}
              value={rsvVal}
              label={isAr ? "محجوزة" : "Reserved"}
              trailing={reservedOpen ? <ChevronUp className="h-3.5 w-3.5 text-amber-500" /> : <ChevronDown className="h-3.5 w-3.5 text-amber-500" />}
            />
          </div>

          {/* CTA */}
          <Link
            to="/fulfillment"
            className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-[#c9a84c] px-6 py-3 text-sm font-bold text-[#0a0a0a] shadow-lg shadow-[#c9a84c]/20 transition-transform hover:scale-[1.01] active:scale-[0.99]"
          >
            <span className="absolute inset-0 bg-white/10 opacity-0 transition-opacity group-hover:opacity-100" />
            <span className="relative">{isAr ? "عرض الاقتراحات الذكية" : "View smart suggestions"}</span>
            <ArrowLeft className="relative h-4 w-4 rtl:rotate-0 ltr:rotate-180" />
          </Link>
        </div>

        {/* Ambient gold glow */}
        <div className="pointer-events-none absolute -bottom-16 left-1/2 h-32 w-64 -translate-x-1/2 bg-[#c9a84c]/10 blur-[80px]" />
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
