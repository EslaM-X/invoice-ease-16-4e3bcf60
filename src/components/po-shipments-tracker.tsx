import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtDateTime } from "@/lib/utils-money";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Package,
  Truck,
  Warehouse,
} from "lucide-react";
import { shipmentMeta, SHIPMENT_TYPES, type ShipmentType } from "@/lib/shipment-types";

/**
 * Detailed live PO shipment tracker for the dashboard.
 * Sits below the "incoming shipments" strip and gives the user a quick,
 * grouped, real-time view of EVERY active shipment (by type and status)
 * plus a timeline of the most recent status changes — so they can tell at
 * a glance whether something arrived yesterday without leaving the page.
 */

type POStatus = "ordered" | "shipped" | "in_warehouse" | "received";

type PO = {
  id: string;
  po_number: string;
  shipment_type: ShipmentType | null;
  shipment_code: string | null;
  supplier_name: string | null;
  status: POStatus;
  expected_arrival_at: string | null;
  shipped_at: string | null;
  received_at: string | null;
  total_qty: number;
};

type HistoryRow = {
  id: string;
  po_id: string;
  from_status: string | null;
  to_status: string;
  actor_email: string | null;
  created_at: string;
  po?: { po_number: string; shipment_code: string | null; shipment_type: ShipmentType | null };
};

const STATUS_ORDER: POStatus[] = ["ordered", "shipped", "in_warehouse", "received"];

const STATUS_META: Record<POStatus, { Icon: typeof Package; tone: string; dot: string }> = {
  ordered: {
    Icon: ClipboardList,
    tone: "text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30",
    dot: "bg-amber-500",
  },
  shipped: {
    Icon: Truck,
    tone: "text-violet-700 dark:text-violet-400 bg-violet-500/10 border-violet-500/30",
    dot: "bg-violet-500",
  },
  in_warehouse: {
    Icon: Warehouse,
    tone: "text-sky-700 dark:text-sky-400 bg-sky-500/10 border-sky-500/30",
    dot: "bg-sky-500",
  },
  received: {
    Icon: CheckCircle2,
    tone: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    dot: "bg-emerald-500",
  },
};

export function PoShipmentsTracker() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [pos, setPos] = useState<PO[] | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const statusLabel = (s: POStatus) =>
    s === "ordered"
      ? isAr ? "تم الطلب" : "Ordered"
      : s === "shipped"
        ? isAr ? "تم الشحن" : "Shipped"
        : s === "in_warehouse"
          ? isAr ? "في المخزن" : "In warehouse"
          : isAr ? "تم الاستلام" : "Received";

  const load = async () => {
    const [{ data: poRows }, { data: histRows }] = await Promise.all([
      supabase
        .from("purchase_orders")
        .select("id, po_number, shipment_type, shipment_code, supplier_name, status, expected_arrival_at, shipped_at, received_at, total_qty")
        .in("status", STATUS_ORDER as any)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("po_status_history")
        .select("id, po_id, from_status, to_status, actor_email, created_at, purchase_orders!inner(po_number, shipment_code, shipment_type)")
        .order("created_at", { ascending: false })
        .limit(12),
    ]);
    setPos(((poRows as any[]) ?? []) as PO[]);
    setHistory(
      ((histRows as any[]) ?? []).map((r) => ({
        id: r.id,
        po_id: r.po_id,
        from_status: r.from_status,
        to_status: r.to_status,
        actor_email: r.actor_email,
        created_at: r.created_at,
        po: r.purchase_orders
          ? {
              po_number: r.purchase_orders.po_number,
              shipment_code: r.purchase_orders.shipment_code,
              shipment_type: r.purchase_orders.shipment_type,
            }
          : undefined,
      })),
    );
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useRealtimeTable("purchase_orders", load);
  useRealtimeTable("po_status_history", load);

  const grouped = useMemo(() => {
    const out = new Map<
      ShipmentType,
      { counts: Record<POStatus, number>; units: number; pos: PO[] }
    >();
    for (const st of SHIPMENT_TYPES) {
      out.set(st, {
        counts: { ordered: 0, shipped: 0, in_warehouse: 0, received: 0 },
        units: 0,
        pos: [],
      });
    }
    for (const p of pos ?? []) {
      const t = (p.shipment_type ?? "grounded") as ShipmentType;
      const bucket = out.get(t);
      if (!bucket) continue;
      bucket.counts[p.status] = (bucket.counts[p.status] ?? 0) + 1;
      bucket.units += Number(p.total_qty || 0);
      bucket.pos.push(p);
    }
    return out;
  }, [pos]);

  const totals = useMemo(() => {
    const acc: Record<POStatus, number> = { ordered: 0, shipped: 0, in_warehouse: 0, received: 0 };
    for (const p of pos ?? []) acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, [pos]);

  return (
    <section className="rounded-md border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h3 className="eyebrow">{isAr ? "تتبع أوامر الشراء" : "PO shipment tracking"}</h3>
          {pos && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {pos.length}
            </span>
          )}
        </div>
        <Link
          to="/po-tracking"
          className="group inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
        >
          {isAr ? "كل أوامر الشراء" : "All POs"}
          <ArrowRight className={`h-3.5 w-3.5 transition group-hover:translate-x-0.5 ${isAr ? "rotate-180 group-hover:-translate-x-0.5" : ""}`} />
        </Link>
      </div>

      {/* Status totals strip */}
      <div className="grid grid-cols-2 gap-2 border-b border-border bg-muted/20 p-3 sm:grid-cols-4">
        {STATUS_ORDER.map((s) => {
          const meta = STATUS_META[s];
          const Icon = meta.Icon;
          return (
            <div
              key={s}
              className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 ${meta.tone}`}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                <span className="text-xs font-semibold">{statusLabel(s)}</span>
              </div>
              <span className="font-display text-lg font-semibold tabular-nums">{totals[s]}</span>
            </div>
          );
        })}
      </div>

      {pos === null ? (
        <div className="grid gap-3 p-5 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-md bg-muted/50" />
          ))}
        </div>
      ) : pos.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center">
          <Package className="h-6 w-6 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">
            {isAr ? "لا توجد شحنات نشطة حالياً" : "No active shipments right now"}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 p-4 lg:grid-cols-[1fr_1fr]">
          {/* Per shipment type breakdown */}
          <div className="space-y-2">
            <div className="eyebrow text-[10px]">{isAr ? "حسب نوع الشحنة" : "By shipment type"}</div>
            {SHIPMENT_TYPES.map((st) => {
              const sm = shipmentMeta(st);
              const SIcon = sm.icon;
              const g = grouped.get(st);
              if (!g || g.pos.length === 0) return null;
              return (
                <div key={st} className="rounded-md border border-border bg-background p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className={`inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-extrabold tracking-wide ${sm.chipClass}`}>
                      <SIcon className="h-3.5 w-3.5" />
                      {sm.shortLabel(isAr)}
                    </div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      <span className="font-semibold text-foreground">{g.pos.length}</span>{" "}
                      {isAr ? "أوامر" : "POs"} ·{" "}
                      <span className="font-semibold text-foreground">{g.units}</span>{" "}
                      {isAr ? "قطعة" : "units"}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {STATUS_ORDER.map((s) => {
                      const n = g.counts[s];
                      if (!n) return null;
                      const meta = STATUS_META[s];
                      const Icon = meta.Icon;
                      return (
                        <span
                          key={s}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.tone}`}
                        >
                          <Icon className="h-3 w-3" />
                          {statusLabel(s)}
                          <span className="font-bold tabular-nums">{n}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Recent activity timeline */}
          <div className="rounded-md border border-border bg-background p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="eyebrow text-[10px]">{isAr ? "آخر التحديثات" : "Recent activity"}</div>
              <Link to="/po-tracking" className="text-[10px] font-semibold text-muted-foreground hover:text-foreground">
                {isAr ? "عرض الكل" : "View all"}
              </Link>
            </div>
            {history.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {isAr ? "لا توجد تحديثات حديثة" : "No recent updates"}
              </div>
            ) : (
              <ol className="relative space-y-2">
                {history.map((h) => {
                  const to = (h.to_status as POStatus) in STATUS_META ? (h.to_status as POStatus) : null;
                  const tm = to ? STATUS_META[to] : null;
                  const Icon = tm?.Icon ?? Activity;
                  const sm = h.po ? shipmentMeta(h.po.shipment_type) : null;
                  return (
                    <li key={h.id} className="flex items-start gap-2.5 rounded-md border border-border/60 bg-muted/20 p-2.5">
                      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${tm?.tone ?? "bg-muted text-muted-foreground"}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          {sm && h.po && (
                            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide ${sm.chipClass}`}>
                              {h.po.shipment_code || sm.prefix}
                            </span>
                          )}
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {h.po?.po_number ?? h.po_id.slice(0, 8)}
                          </span>
                          <span className="text-foreground/80">
                            {h.from_status ? (
                              <>
                                {statusLabel(h.from_status as POStatus)}{" "}
                                <ArrowRight className="inline h-3 w-3 align-middle text-muted-foreground" />{" "}
                              </>
                            ) : null}
                            <span className="font-semibold">{to ? statusLabel(to) : h.to_status}</span>
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                          <span className="truncate">{h.actor_email ?? "—"}</span>
                          <span className="tabular-nums">{fmtDateTime(h.created_at, lang)}</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
