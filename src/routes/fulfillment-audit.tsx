import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmtDateTime } from "@/lib/utils-money";
import { ArrowLeft, ClipboardList, Trash2, Search, ChevronDown, ChevronUp, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { reasonLabel, type ReasonCode } from "@/lib/fulfillment-engine";
import { autoLogClosureForInvoice } from "@/lib/fulfillment-audit";

export const Route = createFileRoute("/fulfillment-audit")({
  component: () => (
    <AppShell>
      <FulfillmentAuditPage />
    </AppShell>
  ),
});

type AuditRow = {
  id: string;
  invoice_id: string;
  invoice_number: string;
  action: string;
  tier: string;
  mode: string;
  confidence: number;
  total_needed: number;
  total_from_stock: number;
  total_from_incoming: number;
  total_shortfall: number;
  manual_count: number;
  reasons: { code: ReasonCode; detail: string }[];
  needs: any[];
  note: string | null;
  created_at: string;
};

type TierFilter = "all" | "closeable" | "not_closeable" | "now_full" | "now_partial" | "incoming_full" | "incoming_partial" | "blocked";
type ConfSort = "newest" | "conf_desc" | "conf_asc" | "only_100" | "high" | "medium" | "low";

const SORT_STORAGE_KEY = "fulfillment-audit:sort";

function FulfillmentAuditPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [q, setQ] = useState("");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [sort, setSort] = useState<ConfSort>(() => {
    if (typeof window === "undefined") return "newest";
    return ((localStorage.getItem(SORT_STORAGE_KEY) as ConfSort | null) ?? "newest");
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(50);
  const [reauditing, setReauditing] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(SORT_STORAGE_KEY, sort); } catch { /* ignore */ }
  }, [sort]);

  const PAGE_SIZE = 100;

  async function loadInitial() {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("fulfillment_audit_log" as any)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(0, PAGE_SIZE - 1);
    if (error) toast.error(error.message);
    const list = ((data ?? []) as unknown) as AuditRow[];
    setRows(list);
    setHasMore(list.length === PAGE_SIZE);
    setLoading(false);
  }

  async function loadMore() {
    if (!user || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const from = rows.length;
    const { data, error } = await supabase
      .from("fulfillment_audit_log" as any)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) toast.error(error.message);
    const list = ((data ?? []) as unknown) as AuditRow[];
    setRows((prev) => [...prev, ...list]);
    setHasMore(list.length === PAGE_SIZE);
    setLoadingMore(false);
  }

  useEffect(() => { loadInitial(); /* eslint-disable-next-line */ }, [user?.id]);
  // Realtime: just refresh the first page so brand-new rows appear without paging reset.
  useRealtimeTable("fulfillment_audit_log", loadInitial, [user?.id]);


  async function remove(id: string) {
    const { error } = await supabase.from("fulfillment_audit_log" as any).delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم الحذف" : "Deleted");
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const base = rows.filter((r) => {
      // Tier filter
      if (tierFilter === "closeable") {
        if (r.tier !== "now_full") return false;
      } else if (tierFilter === "not_closeable") {
        if (r.tier === "now_full") return false;
      } else if (tierFilter !== "all" && r.tier !== tierFilter) {
        return false;
      }
      // Confidence band filter (sort selection can also act as a quick filter)
      if (sort === "only_100" && r.confidence < 100) return false;
      if (sort === "high" && (r.confidence < 75 || r.confidence >= 100)) return false;
      if (sort === "medium" && (r.confidence < 50 || r.confidence >= 75)) return false;
      if (sort === "low" && r.confidence >= 50) return false;
      // Search
      const s = q.trim().toLowerCase();
      if (!s) return true;
      if (r.invoice_number.toLowerCase().includes(s)) return true;
      if (r.action.toLowerCase().includes(s)) return true;
      if (r.tier.toLowerCase().includes(s)) return true;
      if (r.mode.toLowerCase().includes(s)) return true;
      if ((r.note || "").toLowerCase().includes(s)) return true;
      if (Array.isArray(r.reasons) && r.reasons.some((x) =>
        (x.code || "").toLowerCase().includes(s) || (x.detail || "").toLowerCase().includes(s))) return true;
      if (Array.isArray(r.needs) && r.needs.some((n: any) =>
        (n.product_name || "").toLowerCase().includes(s))) return true;
      return false;
    });
    // Apply ordering
    if (sort === "conf_desc") {
      return [...base].sort((a, b) => b.confidence - a.confidence || b.created_at.localeCompare(a.created_at));
    }
    if (sort === "conf_asc") {
      return [...base].sort((a, b) => a.confidence - b.confidence || b.created_at.localeCompare(a.created_at));
    }
    // newest + band filters keep DB order (already newest first)
    return base;
  }, [rows, q, tierFilter, sort]);

  useEffect(() => { setVisibleCount(50); }, [q, tierFilter, sort]);

  // Re-audit only failed (non-closeable) entries currently visible.
  // De-dupe by invoice_id so each failed invoice is re-evaluated once.
  async function reauditFailed() {
    if (!user?.id || reauditing) return;
    const failedInvoices = new Map<string, AuditRow>();
    for (const r of filtered) {
      if (r.tier !== "now_full" && !failedInvoices.has(r.invoice_id)) {
        failedInvoices.set(r.invoice_id, r);
      }
    }
    const list = Array.from(failedInvoices.values());
    if (list.length === 0) {
      toast.info(isAr ? "لا توجد فواتير فاشلة لإعادة التدقيق" : "No failed invoices to re-audit");
      return;
    }
    setReauditing(true);
    let ok = 0, fail = 0, recovered = 0;
    const note = isAr ? "إعادة تدقيق الفواتير الفاشلة" : "Re-audit failed invoices";
    // Limited concurrency to avoid hammering DB.
    const CONCURRENCY = 4;
    let cursor = 0;
    async function worker() {
      while (cursor < list.length) {
        const r = list[cursor++];
        try {
          const s = await autoLogClosureForInvoice(user!.id, r.invoice_id, (r.mode as any) || "any", "snapshot", note);
          if (s) {
            ok++;
            if (s.tier === "now_full") recovered++;
          } else {
            fail++;
          }
        } catch {
          fail++;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
    setReauditing(false);
    toast.success(
      isAr
        ? `✅ أُعيد تدقيق ${ok}/${list.length} — أصبحت قابلة للإقفال: ${recovered}${fail ? ` · فشل ${fail}` : ""}`
        : `✅ Re-audited ${ok}/${list.length} — newly closeable: ${recovered}${fail ? ` · failed ${fail}` : ""}`,
      { duration: 9000 },
    );
  }


  const counts = useMemo(() => {
    let closeable = 0, notCloseable = 0;
    for (const r of rows) {
      if (r.tier === "now_full") closeable++; else notCloseable++;
    }
    return { closeable, notCloseable, total: rows.length };
  }, [rows]);

  return (
    <div className="space-y-4" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="h-6 w-6 text-primary" />
            {isAr ? "سجل تدقيق الإقفال" : "Fulfillment Audit Log"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAr
              ? "كل عمليات تسجيل الإقفال مع أسبابها وأرقامها — يُحدَّث تلقائياً."
              : "Every recorded closure with reasons & numbers — auto-refreshing."}
          </p>
        </div>
        <Link to="/fulfillment">
          <Button variant="outline" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            {isAr ? "رجوع" : "Back"}
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className={`absolute top-1/2 -translate-y-1/2 ${isAr ? "right-3" : "left-3"} h-4 w-4 text-muted-foreground`} />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={isAr ? "ابحث برقم الفاتورة / الإجراء / السبب / المنتج…" : "Search invoice / action / reason / product…"}
            className={isAr ? "pr-9" : "pl-9"}
          />
        </div>
        <Select value={tierFilter} onValueChange={(v) => setTierFilter(v as TierFilter)}>
          <SelectTrigger className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isAr ? `الكل (${counts.total})` : `All (${counts.total})`}</SelectItem>
            <SelectItem value="closeable">{isAr ? `قابلة للإقفال (${counts.closeable})` : `Closeable (${counts.closeable})`}</SelectItem>
            <SelectItem value="not_closeable">{isAr ? `غير قابلة (${counts.notCloseable})` : `Not closeable (${counts.notCloseable})`}</SelectItem>
            <SelectItem value="now_full">now_full</SelectItem>
            <SelectItem value="now_partial">now_partial</SelectItem>
            <SelectItem value="incoming_full">incoming_full</SelectItem>
            <SelectItem value="incoming_partial">incoming_partial</SelectItem>
            <SelectItem value="blocked">blocked</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="outline" className="text-xs">{filtered.length} / {rows.length}</Badge>
      </div>

      {loading && <div className="rounded-lg border border-border bg-card p-10 text-center text-muted-foreground">{isAr ? "جارٍ التحميل…" : "Loading…"}</div>}
      {!loading && filtered.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-muted-foreground">
          {isAr ? "لا توجد سجلات مطابقة." : "No matching entries."}
        </div>
      )}

      <div className="space-y-2">
        {filtered.slice(0, visibleCount).map((r) => {
          const isOpen = expanded.has(r.id);
          return (
            <Card key={r.id} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to="/invoices/$id" params={{ id: r.invoice_id }}>
                      <span className="font-mono text-sm font-semibold hover:underline">{r.invoice_number}</span>
                    </Link>
                    <Badge variant="outline" className="text-[10px]">{r.action}</Badge>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${r.tier === "now_full" ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" : r.tier === "blocked" ? "border-rose-500/40 text-rose-700 dark:text-rose-400" : ""}`}
                    >
                      tier={r.tier}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">mode={r.mode}</Badge>
                    <Badge variant="outline" className="text-[10px]">{r.confidence}%</Badge>
                    <span className="text-xs text-muted-foreground">· {fmtDateTime(r.created_at, isAr ? "ar" : "en")}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-md bg-muted px-2 py-0.5">{isAr ? "مطلوب" : "Needed"}: <b>{r.total_needed}</b></span>
                    {r.total_from_stock > 0 && <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">{isAr ? "من المخزون" : "From stock"}: <b>{r.total_from_stock}</b></span>}
                    {r.total_from_incoming > 0 && <span className="rounded-md bg-violet-500/15 px-2 py-0.5 text-violet-700 dark:text-violet-400">{isAr ? "من الشحنات" : "From incoming"}: <b>{r.total_from_incoming}</b></span>}
                    {r.total_shortfall > 0 && <span className="rounded-md bg-rose-500/15 px-2 py-0.5 text-rose-700 dark:text-rose-400">{isAr ? "ناقص" : "Short"}: <b>{r.total_shortfall}</b></span>}
                    {r.manual_count > 0 && <span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-sky-700 dark:text-sky-400">{isAr ? "بنود يدوية" : "Manual"}: <b>{r.manual_count}</b></span>}
                  </div>
                  {Array.isArray(r.reasons) && r.reasons.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {r.reasons.map((x, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] font-normal">
                          {reasonLabel(x.code, isAr)}{x.detail ? ` · ${x.detail}` : ""}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {r.note && <div className="mt-2 text-xs text-muted-foreground">{r.note}</div>}

                  <button
                    type="button"
                    onClick={() => toggle(r.id)}
                    className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {isOpen
                      ? (isAr ? "إخفاء التفاصيل" : "Hide details")
                      : (isAr ? "عرض الأسباب والـ JSON" : "Show reasons & JSON")}
                  </button>

                  {isOpen && (
                    <div className="mt-2 space-y-2 text-xs">
                      {Array.isArray(r.needs) && r.needs.length > 0 && (
                        <div className="rounded-md border border-border bg-muted/30 p-2">
                          <div className="mb-1 font-semibold">{isAr ? "تفاصيل البنود" : "Line details"}</div>
                          <div className="space-y-1">
                            {r.needs.map((n: any, i: number) => (
                              <div key={i} className="flex flex-wrap gap-2">
                                <span className="font-medium">{n.product_name}</span>
                                <span className="text-muted-foreground">{isAr ? "مطلوب" : "need"}={n.needed}</span>
                                {n.fromStock > 0 && <span className="text-emerald-700 dark:text-emerald-400">stock={n.fromStock}</span>}
                                {n.fromIncoming > 0 && <span className="text-violet-700 dark:text-violet-400">incoming={n.fromIncoming}</span>}
                                {n.shortfall > 0 && <span className="text-rose-700 dark:text-rose-400">short={n.shortfall}</span>}
                                {n.isManual && <Badge variant="outline" className="text-[10px]">manual</Badge>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <details className="rounded-md border border-border bg-background p-2">
                        <summary className="cursor-pointer text-muted-foreground">reasons JSON</summary>
                        <pre className="mt-2 overflow-x-auto text-[11px]">{JSON.stringify(r.reasons, null, 2)}</pre>
                      </details>
                      <details className="rounded-md border border-border bg-background p-2">
                        <summary className="cursor-pointer text-muted-foreground">needs JSON</summary>
                        <pre className="mt-2 overflow-x-auto text-[11px]">{JSON.stringify(r.needs, null, 2)}</pre>
                      </details>
                    </div>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => remove(r.id)} title={isAr ? "حذف" : "Delete"}>
                  <Trash2 className="h-4 w-4 text-rose-600" />
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {!loading && (filtered.length > visibleCount || hasMore) && (
        <div className="flex flex-col items-center gap-2 py-4">
          {filtered.length > visibleCount && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVisibleCount((v) => v + 50)}
            >
              {isAr
                ? `عرض المزيد (${Math.min(50, filtered.length - visibleCount)} من ${filtered.length - visibleCount})`
                : `Show more (${Math.min(50, filtered.length - visibleCount)} of ${filtered.length - visibleCount})`}
            </Button>
          )}
          {hasMore && filtered.length <= visibleCount && (
            <Button
              variant="secondary"
              size="sm"
              disabled={loadingMore}
              onClick={() => loadMore()}
            >
              {loadingMore
                ? (isAr ? "جارٍ التحميل…" : "Loading…")
                : (isAr ? "تحميل سجلات أقدم" : "Load older entries")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
