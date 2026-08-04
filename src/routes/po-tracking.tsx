import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRole } from "@/lib/use-role";
import { useBatchedRealtimeTables } from "@/lib/realtime";
import { fmtDateTime, fmtMoney } from "@/lib/utils-money";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, Search, Route as RouteIcon, History as HistoryIcon } from "lucide-react";
import { POTrackerDialog, statusBadge, statusLabel, PO_FLOW } from "@/components/po-tracker-dialog";
import { shipmentMeta, SHIPMENT_TYPES, type ShipmentType } from "@/lib/shipment-types";
import { toast } from "sonner";

import { ExecutiveGate } from "@/components/executive-gate";

export const Route = createFileRoute("/po-tracking")({
  validateSearch: zodValidator(
    z.object({
      open: fallback(z.string(), "").default(""),
    }),
  ),
  component: () => (
    <AppShell>
      <ExecutiveGate>
        <POTrackingPage />
      </ExecutiveGate>
    </AppShell>
  ),
});

const FILTER_STATUSES = [...PO_FLOW, "cancelled"] as const;

function POTrackingPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const { isAdmin, isPurchasing, isCFO, loading: roleLoading } = useRole();
  const navigate = useNavigate();
  const isAr = lang === "ar";

  const [pos, setPos] = useState<any[]>([]);
  const [poProgress, setPoProgress] = useState<Record<string, { ordered: number; received: number }>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [shipFilter, setShipFilter] = useState<ShipmentType | "all">("all");
  const [codeFilter, setCodeFilter] = useState<string>("all");
  const [receiptFilter, setReceiptFilter] = useState<"all" | "fully" | "partial" | "none">("all");
  const [trackId, setTrackId] = useState<string | null>(null);
  const [poReceipts, setPoReceipts] = useState<Record<string, any[]>>({});

  // Auto-open a PO when arriving with ?open=<po_id> (e.g. from Cost History)
  const { open: openParam } = Route.useSearch();
  useEffect(() => {
    if (openParam) setTrackId(openParam);
  }, [openParam]);



  useEffect(() => {
    if (!roleLoading && !isAdmin && !isPurchasing && !isCFO) {
      toast.error(isAr ? "غير مصرح" : "Not authorized");
      navigate({ to: "/dashboard" });
    }
  }, [roleLoading, isAdmin, isPurchasing, isCFO, navigate, isAr]);

  const load = async () => {
    const { data } = await supabase
      .from("purchase_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    const list = (data as any[]) ?? [];
    // Sort: shipment_date desc → shipment prefix (A/G/D) → numeric suffix desc → created_at desc.
    const codeNum = (c: string | null | undefined) => {
      const m = c ? String(c).match(/(\d+)/) : null;
      return m ? parseInt(m[1], 10) : -1;
    };
    const codePrefix = (c: string | null | undefined) => {
      const m = c ? String(c).match(/^([A-Za-z]+)/) : null;
      return m ? m[1].toUpperCase() : "";
    };
    list.sort((a, b) => {
      const da = a.shipment_date ? new Date(a.shipment_date).getTime() : 0;
      const db = b.shipment_date ? new Date(b.shipment_date).getTime() : 0;
      if (db !== da) return db - da;
      const pa = codePrefix(a.shipment_code);
      const pb = codePrefix(b.shipment_code);
      if (pa !== pb) return pa.localeCompare(pb);
      const na = codeNum(a.shipment_code);
      const nb = codeNum(b.shipment_code);
      if (nb !== na) return nb - na;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    setPos(list);
    // Aggregate ordered/received per PO for the receipt-status filter
    const ids = list.map((p) => p.id);
    if (ids.length) {
      const [{ data: items }, { data: receipts }] = await Promise.all([
        (supabase as any)
          .from("purchase_order_items")
          .select("po_id,quantity,received_qty")
          .in("po_id", ids),
        (supabase as any)
          .from("po_receipts")
          .select("po_id,receipt_number,receipt_code,total_qty,created_at")
          .in("po_id", ids)
          .order("receipt_number", { ascending: true }),
      ]);
      const agg: Record<string, { ordered: number; received: number }> = {};
      for (const it of (items as any[]) ?? []) {
        const k = it.po_id as string;
        const e = agg[k] ?? { ordered: 0, received: 0 };
        e.ordered += Number(it.quantity) || 0;
        e.received += Number(it.received_qty) || 0;
        agg[k] = e;
      }
      setPoProgress(agg);
      const recMap: Record<string, any[]> = {};
      ((receipts as any[]) ?? []).forEach((r) => { recMap[r.po_id] = [...(recMap[r.po_id] ?? []), r]; });
      setPoReceipts(recMap);
    } else {
      setPoProgress({});
      setPoReceipts({});
    }
  };

  useEffect(() => { if (user) load(); }, [user]);
  useBatchedRealtimeTables(
    ["purchase_orders", "po_status_history", "po_receipts", "po_receipt_items", "purchase_order_items"],
    () => { if (user) load(); },
    [user?.id],
  );

  const receiptStatusOf = (poId: string): "fully" | "partial" | "none" => {
    const a = poProgress[poId];
    if (!a || a.ordered === 0) return "none";
    if (a.received >= a.ordered) return "fully";
    if (a.received > 0) return "partial";
    return "none";
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pos.filter((p) => {
      if (filter !== "all" && p.status !== filter) return false;
      if (shipFilter !== "all" && (p.shipment_type ?? "grounded") !== shipFilter) return false;
      if (codeFilter !== "all" && (p.shipment_code ?? p.po_number) !== codeFilter) return false;
      if (receiptFilter !== "all" && receiptStatusOf(p.id) !== receiptFilter) return false;
      if (!q) return true;
      return (
        (p.po_number ?? "").toLowerCase().includes(q) ||
        (p.shipment_code ?? "").toLowerCase().includes(q) ||
        (p.supplier_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [pos, search, filter, shipFilter, codeFilter, receiptFilter, poProgress]);

  const shipCounts = useMemo(() => {
    const c: Record<string, number> = { all: pos.length, grounded: 0, air: 0, door_to_door: 0 };
    pos.forEach((p) => { const k = p.shipment_type ?? "grounded"; c[k] = (c[k] ?? 0) + 1; });
    return c;
  }, [pos]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: pos.length };
    for (const s of FILTER_STATUSES) c[s] = 0;
    pos.forEach((p) => { c[p.status] = (c[p.status] ?? 0) + 1; });
    return c;
  }, [pos]);

  const receiptCounts = useMemo(() => {
    const c = { all: pos.length, fully: 0, partial: 0, none: 0 };
    pos.forEach((p) => { c[receiptStatusOf(p.id)]++; });
    return c;
  }, [pos, poProgress]);

  const codeCounts = useMemo(() => {
    const c: Record<string, number> = { all: pos.length };
    pos.forEach((p) => { const k = p.shipment_code ?? p.po_number; c[k] = (c[k] ?? 0) + 1; });
    return c;
  }, [pos]);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5">
        <div className="absolute -end-12 -top-12 h-44 w-44 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary shadow-sm">
                <RouteIcon className="h-5 w-5" />
              </span>
              {isAr ? "تتبع أوامر الشراء" : "PO Tracking"}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {isAr
                ? "تتبّع كل أمر شراء من التسعير إلى الاستلام في المخزون، مع سجل زمني كامل وكميات مستلمة دقيقة."
                : "Track every PO from pricing through warehouse receipt with a full timeline and precise received quantities."}
            </p>
          </div>
          <Link to="/back-deduction-report">
            <Button variant="outline" size="sm" className="gap-1">
              <HistoryIcon className="h-4 w-4" />
              {isAr ? "تقرير تسوية الخصومات" : "Back-deduction report"}
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? "ابحث برقم PO أو المورد..." : "Search by PO number or supplier..."}
            className="ps-9"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <FilterChip active={shipFilter === "all"} onClick={() => setShipFilter("all")} label={isAr ? "كل الشحنات" : "All shipments"} count={shipCounts.all} />
        {SHIPMENT_TYPES.map((st) => {
          const meta = shipmentMeta(st);
          const Icon = meta.icon;
          const active = shipFilter === st;
          return (
            <button
              key={st}
              onClick={() => setShipFilter(st)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                active ? `${meta.chipClass}` : `${meta.surfaceClass} ${meta.accentTextClass} hover:opacity-80`
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {meta.shortLabel(isAr)} ({shipCounts[st] ?? 0})
            </button>
          );
        })}
      </div>
      <div className="rounded-md border bg-muted/30 p-2">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {isAr ? "حسب كود الشحنة" : "By shipment code"}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={codeFilter === "all"} onClick={() => setCodeFilter("all")} label={isAr ? "كل الأكواد" : "All codes"} count={codeCounts.all} />
          {Object.entries(codeCounts).filter(([k]) => k !== "all").sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([code, count]) => (
            <FilterChip key={code} active={codeFilter === code} onClick={() => setCodeFilter(code)} label={code} count={count} />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label={isAr ? "الكل" : "All"} count={counts.all} />
        {FILTER_STATUSES.map((s) => (
          <FilterChip
            key={s}
            active={filter === s}
            onClick={() => setFilter(s)}
            label={statusLabel(s, isAr)}
            count={counts[s] ?? 0}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground me-1">
          {isAr ? "حالة الاستلام:" : "Receipt:"}
        </span>
        <FilterChip active={receiptFilter === "all"} onClick={() => setReceiptFilter("all")} label={isAr ? "الكل" : "All"} count={receiptCounts.all} />
        <button
          onClick={() => setReceiptFilter("fully")}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${receiptFilter === "fully" ? "bg-emerald-600 text-white border-emerald-600" : "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 hover:bg-emerald-500/20"}`}
        >
          {isAr ? "مستلم بالكامل" : "Fully received"} <span className="opacity-70">({receiptCounts.fully})</span>
        </button>
        <button
          onClick={() => setReceiptFilter("partial")}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${receiptFilter === "partial" ? "bg-amber-500 text-white border-amber-500" : "bg-amber-500/10 text-amber-700 border-amber-500/30 hover:bg-amber-500/20"}`}
        >
          {isAr ? "استلام جزئي" : "Partially received"} <span className="opacity-70">({receiptCounts.partial})</span>
        </button>
        <button
          onClick={() => setReceiptFilter("none")}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${receiptFilter === "none" ? "bg-rose-500 text-white border-rose-500" : "bg-rose-500/10 text-rose-700 border-rose-500/30 hover:bg-rose-500/20"}`}
        >
          {isAr ? "غير مستلم" : "Not received"} <span className="opacity-70">({receiptCounts.none})</span>
        </button>
      </div>

      <POCostBanner rows={filtered as any} />

      {/* List */}
      <Card className="overflow-hidden">
        <div className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {filtered.length} {isAr ? "أمر شراء" : "POs"}
        </div>
        <div className="divide-y">
          {filtered.length === 0 && (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {isAr ? "لا توجد نتائج." : "No results."}
            </div>
          )}
          {filtered.map((p) => {
            const idx = PO_FLOW.indexOf(p.status);
            const progress = p.status === "received" ? 100 : p.status === "cancelled" ? 0 : idx >= 0 ? Math.round(((idx + 1) / PO_FLOW.length) * 100) : 0;
            const meta = shipmentMeta(p.shipment_type);
            const ShipIcon = meta.icon;
            const receipts = poReceipts[p.id] ?? [];
            return (
              <div key={p.id} className={`flex flex-wrap items-center gap-3 border-s-4 p-4 ${meta.surfaceClass}`}>
                <div className="flex-1 min-w-[200px] space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {p.shipment_code && (
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm font-extrabold tracking-wide ${meta.chipClass}`}>
                        <ShipIcon className="h-3.5 w-3.5" />
                        {p.shipment_code}
                      </span>
                    )}
                    <span className="font-mono text-xs text-muted-foreground">{p.po_number}</span>
                    {statusBadge(p.status, isAr)}
                    {p.stock_applied_at && (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30 text-[10px]">
                        {isAr ? "أُضيف للمخزون" : "Stock applied"}
                      </Badge>
                    )}
                    {p.received_without_payment && !p.payment_installment_1_at && (
                      <Badge variant="outline" className="bg-rose-500/10 text-rose-700 border-rose-500/40 text-[10px] font-bold">
                        {isAr ? "غير مدفوع للمورد" : "Unpaid to supplier"}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.supplier_name || (isAr ? "بدون مورد" : "No supplier")} · {fmtDateTime(p.created_at, lang)}
                  </div>
                  {p.status !== "cancelled" && (
                    <div className="mt-1 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  )}
                  {receipts.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {receipts.map((r) => (
                        <button key={r.id ?? `${p.id}-${r.receipt_number}`} type="button" onClick={() => setTrackId(p.id)} className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400">
                          {r.receipt_code || `${p.shipment_code || p.po_number}#${r.receipt_number}`} · +{r.total_qty}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-end">
                  <div className="text-[10px] text-muted-foreground">{isAr ? "إجمالي USD" : "Total USD"}</div>
                  <div className="font-bold tabular-nums">${(Number(p.total_usd) || 0).toFixed(2)}</div>
                  <div className="text-[10px] text-muted-foreground">{p.total_qty} {isAr ? "قطعة" : "units"}</div>
                </div>
                {p.total_egp != null && (
                  <div className="text-end">
                    <div className="text-[10px] text-muted-foreground">EGP</div>
                    <div className="font-bold tabular-nums text-primary">{fmtMoney(Number(p.total_egp), "EGP", lang)}</div>
                  </div>
                )}
                <Button size="sm" onClick={() => setTrackId(p.id)} className="gap-1">
                  <Activity className="h-3.5 w-3.5" /> {isAr ? "تتبع" : "Track"}
                </Button>
              </div>
            );
          })}
        </div>
      </Card>

      {trackId && (
        <POTrackerDialog
          poId={trackId}
          open={!!trackId}
          onOpenChange={(v) => { if (!v) setTrackId(null); }}
        />
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
      }`}
    >
      {label} <span className="opacity-60">({count})</span>
    </button>
  );
}
