import { useMemo } from "react";
import { Coins, Ship, Landmark, Plus, Receipt, Wallet } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmtMoney, fmtMoneyAdaptive, fmtNumber } from "@/lib/utils-money";
import { computePOCost, sumPOCosts, type POCostRow } from "@/lib/po-cost";

/* ------------------------------------------------------------------ */
/* Grand total banner — Noir & Gold                                    */
/* ------------------------------------------------------------------ */

export function POCostBanner({ rows }: { rows: POCostRow[] }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const t = useMemo(() => sumPOCosts(rows), [rows]);
  const total = fmtMoneyAdaptive(t.totalEgp, "EGP", lang);

  const parts: { label: string; value: number; icon: any }[] = [
    { label: isAr ? "أساس بالجنيه" : "Base EGP", value: t.baseEgp, icon: Coins },
    { label: isAr ? "الجمارك" : "Customs", value: t.customsEgp, icon: Landmark },
    { label: isAr ? "الشحن" : "Shipping", value: t.shippingEgp, icon: Ship },
    { label: isAr ? "تكلفة إضافية" : "Extra", value: t.otherEgp, icon: Plus },
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card p-5 text-card-foreground shadow-lg">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5" />
      <div className="pointer-events-none absolute -end-16 -top-20 h-56 w-56 rounded-full bg-primary/15 blur-3xl" />


      <div className="relative flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-[240px]">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
            <Wallet className="h-3.5 w-3.5" />
            {isAr ? "إجمالي تكلفة أوامر الشراء" : "Total purchase-order cost"}
          </div>
          <div className="mt-1 text-4xl font-black tabular-nums tracking-tight text-primary drop-shadow-sm">
            {total.short}
          </div>
          {total.compact && (
            <div className="text-xs tabular-nums text-muted-foreground">≈ {total.full}</div>
          )}
          <div className="mt-1 text-[11px] text-muted-foreground">

            {isAr
              ? `${fmtNumber(t.poCount, lang)} أمر شراء · ${fmtNumber(t.qty, lang)} قطعة · $${t.usd.toFixed(2)} · متوسط الصرف ${t.avgRate.toFixed(2)}`
              : `${fmtNumber(t.poCount, lang)} POs · ${fmtNumber(t.qty, lang)} units · $${t.usd.toFixed(2)} · avg rate ${t.avgRate.toFixed(2)}`}
          </div>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
          {parts.map((p) => {
            const Icon = p.icon;
            const pct = t.totalEgp > 0 ? (p.value / t.totalEgp) * 100 : 0;
            const v = fmtMoneyAdaptive(p.value, "EGP", lang);
            return (
              <div
                key={p.label}
                className="rounded-xl border border-primary/20 bg-muted/60 p-2.5"
                title={v.full}
              >
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Icon className="h-3 w-3 text-primary" />
                  {p.label}
                </div>
                <div className="mt-0.5 text-sm font-bold tabular-nums text-foreground">{v.short}</div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border">

                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-muted/60 px-2 py-0.5 font-semibold text-foreground">
          <Receipt className="h-3 w-3" />
          {isAr ? "الضرائب غير محتسبة ضمن التكلفة" : "Taxes excluded from cost"}
          {" · "}
          <span className="tabular-nums text-muted-foreground">{fmtMoney(t.taxesEgp, "EGP", lang)}</span>
        </span>
        {t.pricedCount < t.poCount && (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-400">

            {isAr
              ? `${t.poCount - t.pricedCount} أمر بانتظار التسعير`
              : `${t.poCount - t.pricedCount} awaiting pricing`}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Per-row cost breakdown                                              */
/* ------------------------------------------------------------------ */

export function POCostCell({ po, compact }: { po: POCostRow; compact?: boolean }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const c = useMemo(() => computePOCost(po), [po]);

  if (!c.priced) {
    return (
      <div className="text-end">
        <span className="inline-flex rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
          {isAr ? "بانتظار تسعير المدير المالي" : "Awaiting CFO pricing"}
        </span>
      </div>
    );
  }

  const chip = (label: string, value: number, tone: "gold" | "muted" = "gold") => (
    <span
      key={label}
      title={fmtMoney(value, "EGP", lang)}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
        tone === "gold"
          ? "border-primary/25 bg-primary/10 text-foreground"
          : "border-border bg-muted/60 text-muted-foreground"
      }`}
    >
      <span className="opacity-70">{label}</span>
      {fmtMoneyAdaptive(value, "EGP", lang).short}
    </span>
  );

  const total = fmtMoneyAdaptive(c.totalEgp, "EGP", lang);

  return (
    <div className={`text-end ${compact ? "" : "min-w-[210px]"}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {isAr ? "إجمالي التكلفة (EGP)" : "Landed cost (EGP)"}
      </div>
      <div className="text-lg font-black tabular-nums text-primary" title={total.full}>
        {total.short}
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums">
        {isAr ? "سعر الصرف" : "FX"} {c.rate.toFixed(2)}
        {c.unitEgp > 0 && (
          <> · {isAr ? "للوحدة" : "per unit"} {fmtMoneyAdaptive(c.unitEgp, "EGP", lang).short}</>
        )}
      </div>
      <div className="mt-1 flex flex-wrap justify-end gap-1">
        {chip(isAr ? "أساس" : "Base", c.baseEgp)}
        {c.customsEgp > 0 && chip(isAr ? "جمارك" : "Customs", c.customsEgp)}
        {c.shippingEgp > 0 && chip(isAr ? "شحن" : "Shipping", c.shippingEgp)}
        {c.otherEgp > 0 && chip(isAr ? "إضافي" : "Extra", c.otherEgp)}
        {c.taxesEgp > 0 &&
          chip(isAr ? "ضرائب (خارج التكلفة)" : "Taxes (excluded)", c.taxesEgp, "muted")}
      </div>
    </div>
  );
}
