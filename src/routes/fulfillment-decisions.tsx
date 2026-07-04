import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useI18n } from "@/lib/i18n";
import { useSuggestionsLive } from "@/lib/fulfillment-live";
import { reasonLabel, type Tier } from "@/lib/fulfillment-engine";
import { Input } from "@/components/ui/input";
import { Search, ClipboardCheck } from "lucide-react";

export const Route = createFileRoute("/fulfillment-decisions")({
  component: () => <AppShell><FulfillmentDecisionsPage /></AppShell>,
});

const TIER_META: Record<Tier, { ar: string; en: string; cls: string }> = {
  now_full:         { ar: "جاهزة الآن",       en: "Ready now",      cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
  now_partial:      { ar: "جزئي من المخزون",  en: "Partial stock",  cls: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
  incoming_full:    { ar: "بعد الوصول",       en: "After arrival",  cls: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
  incoming_partial: { ar: "جزئي بعد الوصول",  en: "Partial after",  cls: "bg-violet-500/10 text-violet-700 border-violet-500/30" },
  blocked:          { ar: "محجوبة",           en: "Blocked",        cls: "bg-red-500/10 text-red-700 border-red-500/30" },
};

function FulfillmentDecisionsPage() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { suggestions, loading } = useSuggestionsLive();
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<Tier | "all">("all");

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return suggestions.filter(s => {
      if (tier !== "all" && s.tier !== tier) return false;
      if (!term) return true;
      return s.invoice.invoice_number.toLowerCase().includes(term)
          || (s.invoice.customer_name || "").toLowerCase().includes(term);
    });
  }, [suggestions, q, tier]);

  const stats = useMemo(() => {
    const acc: Record<Tier, number> = { now_full: 0, now_partial: 0, incoming_full: 0, incoming_partial: 0, blocked: 0 };
    for (const s of suggestions) acc[s.tier]++;
    return acc;
  }, [suggestions]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ClipboardCheck className="h-6 w-6 text-primary" />
          {isAr ? "تدقيق قرارات الإقفال" : "Closure Decisions Audit"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAr
            ? "شرح تفصيلي لكل فاتورة: المخزون الحر (بعد الحجوزات السابقة)، الشحنات القادمة، والأسباب."
            : "For every open invoice: free stock after prior reservations, incoming POs, and the reasons behind the tier."}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {(Object.keys(TIER_META) as Tier[]).map(t => (
          <button
            key={t}
            onClick={() => setTier(tier === t ? "all" : t)}
            className={`rounded-xl border p-3 text-start transition ${tier === t ? "ring-2 ring-primary" : "hover:bg-muted/40"} ${TIER_META[t].cls}`}
          >
            <div className="text-xs">{isAr ? TIER_META[t].ar : TIER_META[t].en}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{stats[t]}</div>
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder={isAr ? "بحث بفاتورة أو عميل..." : "Search invoice or customer..."} className="ps-9" />
      </div>

      {loading && suggestions.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">{isAr ? "جاري التحميل..." : "Loading..."}</div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">{isAr ? "لا توجد نتائج" : "No results"}</div>
      ) : (
        <ul className="space-y-2">
          {visible.map(s => (
            <li key={s.invoice.id} className="rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to="/invoices/$id" params={{ id: s.invoice.id }} className="font-bold hover:underline">
                  {s.invoice.invoice_number}
                </Link>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${TIER_META[s.tier].cls}`}>
                  {isAr ? TIER_META[s.tier].ar : TIER_META[s.tier].en}
                </span>
              </div>
              {s.invoice.customer_name && <div className="text-xs text-muted-foreground mt-0.5">{s.invoice.customer_name}</div>}
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <M label={isAr ? "مطلوب" : "Needed"}       v={s.totalNeeded} />
                <M label={isAr ? "من المخزون" : "Stock"}   v={s.totalFromStock} tone="text-emerald-600" />
                <M label={isAr ? "من الشحنات" : "Incoming"} v={s.totalFromIncoming} tone="text-blue-600" />
                <M label={isAr ? "نقص" : "Shortfall"}      v={s.totalShortfall} tone={s.totalShortfall > 0 ? "text-red-600" : ""} />
              </div>
              {s.needs.length > 0 && (
                <div className="mt-2 space-y-1 text-xs">
                  {s.needs.map((n, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 px-2 py-1">
                      <span className="font-medium truncate">{n.product_name}</span>
                      <span className="text-muted-foreground">×{n.needed}</span>
                      {n.fromStock > 0 && <span className="text-emerald-600">{isAr ? "مخزون" : "stock"} {n.fromStock}</span>}
                      {n.fromIncoming > 0 && <span className="text-blue-600">{isAr ? "قادم" : "in"} {n.fromIncoming}</span>}
                      {n.shortfall > 0 && <span className="text-red-600 font-semibold">{isAr ? "نقص" : "short"} {n.shortfall}</span>}
                      {n.incomingPOs.length > 0 && (
                        <span className="text-muted-foreground">
                          · {n.incomingPOs.map(p => `${p.po_number}(${p.qty})`).join(", ")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
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
    </div>
  );
}

function M({ label, v, tone = "" }: { label: string; v: number; tone?: string }) {
  return (
    <div className="rounded-md bg-muted/40 p-1.5">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`font-bold tabular-nums ${tone}`}>{v}</div>
    </div>
  );
}
