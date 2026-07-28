import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRole } from "@/lib/use-role";
import { useBatchedRealtimeTables } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { fmtDate, fmtMoney } from "@/lib/utils-money";
import { toast } from "sonner";
import { CheckCircle2, ClipboardCheck, ClockAlert, ExternalLink, FileDown, ShieldAlert } from "lucide-react";
import { exportMatchLogByPeriod, exportMatchLogForInvoice } from "@/lib/delivery-match-log-export";


export const Route = createFileRoute("/delivery-review")({
  component: () => <AppShell><Page /></AppShell>,
  head: () => ({
    meta: [
      { title: "Delivery Review — Steinheim Suite" },
      { name: "description", content: "Admin review queue for invoices whose delivery receipts appear complete but remain open." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type ReviewRow = {
  id: string;
  invoice_number: string;
  customer_name: string | null;
  total: number;
  paid_amount: number | null;
  created_at: string;
  delivery_computed_state: string;
  status: string;
  requiredQty: number;
  signedQty: number;
  activeQty: number;
  receiptCount: number;
  signedReceiptCount: number;
};

function Page() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { isAdmin, loading: roleLoading } = useRole();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string>("");

  const load = async () => {
    if (!user) return;
    setLoading(true);
    // Invoices that are NOT yet complete but have signed receipts covering (or nearly covering) the total.
    // We include: awaiting_signature (dispatched but unsigned) + partial + any state whose signed sum
    // already meets/exceeds required qty but state hasn't flipped for edge reasons.
    const { data: invs } = await supabase
      .from("invoices")
      .select("id, invoice_number, customer_name, total, paid_amount, created_at, delivery_computed_state, status")
      .not("delivery_computed_state", "in", "(complete,na,no_items)")
      .not("status", "in", "(draft,voided)")
      .order("created_at", { ascending: false })
      .range(0, 999);

    const ids = (invs ?? []).map((i: any) => i.id);
    if (ids.length === 0) { setRows([]); setLoading(false); return; }

    const [{ data: items }, { data: drs }] = await Promise.all([
      supabase
        .from("invoice_items")
        .select("invoice_id, product_id, quantity")
        .in("invoice_id", ids),
      supabase
        .from("delivery_receipts" as any)
        .select("id, invoice_id, status")
        .in("invoice_id", ids),
    ]);
    const requiredByInv: Record<string, number> = {};
    (items ?? []).forEach((it: any) => {
      if (!it.product_id || !it.quantity) return;
      requiredByInv[it.invoice_id] = (requiredByInv[it.invoice_id] ?? 0) + Number(it.quantity);
    });
    const drIds = (drs ?? []).map((r: any) => r.id);
    const receiptCountByInv: Record<string, number> = {};
    const signedRcByInv: Record<string, number> = {};
    (drs ?? []).forEach((r: any) => {
      receiptCountByInv[r.invoice_id] = (receiptCountByInv[r.invoice_id] ?? 0) + 1;
      if (["signed", "paid"].includes(r.status)) signedRcByInv[r.invoice_id] = (signedRcByInv[r.invoice_id] ?? 0) + 1;
    });
    const drStatusById = new Map<string, string>((drs ?? []).map((r: any) => [r.id, r.status]));
    const drInvoiceById = new Map<string, string>((drs ?? []).map((r: any) => [r.id, r.invoice_id]));

    let signedByInv: Record<string, number> = {};
    let activeByInv: Record<string, number> = {};
    if (drIds.length) {
      const { data: dris } = await supabase
        .from("delivery_receipt_items" as any)
        .select("receipt_id, quantity")
        .in("receipt_id", drIds)
        .range(0, 49999);
      (dris ?? []).forEach((r: any) => {
        const st = drStatusById.get(r.receipt_id);
        const inv = drInvoiceById.get(r.receipt_id);
        if (!inv) return;
        const q = Number(r.quantity ?? 0);
        if (["signed", "paid"].includes(st ?? "")) signedByInv[inv] = (signedByInv[inv] ?? 0) + q;
        if (["out_for_delivery", "signed", "paid"].includes(st ?? "")) activeByInv[inv] = (activeByInv[inv] ?? 0) + q;
      });
    }

    const merged: ReviewRow[] = (invs ?? []).map((i: any) => ({
      id: i.id,
      invoice_number: i.invoice_number,
      customer_name: i.customer_name,
      total: Number(i.total ?? 0),
      paid_amount: Number(i.paid_amount ?? 0),
      created_at: i.created_at,
      delivery_computed_state: i.delivery_computed_state,
      status: i.status,
      requiredQty: requiredByInv[i.id] ?? 0,
      signedQty: signedByInv[i.id] ?? 0,
      activeQty: activeByInv[i.id] ?? 0,
      receiptCount: receiptCountByInv[i.id] ?? 0,
      signedReceiptCount: signedRcByInv[i.id] ?? 0,
    }));

    // Priority: signed >= required first (these are the "should-be-closed" cases)
    merged.sort((a, b) => {
      const aFull = a.requiredQty > 0 && a.signedQty >= a.requiredQty ? 0 : 1;
      const bFull = b.requiredQty > 0 && b.signedQty >= b.requiredQty ? 0 : 1;
      if (aFull !== bFull) return aFull - bFull;
      return +new Date(b.created_at) - +new Date(a.created_at);
    });

    setRows(merged);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  // Live: refresh on any invoice / delivery receipt change so the queue
  // updates without a manual reload.
  useBatchedRealtimeTables(
    ["invoices", "delivery_receipts", "delivery_receipt_items"],
    () => { load(); },
    [user?.id],
  );

  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exportBusy, setExportBusy] = useState<string>("");

  const exportPeriod = async () => {
    setExportBusy("period");
    try {
      const n = await exportMatchLogByPeriod(exportFrom, exportTo);
      toast.success(isAr ? `تم تصدير ${n} سجل` : `Exported ${n} rows`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally {
      setExportBusy("");
    }
  };

  const exportRow = async (id: string, invoiceNumber: string) => {
    setExportBusy(id);
    try {
      const n = await exportMatchLogForInvoice(id, invoiceNumber);
      if (!n) toast.message(isAr ? "لا توجد سجلات لهذه الفاتورة" : "No match log rows for this invoice");
      else toast.success(isAr ? `تم تصدير ${n} سجل` : `Exported ${n} rows`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally {
      setExportBusy("");
    }
  };

  const approve = async (id: string, invoiceNumber: string) => {
    setBusy(id);
    const { error } = await supabase.rpc("approve_invoice_delivery_manual" as any, {
      _invoice_id: id,
      _reason: `Admin approved via Delivery Review — ${invoiceNumber}`,
    } as any);
    setBusy("");
    if (error) return toast.error(error.message);
    toast.success(isAr ? "تمت الأرشفة" : "Archived");
    load();
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(r =>
      r.invoice_number.toLowerCase().includes(s) ||
      (r.customer_name ?? "").toLowerCase().includes(s)
    );
  }, [rows, q]);

  const readyCount = filtered.filter(r => r.requiredQty > 0 && r.signedQty >= r.requiredQty).length;

  if (roleLoading) return <div className="p-8 text-sm text-muted-foreground">…</div>;
  if (!isAdmin) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <ShieldAlert className="h-4 w-4" />
        {isAr ? "متاح للأدمن فقط" : "Admins only"}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gradient-gold">
            {isAr ? "مراجعة تدقيق التسليم" : "Delivery Review"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAr
              ? "فواتير محاضرها موقعة لكنها لم تُقفل تلقائيًا. راجع واعتمِد الأرشفة."
              : "Invoices whose receipts are signed but still open. Review and approve archiving."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
            <ClockAlert className="h-3 w-3" />
            {isAr ? "جاهزة للأرشفة" : "Ready"}: {readyCount}
          </Badge>
          <Badge variant="outline" className="gap-1">
            {isAr ? "الإجمالي" : "Total"}: {rows.length}
          </Badge>
        </div>
      </div>

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileDown className="h-4 w-4 text-amber-500" />
            {isAr ? "تصدير سجل مطابقات التسليم (CSV)" : "Export delivery match log (CSV)"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{isAr ? "من" : "From"}</label>
            <Input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} className="w-[160px]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{isAr ? "إلى" : "To"}</label>
            <Input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} className="w-[160px]" />
          </div>
          <Button onClick={exportPeriod} disabled={exportBusy === "period"} className="gap-2">
            <FileDown className="h-4 w-4" />
            {exportBusy === "period"
              ? (isAr ? "جاري التصدير…" : "Exporting…")
              : (isAr ? "تصدير الفترة" : "Export period")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {isAr
              ? "يترك التاريخين فارغين لتصدير السجل بالكامل."
              : "Leave both dates empty to export the full log."}
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-4 w-4 text-amber-500" />
            {isAr ? "قائمة المراجعة" : "Review queue"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder={isAr ? "ابحث برقم الفاتورة أو اسم العميل…" : "Search by invoice # or customer…"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-md"
          />
          {loading ? (
            <div className="text-sm text-muted-foreground">…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 text-emerald-500/70" />
              {isAr ? "لا توجد فواتير عالقة" : "No stuck invoices — everything is up to date"}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/50">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs">
                  <tr>
                    <th className="p-2 text-start">{isAr ? "الفاتورة" : "Invoice"}</th>
                    <th className="p-2 text-start">{isAr ? "العميل" : "Customer"}</th>
                    <th className="p-2 text-start">{isAr ? "المطلوب" : "Required"}</th>
                    <th className="p-2 text-start">{isAr ? "موقّع" : "Signed"}</th>
                    <th className="p-2 text-start">{isAr ? "في الطريق" : "Active"}</th>
                    <th className="p-2 text-start">{isAr ? "الحالة" : "State"}</th>
                    <th className="p-2 text-start">{isAr ? "الإجمالي" : "Total"}</th>
                    <th className="p-2 text-start">{isAr ? "التاريخ" : "Date"}</th>
                    <th className="p-2 text-start">{isAr ? "إجراء" : "Action"}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const ready = r.requiredQty > 0 && r.signedQty >= r.requiredQty;
                    return (
                      <tr key={r.id} className="border-t border-border/40 hover:bg-muted/30">
                        <td className="p-2 font-medium">
                          <Link to="/invoices/$id" params={{ id: r.id }} className="inline-flex items-center gap-1 text-primary hover:underline">
                            {r.invoice_number}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </td>
                        <td className="p-2">{r.customer_name ?? "—"}</td>
                        <td className="p-2 tabular-nums">{r.requiredQty}</td>
                        <td className="p-2 tabular-nums">
                          <span className={ready ? "font-bold text-emerald-600 dark:text-emerald-400" : ""}>
                            {r.signedQty}
                          </span>
                        </td>
                        <td className="p-2 tabular-nums">{r.activeQty}</td>
                        <td className="p-2">
                          <StateBadge state={r.delivery_computed_state} isAr={isAr} />
                        </td>
                        <td className="p-2 tabular-nums">{fmtMoney(r.total, lang)}</td>
                        <td className="p-2 whitespace-nowrap">{fmtDate(r.created_at, lang)}</td>
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant={ready ? "default" : "outline"}
                                disabled={busy === r.id}
                                className={ready ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                              >
                                {ready
                                  ? (isAr ? "اعتماد الأرشفة" : "Approve archive")
                                  : (isAr ? "أرشفة يدوية" : "Force archive")}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  {isAr ? "تأكيد الأرشفة" : "Confirm archive"}
                                </AlertDialogTitle>
                                <AlertDialogDescription className="space-y-2">
                                  <div>{isAr ? `الفاتورة ${r.invoice_number}` : `Invoice ${r.invoice_number}`}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {isAr
                                      ? `المطلوب: ${r.requiredQty} — الموقّع: ${r.signedQty} — في الطريق: ${r.activeQty}`
                                      : `Required: ${r.requiredQty} — Signed: ${r.signedQty} — Active: ${r.activeQty}`}
                                  </div>
                                  {!ready && (
                                    <div className="rounded bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                                      {isAr
                                        ? "تحذير: الكميات الموقعة أقل من المطلوب. سيتم تعليم الفاتورة كمُسلَّمة يدويًا."
                                        : "Warning: Signed quantity is below required. Invoice will be marked delivered manually."}
                                    </div>
                                  )}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{isAr ? "إلغاء" : "Cancel"}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => approve(r.id, r.invoice_number)}>
                                  {isAr ? "اعتمد" : "Approve"}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={exportBusy === r.id}
                              onClick={() => exportRow(r.id, r.invoice_number)}
                              title={isAr ? "تصدير سجل المطابقة CSV" : "Export match log CSV"}
                            >
                              <FileDown className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StateBadge({ state, isAr }: { state: string; isAr: boolean }) {
  const map: Record<string, { cls: string; ar: string; en: string }> = {
    complete: { cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", ar: "مكتمل", en: "Complete" },
    awaiting_signature: { cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400", ar: "بانتظار توقيع", en: "Awaiting sig." },
    partial: { cls: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400", ar: "جزئي", en: "Partial" },
    pending: { cls: "border-muted bg-muted text-muted-foreground", ar: "معلّق", en: "Pending" },
    no_items: { cls: "border-muted bg-muted text-muted-foreground", ar: "بدون بنود", en: "No items" },
  };
  const cfg = map[state] ?? map.pending;
  return <Badge variant="outline" className={cfg.cls}>{isAr ? cfg.ar : cfg.en}</Badge>;
}
