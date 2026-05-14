import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Archive, Search, Eye, ArrowLeft, ArrowRight, FileSpreadsheet, ClipboardCheck, CheckCircle2 } from "lucide-react";
import { fmtDate, fmtMoney } from "@/lib/utils-money";
import { useRealtimeTable } from "@/lib/realtime";
import { TableSkeleton } from "@/components/skeletons";
import { AuthorBadge } from "@/components/author-badge";
import { exportInvoicesToExcel, type InvoiceRow } from "@/lib/invoice-export";

export const Route = createFileRoute("/invoices/archive")({
  component: () => (
    <AppShell>
      <ArchivePage />
    </AppShell>
  ),
});

function ArchivePage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [list, setList] = useState<any[]>([]);
  const [drCounts, setDrCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = async () => {
    if (!user) return;
    let query = supabase
      .from("invoices")
      .select("*")
      .neq("status", "voided")
      .eq("delivery_status", "delivered")
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to + "T23:59:59");
    const { data } = await query;
    // Only fully paid (closed)
    const closed = (data ?? []).filter((i: any) => {
      const total = Number(i.total ?? 0);
      const paid = Number(i.paid_amount ?? 0);
      return total > 0 && paid >= total - 0.001;
    });
    setList(closed);

    // Delivery receipts count per invoice
    if (closed.length) {
      const ids = closed.map((i) => i.id);
      const { data: drs } = await supabase
        .from("delivery_receipts" as any)
        .select("invoice_id")
        .in("invoice_id", ids);
      const counts: Record<string, number> = {};
      (drs ?? []).forEach((r: any) => {
        counts[r.invoice_id] = (counts[r.invoice_id] ?? 0) + 1;
      });
      setDrCounts(counts);
    } else {
      setDrCounts({});
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [user, from, to]);
  useRealtimeTable("invoices", () => load());
  useRealtimeTable("delivery_receipts" as any, () => load());

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((i) =>
      (i.invoice_number ?? "").toLowerCase().includes(s) ||
      String(i.receipt_number ?? "").includes(s) ||
      (i.customer_name ?? "").toLowerCase().includes(s) ||
      (i.customer_phone ?? "").toLowerCase().includes(s)
    );
  }, [list, q]);

  const totalValue = useMemo(
    () => filtered.reduce((s, i) => s + Number(i.total ?? 0), 0),
    [filtered]
  );

  const exportXlsx = () => {
    const rows: InvoiceRow[] = filtered.map((i) => ({
      id: i.id,
      invoice_number: i.invoice_number,
      receipt_number: i.receipt_number,
      created_at: i.created_at,
      customer_name: i.customer_name,
      customer_phone: i.customer_phone,
      subtotal: Number(i.subtotal ?? 0),
      discount: Number(i.discount ?? 0),
      total: Number(i.total ?? 0),
      status: i.status,
    }));
    exportInvoicesToExcel(rows, lang);
  };

  const BackIcon = isAr ? ArrowRight : ArrowLeft;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-5">
        <div className="absolute -end-12 -top-12 h-44 w-44 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 shadow-sm">
                <Archive className="h-5 w-5" />
              </span>
              {isAr ? "أرشيف الفواتير المُغلقة" : "Closed Invoices Archive"}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {isAr
                ? "كل فاتورة تم دفعها بالكامل وتسليمها بالكامل تنتقل هنا تلقائياً وتختفي من قائمة الفواتير الرئيسية."
                : "Invoices that are fully paid AND fully delivered are auto-archived here and removed from the main invoices list."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/invoices">
              <Button variant="outline" className="gap-2">
                <BackIcon className="h-4 w-4" />
                {isAr ? "العودة للفواتير" : "Back to Invoices"}
              </Button>
            </Link>
            <Button onClick={exportXlsx} className="gap-2" disabled={!filtered.length}>
              <FileSpreadsheet className="h-4 w-4" />
              {isAr ? "تصدير Excel" : "Export Excel"}
            </Button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">{isAr ? "عدد الفواتير المُغلقة" : "Closed invoices"}</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{filtered.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">{isAr ? "إجمالي القيمة" : "Total value"}</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {fmtMoney(totalValue, "EGP", lang)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">{isAr ? "محاضر تسليم مرتبطة" : "Linked delivery receipts"}</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">
            {Object.values(drCounts).reduce((s, n) => s + n, 0)}
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={isAr ? "ابحث برقم الفاتورة أو اسم العميل…" : "Search by invoice no. or customer…"}
            className="ps-9"
          />
        </div>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {/* List */}
      <div className="surface-elevated overflow-hidden rounded-2xl border bg-card">
        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {isAr ? "لا توجد فواتير مُغلقة بعد." : "No closed invoices yet."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{isAr ? "رقم الفاتورة" : "Invoice"}</th>
                  <th className="px-4 py-3 text-start font-medium">{isAr ? "العميل" : "Customer"}</th>
                  <th className="px-4 py-3 text-start font-medium hidden sm:table-cell">{isAr ? "تاريخ الإغلاق" : "Closed at"}</th>
                  <th className="px-4 py-3 text-start font-medium">{isAr ? "محاضر التسليم" : "Delivery receipts"}</th>
                  <th className="px-4 py-3 text-start font-medium">{isAr ? "الإجمالي" : "Total"}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((i) => (
                  <tr key={i.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">
                      <div className="flex flex-wrap items-center gap-2">
                        {i.receipt_number != null && (
                          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                            #{i.receipt_number}
                          </span>
                        )}
                        <span>{i.invoice_number}</span>
                        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {isAr ? "مُغلقة" : "Closed"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{i.customer_name || "—"}</div>
                      <AuthorBadge email={i.created_by_email} label={isAr ? "أنشئت بواسطة" : "created by"} className="mt-0.5" />
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">
                      {fmtDate(i.updated_at ?? i.created_at, lang)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] font-semibold">
                        <ClipboardCheck className="h-3 w-3" />
                        {drCounts[i.id] ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums">
                      {fmtMoney(Number(i.total), "EGP", lang)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Link to="/invoices/$id" params={{ id: i.id }}>
                          <Button variant="ghost" size="icon" title={isAr ? "عرض" : "View"}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
