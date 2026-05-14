import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtDate } from "@/lib/utils-money";
import { Package, Truck, Warehouse, ArrowRight, Calendar, AlertCircle } from "lucide-react";

const IN_TRANSIT_STATUSES = ["ordered", "shipped", "in_warehouse"] as const;
type ShipStatus = (typeof IN_TRANSIT_STATUSES)[number];

type PO = {
  id: string;
  po_number: string;
  supplier_name: string | null;
  status: ShipStatus;
  expected_arrival_at: string | null;
  shipped_at: string | null;
  total_qty: number;
};

const STATUS_META: Record<ShipStatus, { Icon: typeof Package; tone: string; ring: string }> = {
  ordered: {
    Icon: Package,
    tone: "text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30",
    ring: "from-amber-500/40 to-amber-500/0",
  },
  shipped: {
    Icon: Truck,
    tone: "text-violet-700 dark:text-violet-400 bg-violet-500/10 border-violet-500/30",
    ring: "from-violet-500/40 to-violet-500/0",
  },
  in_warehouse: {
    Icon: Warehouse,
    tone: "text-sky-700 dark:text-sky-400 bg-sky-500/10 border-sky-500/30",
    ring: "from-sky-500/40 to-sky-500/0",
  },
};

function daysBetween(a: Date, b: Date) {
  const ms = a.setHours(0, 0, 0, 0) - b.setHours(0, 0, 0, 0);
  return Math.round(ms / 86_400_000);
}

export function IncomingShipmentsStrip() {
  const { t, lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<PO[] | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("purchase_orders")
      .select("id, po_number, supplier_name, status, expected_arrival_at, shipped_at, total_qty")
      .in("status", IN_TRANSIT_STATUSES as any)
      .order("expected_arrival_at", { ascending: true, nullsFirst: false })
      .limit(8);
    setRows((data ?? []) as PO[]);
  };

  useEffect(() => { load(); }, []);
  useRealtimeTable("purchase_orders", load);

  const etaLabel = (iso: string | null) => {
    if (!iso) return { text: t("no_eta"), tone: "text-muted-foreground", overdue: false };
    const eta = new Date(iso);
    const diff = daysBetween(new Date(eta), new Date());
    if (diff < 0) {
      const n = Math.abs(diff);
      return { text: t("overdue_by_days").replace("{n}", String(n)), tone: "text-destructive", overdue: true };
    }
    if (diff === 0) return { text: t("arriving_today"), tone: "text-emerald-700 dark:text-emerald-400", overdue: false };
    if (diff === 1) return { text: t("arriving_tomorrow"), tone: "text-emerald-700 dark:text-emerald-400", overdue: false };
    return { text: t("arriving_in_days").replace("{n}", String(diff)), tone: "text-foreground/80", overdue: false };
  };

  const statusLabel = (s: ShipStatus) =>
    s === "ordered" ? t("status_ordered") : s === "shipped" ? t("status_shipped") : t("status_in_warehouse");

  return (
    <section className="rounded-md border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 text-muted-foreground" />
          <h3 className="eyebrow">{t("incoming_shipments")}</h3>
          {rows && rows.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {rows.length}
            </span>
          )}
        </div>
        <Link
          to="/in-transit"
          className="group inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
        >
          {t("view_all")}
          <ArrowRight className={`h-3.5 w-3.5 transition group-hover:translate-x-0.5 ${isAr ? "rotate-180 group-hover:-translate-x-0.5" : ""}`} />
        </Link>
      </div>

      {rows === null ? (
        <div className="flex gap-3 p-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 w-64 animate-pulse rounded-md bg-muted/50" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center">
          <Package className="h-6 w-6 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">{t("no_incoming_shipments")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex min-w-full gap-3 p-4">
            {rows.map((po) => {
              const meta = STATUS_META[po.status];
              const eta = etaLabel(po.expected_arrival_at);
              const Icon = meta.Icon;
              return (
                <Link
                  key={po.id}
                  to="/po-tracking"
                  className="group relative flex w-72 shrink-0 flex-col gap-3 overflow-hidden rounded-md border border-border bg-background p-4 transition hover:border-foreground/30 hover:shadow-sm"
                >
                  <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${meta.ring}`} />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-muted-foreground">{po.po_number}</div>
                      <div className="mt-0.5 truncate text-sm font-semibold">
                        {po.supplier_name || (isAr ? "بدون مورد" : "No supplier")}
                      </div>
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.tone}`}>
                      <Icon className="h-3 w-3" />
                      {statusLabel(po.status)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className={`inline-flex items-center gap-1.5 font-medium ${eta.tone}`}>
                      {eta.overdue ? <AlertCircle className="h-3.5 w-3.5" /> : <Calendar className="h-3.5 w-3.5" />}
                      <span>{eta.text}</span>
                    </div>
                    <div className="tabular-nums text-muted-foreground">
                      <span className="font-semibold text-foreground">{po.total_qty}</span> {t("units")}
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
                    <span>
                      {po.expected_arrival_at
                        ? `${t("eta")}: ${fmtDate(po.expected_arrival_at, lang)}`
                        : po.shipped_at
                          ? `${t("shipped_on")}: ${fmtDate(po.shipped_at, lang)}`
                          : "—"}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
