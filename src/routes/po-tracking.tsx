import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { Activity, Search, Route as RouteIcon } from "lucide-react";
import { POTrackerDialog, statusBadge, statusLabel, PO_FLOW } from "@/components/po-tracker-dialog";
import { shipmentMeta, SHIPMENT_TYPES, type ShipmentType } from "@/lib/shipment-types";
import { toast } from "sonner";

import { ExecutiveGate } from "@/components/executive-gate";

export const Route = createFileRoute("/po-tracking")({
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
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [trackId, setTrackId] = useState<string | null>(null);

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
    setPos((data as any) ?? []);
  };

  useEffect(() => { if (user) load(); }, [user]);
  useBatchedRealtimeTables(
    ["purchase_orders", "po_status_history"],
    () => { if (user) load(); },
    [user?.id],
  );


  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pos.filter((p) => {
      if (filter !== "all" && p.status !== filter) return false;
      if (!q) return true;
      return (
        (p.po_number ?? "").toLowerCase().includes(q) ||
        (p.supplier_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [pos, search, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: pos.length };
    for (const s of FILTER_STATUSES) c[s] = 0;
    pos.forEach((p) => { c[p.status] = (c[p.status] ?? 0) + 1; });
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
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="flex-1 min-w-[200px] space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold">{p.po_number}</span>
                    {statusBadge(p.status, isAr)}
                    {p.stock_applied_at && (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30 text-[10px]">
                        {isAr ? "أُضيف للمخزون" : "Stock applied"}
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
