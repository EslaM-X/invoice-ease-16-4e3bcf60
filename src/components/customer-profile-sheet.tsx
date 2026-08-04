import { Link } from "@tanstack/react-router";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { VatBadge } from "@/components/vat-badge";
import { fmtMoney, fmtDate } from "@/lib/utils-money";
import {
  deliveryClass, deliveryLabel, invoicePayable, tierClass, tierLabel,
  type CustomerStats,
} from "@/lib/customer-stats";
import { FileText, Phone, Building2, TrendingUp, Wallet, Receipt, AlertCircle } from "lucide-react";

export function CustomerProfileSheet({
  open,
  onOpenChange,
  customer,
  stats,
  isAr,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customer: { id: string; name: string; phone?: string | null; company_name?: string | null } | null;
  stats: CustomerStats | null;
  isAr: boolean;
}) {
  if (!customer || !stats) return null;
  const pctPaid = stats.totalValue > 0 ? Math.round((stats.paid / stats.totalValue) * 100) : 0;
  const pctDelivered = Math.round(stats.deliveredRatio * 100);

  const kpis = [
    { icon: TrendingUp, label: isAr ? "إجمالي التعاملات" : "Total volume", value: fmtMoney(stats.totalValue) },
    { icon: Receipt, label: isAr ? "عدد الفواتير" : "Invoices", value: String(stats.count) },
    { icon: Wallet, label: isAr ? "المسدد" : "Paid", value: fmtMoney(stats.paid) },
    { icon: AlertCircle, label: isAr ? "المتبقي" : "Remaining", value: fmtMoney(stats.remaining) },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isAr ? "right" : "left"} className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="text-start">
          <SheetTitle className="flex flex-wrap items-center gap-2 text-xl">
            <span className="text-gradient-gold">{customer.name}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tierClass(stats.tier)}`}>
              {tierLabel(stats.tier, isAr)}
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {customer.phone ? <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{customer.phone}</span> : null}
          {customer.company_name ? <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{customer.company_name}</span> : null}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-xl border bg-card p-3">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <k.icon className="h-3.5 w-3.5" />{k.label}
              </div>
              <div className="mt-1 text-lg font-bold tabular-nums">{k.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          <Bar label={isAr ? "نسبة التسليم" : "Delivered"} pct={pctDelivered} tone="emerald"
            note={`${stats.delivered} ${isAr ? "مكتمل" : "complete"} · ${stats.partial} ${isAr ? "جزئي" : "partial"} · ${stats.pending} ${isAr ? "في الانتظار" : "pending"}`} />
          <Bar label={isAr ? "نسبة السداد" : "Paid"} pct={pctPaid} tone="amber"
            note={`${fmtMoney(stats.paid)} / ${fmtMoney(stats.totalValue)}`} />
        </div>

        {stats.count > 0 ? (
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>{isAr ? "متوسط الفاتورة" : "Avg invoice"}: <b className="text-foreground">{fmtMoney(stats.avgValue)}</b></span>
            {stats.firstAt ? <span>{isAr ? "أول تعامل" : "First"}: {fmtDate(stats.firstAt, isAr ? "ar" : "en")}</span> : null}
            {stats.lastAt ? <span>{isAr ? "آخر تعامل" : "Last"}: {fmtDate(stats.lastAt, isAr ? "ar" : "en")}</span> : null}
          </div>
        ) : null}

        <div className="mt-6">
          <div className="mb-2 text-sm font-semibold">{isAr ? "الفواتير" : "Invoices"}</div>
          {stats.invoices.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              {isAr ? "لا توجد فواتير لهذا العميل بعد" : "No invoices for this customer yet"}
            </div>
          ) : (
            <div className="space-y-2">
              {stats.invoices.map((inv) => {
                const payable = invoicePayable(inv);
                const paid = Math.min(Number(inv.paid_amount ?? 0), payable);
                const rem = Math.max(0, payable - paid);
                return (
                  <Link
                    key={inv.id}
                    to="/invoices/$id"
                    params={{ id: inv.id }}
                    onClick={() => onOpenChange(false)}
                    className="block rounded-xl border bg-card p-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        {inv.invoice_number || inv.id.slice(0, 8)}
                      </span>
                      <span className="text-sm font-bold tabular-nums">{fmtMoney(payable)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className={`rounded-full border px-2 py-0.5 font-semibold ${deliveryClass(inv.delivery_computed_state)}`}>
                        {deliveryLabel(inv.delivery_computed_state, isAr)}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 font-semibold ${
                        rem <= 0.01
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                          : "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300"
                      }`}>
                        {rem <= 0.01 ? (isAr ? "مدفوعة" : "Paid") : `${isAr ? "متبقي" : "Due"} ${fmtMoney(rem)}`}
                      </span>
                      <VatBadge taxEnabled={inv.tax_enabled} taxRate={inv.tax_rate} isAr={isAr} />
                      <span className="text-muted-foreground">{fmtDate(inv.created_at, isAr ? "ar" : "en")}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Bar({ label, pct, note, tone }: { label: string; pct: number; note: string; tone: "emerald" | "amber" }) {
  const fill = tone === "emerald" ? "bg-emerald-500" : "bg-amber-500";
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${fill} transition-all`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">{note}</div>
    </div>
  );
}
