import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useRealtimeTable } from "@/lib/realtime";
import {
  fetchDeliveryAudit,
  drStatusLabel,
  drStatusColor,
  bucketColor,
  bucketLabel,
  toCsv,
  type AuditInvoice,
} from "@/lib/delivery-audit";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/utils-money";
import {
  Search,
  FileDown,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Package,
  Truck,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ExternalLink,
} from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";

export const Route = createFileRoute("/delivery-audit")({
  head: () => ({
    meta: [
      { title: "تدقيق محاضر الاستلام — Delivery Audit" },
      {
        name: "description",
        content:
          "لوحة تدقيق شاملة لكل محاضر الاستلام والبنود المُسلَّمة والمتبقية لكل فاتورة (قراءة فقط).",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <DeliveryAuditPage />
    </AppShell>
  ),
});

type Filter = "all" | "in_transit" | "partial" | "complete" | "over" | "none";

function DeliveryAuditPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AuditInvoice[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [refreshTick, setRefreshTick] = useState(0);

  const load = async () => {
    try {
      const data = await fetchDeliveryAudit();
      setRows(data);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, refreshTick]);

  // Live: refresh on any DR / DR item change
  useRealtimeTable("delivery_receipts" as any, () => setRefreshTick((t) => t + 1));
  useRealtimeTable("delivery_receipt_items" as any, () => setRefreshTick((t) => t + 1));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "in_transit" && r.delivered_total_in_transit === 0) return false;
      if (filter !== "all" && filter !== "in_transit" && r.status_bucket !== filter) return false;
      if (!s) return true;
      return (
        r.invoice_number.toLowerCase().includes(s) ||
        (r.customer_name ?? "").toLowerCase().includes(s) ||
        r.receipts.some((rc) => rc.receipt_number.toLowerCase().includes(s))
      );
    });
  }, [rows, q, filter]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        acc.invoices += 1;
        acc.receipts += r.receipts_count;
        acc.qty += r.invoice_total_qty;
        acc.delivered += r.delivered_total_effective;
        acc.transit += r.delivered_total_in_transit;
        acc.remaining += r.remaining_total;
        return acc;
      },
      { invoices: 0, receipts: 0, qty: 0, delivered: 0, transit: 0, remaining: 0 },
    );
  }, [filtered]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const download = () => {
    const csv = toCsv(filtered);
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `delivery-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6" dir={isAr ? "rtl" : "ltr"}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-7 w-7 text-primary" />
            {isAr ? "تدقيق محاضر الاستلام" : "Delivery Receipts Audit"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAr
              ? "قراءة فقط — تجميع كل محاضر الاستلام لكل فاتورة والبنود المُسلَّمة والمتبقية بدقة، لحظيًا."
              : "Read-only aggregation of every delivery receipt per invoice, live."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setRefreshTick((t) => t + 1)}>
            <RefreshCw className="h-4 w-4 me-2" />
            {isAr ? "تحديث" : "Refresh"}
          </Button>
          <Button variant="outline" size="sm" onClick={download} disabled={filtered.length === 0}>
            <FileDown className="h-4 w-4 me-2" />
            CSV
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Kpi icon={<FileText className="h-4 w-4" />} label={isAr ? "فواتير" : "Invoices"} value={totals.invoices} />
        <Kpi icon={<Package className="h-4 w-4" />} label={isAr ? "محاضر" : "Receipts"} value={totals.receipts} />
        <Kpi icon={<Package className="h-4 w-4" />} label={isAr ? "إجمالي الكميات" : "Total qty"} value={totals.qty} />
        <Kpi
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          label={isAr ? "مُسلَّم فعلي" : "Delivered"}
          value={totals.delivered}
          tone="emerald"
        />
        <Kpi
          icon={<Truck className="h-4 w-4 text-sky-600" />}
          label={isAr ? "في الطريق" : "In transit"}
          value={totals.transit}
          tone="sky"
        />
        <Kpi
          icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
          label={isAr ? "متبقي" : "Remaining"}
          value={totals.remaining}
          tone="amber"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={isAr ? "بحث برقم الفاتورة/العميل/رقم المحضر…" : "Search by invoice #, customer, or DR #…"}
            className="ps-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", isAr ? "الكل" : "All"],
              ["in_transit", isAr ? "في الطريق" : "In transit"],
              ["partial", isAr ? "جزئي" : "Partial"],
              ["complete", isAr ? "مكتمل" : "Complete"],
              ["none", isAr ? "لم يبدأ" : "Not started"],
              ["over", isAr ? "زائد" : "Over"],
            ] as [Filter, string][]
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ring-1 transition ${
                filter === k
                  ? "bg-primary text-primary-foreground ring-primary"
                  : "bg-background hover:bg-muted ring-border"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <TableSkeleton />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          {isAr ? "لا توجد نتائج مطابقة." : "No matching invoices."}
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-start px-3 py-2 w-8"></th>
                  <th className="text-start px-3 py-2">{isAr ? "الفاتورة" : "Invoice"}</th>
                  <th className="text-start px-3 py-2">{isAr ? "العميل" : "Customer"}</th>
                  <th className="text-center px-3 py-2">{isAr ? "المحاضر" : "Receipts"}</th>
                  <th className="text-center px-3 py-2">{isAr ? "الكمية" : "Qty"}</th>
                  <th className="text-center px-3 py-2 text-emerald-700 dark:text-emerald-400">
                    {isAr ? "مُسلَّم" : "Delivered"}
                  </th>
                  <th className="text-center px-3 py-2 text-sky-700 dark:text-sky-400">
                    {isAr ? "في الطريق" : "In transit"}
                  </th>
                  <th className="text-center px-3 py-2 text-amber-700 dark:text-amber-400">
                    {isAr ? "متبقي" : "Remaining"}
                  </th>
                  <th className="text-start px-3 py-2">{isAr ? "التقدم" : "Progress"}</th>
                  <th className="text-start px-3 py-2">{isAr ? "الحالة" : "Status"}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => (
                  <FragmentRow
                    key={r.invoice_id}
                    row={r}
                    isAr={isAr}
                    expanded={expanded.has(r.invoice_id)}
                    onToggle={() => toggle(r.invoice_id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "emerald" | "sky" | "amber";
}) {
  const toneCls =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "sky"
      ? "text-sky-700 dark:text-sky-400"
      : tone === "amber"
      ? "text-amber-700 dark:text-amber-400"
      : "";
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-2xl font-bold tabular-nums mt-1 ${toneCls}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function FragmentRow({
  row,
  isAr,
  expanded,
  onToggle,
}: {
  row: AuditInvoice;
  isAr: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="hover:bg-muted/40 cursor-pointer" onClick={onToggle}>
        <td className="px-3 py-2">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </td>
        <td className="px-3 py-2 font-medium tabular-nums">
          <Link
            to="/invoices/$id"
            params={{ id: row.invoice_id }}
            onClick={(e) => e.stopPropagation()}
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            {row.invoice_number}
            <ExternalLink className="h-3 w-3 opacity-60" />
          </Link>
        </td>
        <td className="px-3 py-2 text-muted-foreground">{row.customer_name ?? "—"}</td>
        <td className="px-3 py-2 text-center tabular-nums">{row.receipts_count}</td>
        <td className="px-3 py-2 text-center tabular-nums font-medium">{row.invoice_total_qty}</td>
        <td className="px-3 py-2 text-center tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
          {row.delivered_total_effective}
        </td>
        <td className="px-3 py-2 text-center tabular-nums text-sky-700 dark:text-sky-400">
          {row.delivered_total_in_transit || "—"}
        </td>
        <td className="px-3 py-2 text-center tabular-nums text-amber-700 dark:text-amber-400">
          {row.remaining_total || "—"}
        </td>
        <td className="px-3 py-2 min-w-[120px]">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${row.completion_pct}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground w-9 text-end">
              {row.completion_pct}%
            </span>
          </div>
        </td>
        <td className="px-3 py-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${bucketColor(
              row.status_bucket,
            )}`}
          >
            {bucketLabel(row.status_bucket, isAr)}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-muted/20">
          <td colSpan={10} className="px-4 py-4">
            <DetailPanel row={row} isAr={isAr} />
          </td>
        </tr>
      )}
    </>
  );
}

function DetailPanel({ row, isAr }: { row: AuditInvoice; isAr: boolean }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Invoice lines */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Package className="h-4 w-4" />
          {isAr ? "بنود الفاتورة" : "Invoice lines"}
          <span className="text-xs text-muted-foreground font-normal">({row.lines.length})</span>
        </h3>
        <div className="rounded-lg border bg-background overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-start px-2 py-1.5">{isAr ? "المنتج" : "Product"}</th>
                <th className="text-center px-2 py-1.5">{isAr ? "كمية" : "Qty"}</th>
                <th className="text-center px-2 py-1.5 text-emerald-700 dark:text-emerald-400">
                  {isAr ? "مُسلَّم" : "Delivered"}
                </th>
                <th className="text-center px-2 py-1.5 text-sky-700 dark:text-sky-400">
                  {isAr ? "طريق" : "Transit"}
                </th>
                <th className="text-center px-2 py-1.5 text-amber-700 dark:text-amber-400">
                  {isAr ? "متبقي" : "Left"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {row.lines.map((l) => (
                <tr key={l.invoice_item_id} className={l.over_delivered ? "bg-red-500/5" : ""}>
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{l.product_name}</div>
                    {(l.color || l.serial_number) && (
                      <div className="text-[10px] text-muted-foreground">
                        {[l.color, l.serial_number].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center tabular-nums">{l.invoice_qty}</td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
                    {l.delivered_qty_effective}
                    {l.over_delivered && (
                      <AlertTriangle className="h-3 w-3 inline ms-1 text-red-600" />
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-sky-700 dark:text-sky-400">
                    {l.delivered_qty_in_transit || "—"}
                  </td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-amber-700 dark:text-amber-400 font-semibold">
                    {l.remaining || (l.over_delivered ? `+${l.delivered_qty_effective - l.invoice_qty}` : "—")}
                  </td>
                </tr>
              ))}
              {row.lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">
                    {isAr ? "لا توجد بنود في الفاتورة." : "No invoice lines."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Receipts */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <FileText className="h-4 w-4" />
          {isAr ? "محاضر الاستلام" : "Delivery receipts"}
          <span className="text-xs text-muted-foreground font-normal">({row.receipts.length})</span>
        </h3>
        <div className="space-y-2">
          {row.receipts.map((rc) => (
            <div key={rc.id} className="rounded-lg border bg-background p-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Link
                    to="/delivery-receipts/$id"
                    params={{ id: rc.id }}
                    className="font-medium text-primary hover:underline inline-flex items-center gap-1 text-xs tabular-nums"
                  >
                    {rc.receipt_number}
                    <ExternalLink className="h-3 w-3 opacity-60" />
                  </Link>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${drStatusColor(
                      rc.status,
                    )}`}
                  >
                    {drStatusLabel(rc.status, isAr)}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  {fmtDate(rc.created_at)}
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {rc.delivered_to_name && (
                  <span>
                    {isAr ? "المستلم: " : "To: "}
                    {rc.delivered_to_name}
                  </span>
                )}
                {rc.delivered_to_name && rc.created_by_email && " · "}
                {rc.created_by_email && (
                  <span>
                    {isAr ? "أنشأ: " : "By: "}
                    {rc.created_by_email}
                  </span>
                )}
              </div>
              {rc.items.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs">
                  {rc.items.map((it) => (
                    <li key={it.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        <span className="text-muted-foreground me-1">·</span>
                        {it.product_name}
                        {it.color && (
                          <span className="text-[10px] text-muted-foreground ms-1">({it.color})</span>
                        )}
                        {it.note && (
                          <span className="text-[10px] text-muted-foreground ms-1">
                            — {it.note}
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums font-semibold">×{it.quantity}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-1.5 text-[10px] text-muted-foreground text-end tabular-nums">
                {isAr ? "الإجمالي: " : "Total: "}
                <span className="font-semibold">{rc.total_qty}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
