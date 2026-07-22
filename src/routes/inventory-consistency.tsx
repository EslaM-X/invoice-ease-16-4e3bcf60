import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useIsExecutive } from "@/lib/use-executive";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2, ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/inventory-consistency")({
  component: () => (
    <AppShell>
      <ConsistencyPage />
    </AppShell>
  ),
});

const INELIGIBLE_STATUSES = new Set(["draft", "voided", "cancelled", "archived"]);

type Diff = {
  product_id: string;
  product_name: string;
  field: string;
  expected: number | string;
  actual: number | string;
  detail?: string;
};

function ConsistencyPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const isExec = useIsExecutive();

  const [loading, setLoading] = useState(true);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [diffs, setDiffs] = useState<Diff[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [rawAlerts, setRawAlerts] = useState<any[]>([]);
  const [showRaw, setShowRaw] = useState(false);

  const run = async () => {
    setLoading(true);
    const [{ data: alerts, error: e1 }, { data: reserved, error: e2 }] = await Promise.all([
      supabase.rpc("get_inventory_shortage_alerts" as any),
      supabase.rpc("get_reserved_qty_by_product" as any),
    ]);
    if (e1 || e2) {
      toast.error((e1 || e2)!.message);
      setLoading(false);
      return;
    }
    const alertsArr = (alerts as any[]) ?? [];
    setRawAlerts(alertsArr);
    setTotalProducts(alertsArr.length);

    const reservedMap = new Map<string, number>();
    for (const r of (reserved as any[]) ?? []) {
      reservedMap.set(r.product_id, Number(r.reserved_qty || 0));
    }

    const out: Diff[] = [];
    for (const row of alertsArr) {
      const pid = row.product_id;
      const pname = row.product_name;
      const needed = Number(row.needed_qty || 0);
      const stock = Number(row.stock_quantity || 0);
      const incoming = Number(row.incoming_qty || 0);
      const netShort = Number(row.net_shortage || 0);
      const sources: any[] = (row.sources as any[]) ?? [];

      // Check A: sum(sources.remaining_qty || reserved_qty) == needed_qty
      const sumSrc = sources.reduce(
        (s, i) => s + Number(i.remaining_qty ?? i.reserved_qty ?? i.quantity ?? 0),
        0,
      );
      if (sumSrc !== needed) {
        out.push({
          product_id: pid, product_name: pname,
          field: ar ? "مجموع مصادر الفواتير ≠ المطلوب" : "sum(sources) ≠ needed_qty",
          expected: needed, actual: sumSrc,
        });
      }

      // Check B: net_shortage == max(0, needed - stock - incoming)
      const expectedNet = Math.max(0, needed - stock - incoming);
      if (expectedNet !== netShort) {
        out.push({
          product_id: pid, product_name: pname,
          field: ar ? "نقص صافي محسوب" : "computed net_shortage",
          expected: expectedNet, actual: netShort,
        });
      }

      // Check C: no ineligible invoice inside sources
      for (const s of sources) {
        const st = String(s.status ?? "").toLowerCase();
        const ds = String(s.delivery_status ?? "").toLowerCase();
        if (INELIGIBLE_STATUSES.has(st) || ds === "delivered") {
          out.push({
            product_id: pid, product_name: pname,
            field: ar ? "فاتورة غير مؤهّلة داخل المصادر" : "ineligible invoice in sources",
            expected: ar ? "مستبعدة" : "excluded",
            actual: `${s.invoice_number} [${st}/${ds || "—"}]`,
            detail: s.invoice_id,
          });
        }
      }

      // Check D: reserved-per-product RPC matches needed_qty (both derived from live reservations)
      const rq = reservedMap.get(pid) ?? 0;
      if (rq !== needed) {
        out.push({
          product_id: pid, product_name: pname,
          field: ar ? "get_reserved_qty_by_product ≠ needed_qty" : "get_reserved_qty_by_product ≠ needed_qty",
          expected: needed, actual: rq,
        });
      }
    }

    setDiffs(out);
    setLastRun(new Date());
    setLoading(false);
  };

  useEffect(() => { if (isExec) void run(); }, [isExec]);

  const grouped = useMemo(() => {
    const m = new Map<string, Diff[]>();
    for (const d of diffs) {
      if (!m.has(d.product_id)) m.set(d.product_id, []);
      m.get(d.product_id)!.push(d);
    }
    return Array.from(m.entries());
  }, [diffs]);

  if (!isExec) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        {ar ? "غير مسموح — التنفيذيون فقط" : "Forbidden — executives only"}
      </div>
    );
  }

  const allGood = !loading && diffs.length === 0;

  return (
    <div className="space-y-4 md:space-y-6" dir={ar ? "rtl" : "ltr"}>
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-neutral-950/80 via-neutral-900/80 to-neutral-950/80 p-5 md:p-6">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-700/10 border border-emerald-500/30 p-2.5">
              <ShieldCheck className="h-6 w-6 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl md:text-2xl font-bold text-emerald-100">
                {ar ? "فحص اتساق المخزون والنواقص" : "Inventory & Shortages Consistency"}
              </h1>
              <p className="text-xs md:text-sm text-emerald-100/70 mt-0.5">
                {ar
                  ? "يقارن نفس الـRPC الذي يغذّي متتبع المخزون وتقرير النواقص، ويكشف أي انحراف رقمي."
                  : "Cross-checks the same RPC feeding both /in-transit and /stock-shortages, and surfaces any deviation."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <span className="text-xs text-emerald-100/60 tabular-nums">
              {lastRun ? `${ar ? "آخر فحص" : "Last check"}: ${lastRun.toLocaleTimeString(ar ? "ar-EG-u-nu-latn" : "en-GB")}` : "—"}
            </span>
            <Button variant="outline" size="sm" onClick={run} disabled={loading}>
              <RefreshCw className={`h-4 w-4 me-2 ${loading ? "animate-spin" : ""}`} />
              {ar ? "إعادة الفحص" : "Re-run check"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? (ar ? "إخفاء JSON" : "Hide JSON") : (ar ? "عرض JSON خام" : "Show raw JSON")}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mt-5">
          <MiniKPI label={ar ? "منتجات مفحوصة" : "Products checked"} value={totalProducts} tone="slate" />
          <MiniKPI label={ar ? "اختلافات" : "Diffs"} value={diffs.length} tone={diffs.length > 0 ? "red" : "emerald"} />
          <MiniKPI label={ar ? "منتجات مشكوك بها" : "Affected products"} value={grouped.length} tone={grouped.length > 0 ? "amber" : "emerald"} />
          <MiniKPI label={ar ? "الحالة" : "Status"} value={allGood ? (ar ? "متسق" : "OK") : (ar ? "انحراف" : "Drift")} tone={allGood ? "emerald" : "red"} isText />
        </div>

        <div className="mt-4 flex items-center gap-3 text-xs">
          <Link to="/stock-shortages" className="inline-flex items-center gap-1 text-amber-300 hover:text-amber-200">
            <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" /> {ar ? "تقرير النواقص" : "Shortage report"}
          </Link>
          <Link to="/in-transit" className="inline-flex items-center gap-1 text-violet-300 hover:text-violet-200">
            <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" /> {ar ? "متتبع المخزون" : "Inventory tracker"}
          </Link>
        </div>
      </div>

      {loading ? (
        <Card className="p-10 text-center text-muted-foreground">{ar ? "جاري الفحص…" : "Running checks…"}</Card>
      ) : allGood ? (
        <Card className="p-10 text-center border-emerald-500/30 bg-emerald-500/5">
          <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-emerald-400" />
          <div className="font-semibold text-emerald-100">
            {ar ? "كل الأرقام متطابقة بدون أي انحراف" : "All numbers reconcile — no drift"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {ar
              ? `تم التحقق من ${totalProducts} منتج عبر 4 فحوصات لكل صف.`
              : `Verified ${totalProducts} product${totalProducts === 1 ? "" : "s"} across 4 checks each.`}
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden border-red-500/30">
          <div className="border-b bg-red-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-red-300 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {ar ? `${diffs.length} انحراف عبر ${grouped.length} منتج` : `${diffs.length} deviation${diffs.length === 1 ? "" : "s"} across ${grouped.length} product${grouped.length === 1 ? "" : "s"}`}
          </div>
          <div className="divide-y divide-red-500/10">
            {grouped.map(([pid, list]) => (
              <div key={pid} className="p-3 space-y-1.5">
                <div className="font-semibold text-amber-100 text-sm">{list[0].product_name}</div>
                <div className="text-[10px] font-mono text-muted-foreground">{pid}</div>
                <div className="mt-1 space-y-1">
                  {list.map((d, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 text-xs items-center rounded border border-red-500/20 bg-red-500/5 px-2 py-1">
                      <span className="text-red-200">{d.field}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {ar ? "متوقع" : "expected"}: <b className="text-emerald-300">{String(d.expected)}</b>
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {ar ? "فعلي" : "actual"}: <b className="text-red-300">{String(d.actual)}</b>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showRaw && (
        <Card className="overflow-hidden">
          <div className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {ar ? "استجابة الـRPC الخام (get_inventory_shortage_alerts)" : "Raw RPC response (get_inventory_shortage_alerts)"}
          </div>
          <pre className="max-h-[600px] overflow-auto p-4 text-[10px] leading-relaxed bg-black/60 text-emerald-200 font-mono">
{JSON.stringify(rawAlerts, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  );
}

function MiniKPI({
  label, value, tone, isText,
}: { label: string; value: number | string; tone: "slate" | "emerald" | "amber" | "red"; isText?: boolean }) {
  const toneMap: Record<string, string> = {
    slate: "text-slate-200 border-slate-500/30 bg-slate-500/5",
    emerald: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5",
    amber: "text-amber-300 border-amber-500/30 bg-amber-500/5",
    red: "text-red-300 border-red-500/40 bg-red-500/10",
  };
  return (
    <div className={`rounded-xl border p-3 ${toneMap[tone]}`}>
      <div className="text-[10px] md:text-[11px] uppercase tracking-wider opacity-80 truncate">{label}</div>
      <div className={`mt-1 font-bold tabular-nums ${isText ? "text-lg" : "text-xl md:text-2xl"}`}>
        {typeof value === "number" ? value.toLocaleString("en-GB") : value}
      </div>
    </div>
  );
}
