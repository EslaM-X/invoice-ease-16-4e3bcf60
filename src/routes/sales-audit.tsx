import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtDate, fmtMoney } from "@/lib/utils-money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Calendar as CalendarIcon,
  RotateCcw,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Download,
  Database,
} from "lucide-react";
import { toast } from "sonner";
import {
  computeSold,
  reconcileDay,
  classifyReason,
  dayWindow,
  type CalcInvoice,
  type CalcInvoiceItem,
  type CalcInventoryLog,
} from "@/lib/sales-calc";

const searchSchema = z.object({ date: z.string().optional() });

export const Route = createFileRoute("/sales-audit")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "تدقيق المبيعات | Sales Audit & Reconciliation" },
      { name: "description", content: "تدقيق دقيق لمصدر حساب المبيعات اليومي ومطابقته مع سجل المخزون." },
    ],
  }),
  component: () => (
    <AppShell>
      <SalesAudit />
    </AppShell>
  ),
});

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function SalesAudit() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const search = Route.useSearch();
  const [date, setDate] = useState<string>(search.date ?? todayISO());

  const [invoices, setInvoices] = useState<CalcInvoice[]>([]);
  const [items, setItems] = useState<CalcInvoiceItem[]>([]);
  const [logs, setLogs] = useState<CalcInventoryLog[]>([]);
  const [voidedInvoices, setVoidedInvoices] = useState<{ id: string; invoice_number: string; created_at: string; total: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const isLoading = useRef(false);

  const load = async () => {
    if (isLoading.current) return;
    isLoading.current = true;
    if (invoices.length === 0 && logs.length === 0) setLoading(true);

    const { startISO, endISO } = dayWindow(date);

    // Fetch ALL invoices in window (incl. voided), items, and inventory logs.
    const [invRes, logRes] = await Promise.all([
      supabase
        .from("invoices")
        .select("id,invoice_number,status,created_at,total,invoice_items(invoice_id,product_id,product_name,serial_number,color,quantity,unit_price)")
        .gte("created_at", startISO)
        .lt("created_at", endISO)
        .limit(10000),
      supabase
        .from("inventory_logs")
        .select("product_id,change,reason,invoice_id,created_at")
        .gte("created_at", startISO)
        .lt("created_at", endISO)
        .limit(10000),
    ]);

    if (invRes.error) toast.error(invRes.error.message);
    if (logRes.error) toast.error(logRes.error.message);

    const invs: CalcInvoice[] = [];
    const its: CalcInvoiceItem[] = [];
    const voided: typeof voidedInvoices = [];
    for (const inv of (invRes.data ?? []) as any[]) {
      invs.push({
        id: inv.id,
        invoice_number: inv.invoice_number,
        status: inv.status,
        created_at: inv.created_at,
      });
      if (inv.status === "voided") {
        voided.push({ id: inv.id, invoice_number: inv.invoice_number, created_at: inv.created_at, total: Number(inv.total ?? 0) });
      }
      for (const it of inv.invoice_items ?? []) {
        its.push({
          invoice_id: inv.id,
          product_id: it.product_id,
          product_name: it.product_name,
          serial_number: it.serial_number,
          color: it.color,
          quantity: Number(it.quantity ?? 0),
          unit_price: Number(it.unit_price ?? 0),
        });
      }
    }

    setInvoices(invs);
    setItems(its);
    setVoidedInvoices(voided);
    setLogs(((logRes.data ?? []) as any[]).map((l) => ({
      product_id: l.product_id,
      change: Number(l.change ?? 0),
      reason: l.reason,
      invoice_id: l.invoice_id,
      created_at: l.created_at,
    })));
    setLoading(false);
    isLoading.current = false;
  };

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, date, reloadTick]);

  useRealtimeTable("invoices", () => setReloadTick((x) => x + 1));
  useRealtimeTable("invoice_items", () => setReloadTick((x) => x + 1));
  useRealtimeTable("inventory_logs", () => setReloadTick((x) => x + 1));

  const sold = useMemo(() => computeSold({ date, invoices, items }), [date, invoices, items]);
  const recon = useMemo(
    () => reconcileDay({ date, invoices, items, logs }),
    [date, invoices, items, logs]
  );

  const itemsByInvoice = useMemo(() => {
    const m = new Map<string, CalcInvoiceItem[]>();
    for (const it of items) {
      const arr = m.get(it.invoice_id) ?? [];
      arr.push(it);
      m.set(it.invoice_id, arr);
    }
    return m;
  }, [items]);

  const exportRecon = () => {
    const headers = ["product_id", "product_name", "invoices_sold_qty", "logs_net_out", "diff", "notes"];
    const lines = recon.rows.map((r) =>
      [r.product_id, r.product_name, r.invoices_sold_qty, r.logs_net_out, r.diff, r.notes.join(" | ")]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    );
    const csv = "\uFEFF" + headers.join(",") + "\n" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `reconciliation-${date}.csv`;
    a.click();
  };

  const completedInvoices = invoices.filter((i) => i.status !== "voided");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/sales-today">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              {lang === "ar" ? "تدقيق المبيعات والمطابقة" : "Sales Audit & Reconciliation"}
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {lang === "ar"
              ? "مصدر حساب كل وحدة مباعة + مطابقة مع سجل المخزون لاكتشاف أي اختلاف."
              : "Source of truth for every sold unit + reconciliation against inventory logs."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <CalendarIcon className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className="ps-8 w-40" />
          </div>
          <Button size="sm" variant="outline" onClick={() => load()} disabled={loading}>
            <RotateCcw className={`me-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {lang === "ar" ? "إعادة الحساب الآن" : "Recompute now"}
          </Button>
          <Button size="sm" variant="outline" onClick={exportRecon} disabled={recon.rows.length === 0}>
            <Download className="me-1.5 h-4 w-4" />
            CSV
          </Button>
        </div>
      </div>

      {/* Status banner */}
      <div
        className={`rounded-2xl border p-4 ${
          recon.ok
            ? "border-success/40 bg-success/5"
            : "border-destructive/40 bg-destructive/5"
        }`}
      >
        <div className="flex items-start gap-3">
          {recon.ok ? (
            <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-success" />
          ) : (
            <AlertTriangle className="h-6 w-6 flex-shrink-0 text-destructive" />
          )}
          <div className="flex-1">
            <div className="font-semibold">
              {recon.ok
                ? lang === "ar"
                  ? "✓ مطابقة تامة — لا توجد فروق بين الفواتير وسجل المخزون"
                  : "✓ Fully reconciled — no diffs between invoices and inventory logs"
                : lang === "ar"
                ? `⚠ تم اكتشاف ${recon.mismatches} اختلاف — راجع الجدول أدناه`
                : `⚠ ${recon.mismatches} mismatch(es) found — review below`}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {fmtDate(date, lang)} • {lang === "ar" ? "محدّث لحظياً" : "Live"}
            </div>
          </div>
        </div>
      </div>

      {/* Calculation source */}
      <div className="grid gap-4 md:grid-cols-3">
        <SourceCard
          label={lang === "ar" ? "فواتير معتمدة" : "Counted invoices"}
          value={String(completedInvoices.length)}
          hint={lang === "ar" ? "status ≠ voided + داخل اليوم" : "status ≠ voided + within day"}
          tone="primary"
        />
        <SourceCard
          label={lang === "ar" ? "فواتير ملغاة (مستبعدة)" : "Voided (excluded)"}
          value={String(sold.excluded.voided_invoices)}
          hint={lang === "ar" ? "لا تُحتسب في المبيعات" : "Not counted as sales"}
          tone="warning"
        />
        <SourceCard
          label={lang === "ar" ? "صافي الوحدات المباعة" : "Net units sold"}
          value={String(sold.totals.units)}
          hint={fmtMoney(sold.totals.value, "EGP", lang)}
          tone="success"
        />
      </div>

      {/* Source-of-truth panel */}
      <div className="rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-5 py-4">
          <h3 className="flex items-center gap-2 font-semibold">
            <Database className="h-4 w-4 text-primary" />
            {lang === "ar" ? "مصدر الحساب: invoice_items للفواتير غير الملغاة" : "Calc source: invoice_items of non-voided invoices"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {lang === "ar"
              ? "كل سطر هنا تم احتسابه فعلياً في إجمالي اليوم. أي فاتورة محذوفة لا تظهر — لأنها ممسوحة من قاعدة البيانات."
              : "Every line below was actually counted today. Deleted invoices don't appear — they're gone from the DB."}
          </p>
        </div>
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {lang === "ar" ? "جاري التحميل..." : "Loading..."}
          </div>
        ) : completedInvoices.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {lang === "ar" ? "لا توجد فواتير معتمدة في هذا اليوم." : "No counted invoices on this date."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "الفاتورة" : "Invoice"}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "الحالة" : "Status"}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "التاريخ" : "Time"}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "بنود مُحتسبة" : "Counted lines"}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {completedInvoices.map((inv) => {
                  const lines = (itemsByInvoice.get(inv.id) ?? []).filter((l) => l.product_id);
                  return (
                    <tr key={inv.id} className="align-top hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link to="/invoices/$id" params={{ id: inv.id }} className="text-primary hover:underline">
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <span className="rounded bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(inv.created_at, lang)}</td>
                      <td className="px-3 py-2">
                        {lines.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <ul className="space-y-1">
                            {lines.map((l, i) => (
                              <li key={i} className="text-xs">
                                <span className="font-medium">{l.product_name}</span>
                                {l.serial_number && <span className="ms-1 font-mono text-muted-foreground">[{l.serial_number}]</span>}
                                <span className="ms-2 rounded bg-primary/10 px-1.5 py-0.5 font-bold tabular-nums text-primary">×{l.quantity}</span>
                                <span className="ms-2 text-muted-foreground">@ {fmtMoney(l.unit_price, "EGP", lang)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Voided invoices (excluded) */}
      {voidedInvoices.length > 0 && (
        <div className="rounded-2xl border border-warning/40 bg-warning/5 p-4">
          <h3 className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 text-warning-foreground" />
            {lang === "ar" ? `فواتير ملغاة في هذا اليوم (مستبعدة من الحساب) — ${voidedInvoices.length}` : `Voided invoices on this date (excluded) — ${voidedInvoices.length}`}
          </h3>
          <ul className="mt-3 space-y-1 text-xs">
            {voidedInvoices.map((v) => (
              <li key={v.id} className="flex items-center gap-3">
                <Link to="/invoices/$id" params={{ id: v.id }} className="font-mono text-primary hover:underline">{v.invoice_number}</Link>
                <span className="text-muted-foreground">{fmtDate(v.created_at, lang)}</span>
                <span className="ms-auto text-muted-foreground line-through">{fmtMoney(v.total, "EGP", lang)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Reconciliation table */}
      <div className="rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-5 py-4">
          <h3 className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            {lang === "ar" ? "تقرير التسوية: الفواتير ↔ سجل المخزون" : "Reconciliation: Invoices ↔ Inventory logs"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {lang === "ar"
              ? "diff = صافي ما اتباع (من الفواتير) − صافي ما خرج من المخزون (من السجل). يجب أن يكون = 0 لكل منتج."
              : "diff = sold (invoices) − net out (inventory logs). Must be 0 per product."}
          </p>
        </div>
        {recon.rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {lang === "ar" ? "لا توجد حركات في هذا اليوم." : "No movements on this date."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "المنتج" : "Product"}</th>
                  <th className="px-3 py-2 text-end font-medium">{lang === "ar" ? "من الفواتير" : "From invoices"}</th>
                  <th className="px-3 py-2 text-end font-medium">{lang === "ar" ? "صافي خروج (سجل)" : "Net out (logs)"}</th>
                  <th className="px-3 py-2 text-end font-medium">Diff</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "تفاصيل السجل" : "Log details"}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recon.rows.map((r) => (
                  <tr key={r.product_id} className={r.diff !== 0 ? "bg-destructive/5" : "hover:bg-muted/20"}>
                    <td className="px-3 py-2 font-medium">{r.product_name}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{r.invoices_sold_qty}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{r.logs_net_out}</td>
                    <td className="px-3 py-2 text-end">
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 font-bold tabular-nums ${
                        r.diff === 0 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
                      }`}>
                        {r.diff === 0 ? "✓ 0" : (r.diff > 0 ? `+${r.diff}` : r.diff)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground">
                      {r.notes.length === 0 ? "—" : r.notes.join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inventory logs raw */}
      <details className="rounded-2xl border bg-card shadow-sm">
        <summary className="cursor-pointer px-5 py-4 font-semibold">
          {lang === "ar" ? `سجل المخزون الخام لليوم (${logs.length} حركة)` : `Raw inventory logs for the day (${logs.length} movements)`}
        </summary>
        <div className="overflow-x-auto border-t">
          <table className="w-full text-xs min-w-[720px]">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-start font-medium">Time</th>
                <th className="px-3 py-2 text-start font-medium">Kind</th>
                <th className="px-3 py-2 text-end font-medium">Change</th>
                <th className="px-3 py-2 text-start font-medium">Reason</th>
                <th className="px-3 py-2 text-start font-medium">Invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((l, i) => {
                const kind = classifyReason(l.reason);
                return (
                  <tr key={i}>
                    <td className="px-3 py-1.5 text-muted-foreground">{fmtDate(l.created_at, lang)}</td>
                    <td className="px-3 py-1.5">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{kind}</span>
                    </td>
                    <td className={`px-3 py-1.5 text-end tabular-nums font-bold ${l.change < 0 ? "text-destructive" : "text-success"}`}>
                      {l.change > 0 ? `+${l.change}` : l.change}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{l.reason}</td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">
                      {l.invoice_id ? l.invoice_id.slice(0, 8) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function SourceCard({
  label, value, hint, tone,
}: {
  label: string; value: string; hint?: string; tone?: "primary" | "success" | "warning";
}) {
  const toneClass =
    tone === "success" ? "border-success/40 bg-success/5"
    : tone === "warning" ? "border-warning/40 bg-warning/5"
    : "border-primary/30 bg-primary/5";
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
