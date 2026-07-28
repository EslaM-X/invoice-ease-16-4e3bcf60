import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft, Pencil, Plus, FileDown, History, Trash2 } from "lucide-react";
import { fmtDateTime } from "@/lib/utils-money";
import steinheimLogo from "@/assets/steinheim-logo.png";
import { getSettings, type Settings } from "@/lib/data";
import { elementToPdf, fetchInvoiceItemsForPrint, type PrintRow } from "@/lib/delivery-receipts";
import { toast } from "sonner";
import { DeliveryReceiptTracker } from "@/components/delivery-receipt-tracker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";


type Search = { print?: boolean };

export const Route = createFileRoute("/delivery-receipts/$id")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    print: s.print === true || s.print === "true",
  }),
  component: () => <AppShell><ReceiptView /></AppShell>,
});

function ReceiptView() {
  const { id } = Route.useParams();
  const { print } = Route.useSearch();
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const navigate = useNavigate();
  const [r, setR] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [printRows, setPrintRows] = useState<PrintRow[] | null>(null);
  const [invoice, setInvoice] = useState<any>(null);
  const [, setSettings] = useState<Settings | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);



  useEffect(() => {
    (async () => {
      const { data: rec } = await supabase.from("delivery_receipts" as any).select("*").eq("id", id).single();
      setR(rec);
      const { data: its } = await supabase
        .from("delivery_receipt_items" as any).select("*").eq("receipt_id", id);
      setItems(its ?? []);
      if ((rec as any)?.invoice_id) {
        const { data: inv } = await supabase.from("invoices").select("*").eq("id", (rec as any).invoice_id).single();
        setInvoice(inv);
        // v2 layout: fetch merged rows so PDF shows ALL invoice items
        if ((rec as any)?.layout_version && (rec as any).layout_version >= 2) {
          try {
            const rows = await fetchInvoiceItemsForPrint(
              (rec as any).invoice_id,
              id,
              (rec as any).created_at,
            );
            setPrintRows(rows);
          } catch {
            setPrintRows(null);
          }
        } else {
          setPrintRows(null);
        }
      }
      const { data: audit } = await supabase
        .from("delivery_receipt_audit_log" as any)
        .select("*")
        .eq("receipt_id", id)
        .order("created_at", { ascending: false });
      setAuditLog((audit ?? []) as any[]);
      if (user) {
        const s = await getSettings(user.id);
        setSettings(s);
        if (s?.logo_url) {
          const { data: signed } = await supabase.storage.from("logos").createSignedUrl(s.logo_url, 3600);
          if (signed?.signedUrl) setLogoUrl(signed.signedUrl);
        }
      }
    })();
  }, [id, user]);

  useEffect(() => {
    if (print && r) setTimeout(() => window.print(), 400);
  }, [print, r]);

  const exportPdf = async () => {
    if (!printRef.current) return;
    setExporting(true);
    try {
      const pdf = await elementToPdf(printRef.current);
      pdf.save(`delivery-receipt-${r.receipt_number}.pdf`);
    } catch (e: any) {
      toast.error(e?.message || "PDF error");
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const { error: itErr } = await supabase.from("delivery_receipt_items" as any).delete().eq("receipt_id", id);
      if (itErr) throw itErr;
      const { error: recErr } = await supabase.from("delivery_receipts" as any).delete().eq("id", id);
      if (recErr) throw recErr;
      toast.success(isAr ? "تم حذف المحضر" : "Receipt deleted");
      navigate({ to: "/delivery-receipts" });
    } catch (e: any) {
      toast.error(e?.message || (isAr ? "تعذّر الحذف" : "Delete failed"));
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (!r) return <div className="text-muted-foreground">{isAr ? "جاري التحميل…" : "Loading…"}</div>;

  const shipping = r.shipping_fees != null ? Number(r.shipping_fees) : null;
  const taxEnabled = (r as any).tax_enabled === true;
  const taxRate = Number((r as any).tax_rate ?? 0.14) || 0.14;
  const taxSubtotal = taxEnabled && printRows
    ? printRows.reduce((s, it) => s + (it.this_qty * (it.unit_price || 0)), 0)
    : 0;
  const taxAmount = taxEnabled ? Math.round(taxSubtotal * taxRate * 100) / 100 : 0;
  const taxTotal = taxEnabled ? taxSubtotal + taxAmount + (shipping || 0) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <Link to="/delivery-receipts">
          <Button variant="ghost" className="gap-2 rounded-full"><ArrowLeft className="h-4 w-4" />{isAr ? "محاضر الاستلام" : "Receipts"}</Button>
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2 rounded-full" onClick={() => setShowAudit((v) => !v)}>
            <History className="h-4 w-4" />{isAr ? `سجل التعديلات (${auditLog.length})` : `Audit log (${auditLog.length})`}
          </Button>
          <Button variant="outline" className="gap-2 rounded-full" onClick={() => navigate({ to: "/delivery-receipts/$id/edit", params: { id } })}>
            <Pencil className="h-4 w-4" />{isAr ? "تعديل" : "Edit"}
          </Button>
          {invoice && (
            <Button variant="outline" className="gap-2 rounded-full" onClick={() => navigate({ to: "/delivery-receipts/new", search: { invoiceId: invoice.id } })}>
              <Plus className="h-4 w-4" />{isAr ? "محضر آخر لنفس الفاتورة" : "Another receipt"}
            </Button>
          )}
          <Button variant="outline" className="gap-2 rounded-full" onClick={exportPdf} disabled={exporting}>
            <FileDown className="h-4 w-4" />{exporting ? "..." : "PDF"}
          </Button>
          <Button
            variant="outline"
            className="gap-2 rounded-full border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-4 w-4" />{isAr ? "حذف" : "Delete"}
          </Button>
          <Button onClick={() => window.print()} className="gap-2 rounded-full px-5 shadow-glow">

            <Printer className="h-4 w-4" />{isAr ? "طباعة" : "Print"}
          </Button>
        </div>
      </div>

      <DeliveryReceiptTracker
        receipt={r}
        isAr={isAr}
        onChanged={async () => {
          const { data: rec } = await supabase.from("delivery_receipts" as any).select("*").eq("id", id).single();
          if (rec) setR(rec);
        }}
      />

      {printRows && printRows.length > 0 && (
        <RemainingSummary rows={printRows} isAr={isAr} invoiceId={invoice?.id} />
      )}

      {showAudit && (
        <div className="no-print rounded-2xl border bg-card p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4" />{isAr ? "سجل التعديلات" : "Audit log"}
          </h3>
          {auditLog.length === 0 ? (
            <div className="text-sm text-muted-foreground">{isAr ? "لا يوجد سجل" : "No history"}</div>
          ) : (
            <div className="space-y-3">
              {auditLog.map((a) => (
                <AuditEntry key={a.id} entry={a} isAr={isAr} />
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={printRef} className="print-area mx-auto max-w-3xl rounded-3xl border border-border/60 bg-white text-black shadow-elegant print:rounded-none print:border-0 print:shadow-none">
        <div className="flex flex-col px-8 pt-8 pb-6 sm:px-12 sm:pt-10" dir="ltr">
          <header className="relative flex flex-col items-center pb-2">
            <div className="absolute top-0 left-0 text-[11px] leading-tight">
              <div>السجل التجاري: <span className="font-semibold">68689</span></div>
              <div>البطاقة الضريبية: <span className="font-semibold">450374114</span></div>
            </div>
            <div className="absolute top-0 right-0 text-[11px] text-right leading-tight ltr-nums">
              <div>{fmtDateTime(r.delivered_at, lang)}</div>
              {r.created_by_email && <div className="text-[10px] text-gray-700">{r.created_by_email}</div>}
            </div>
            <img src={logoUrl || steinheimLogo} alt="Steinheim" className="invoice-logo h-24 w-auto object-contain" style={{ filter: "brightness(0)" }} crossOrigin="anonymous" />
          </header>

          <div className="mt-4 text-center">
            <div className="text-xl font-bold tracking-wide">{isAr ? "محضر استلام" : "DELIVERY RECEIPT"}</div>
            <div className="mt-1 text-[13px] ltr-nums">
              {isAr ? "رقم المحضر:" : "Receipt #:"} <span className="font-semibold">{r.receipt_number}</span>
              {invoice && (
                <span className="ms-3">
                  {isAr ? "للفاتورة:" : "For invoice:"} <span className="font-semibold">{invoice.invoice_number}</span>
                </span>
              )}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 text-[13px]" dir={isAr ? "rtl" : "ltr"}>
            <div>
              <div className="text-[11px] uppercase text-gray-600">{isAr ? "العميل / المشتري" : "Customer"}</div>
              <div className="font-semibold">{invoice?.customer_name || "—"}</div>
              {invoice?.customer_phone && <div className="text-[11px]">{invoice.customer_phone}</div>}
              {invoice?.customer_address && <div className="text-[11px]">{invoice.customer_address}</div>}
            </div>
            <div>
              <div className="text-[11px] uppercase text-gray-600">{isAr ? "المستلم" : "Recipient"}</div>
              <div className="font-semibold">{r.delivered_to_name || (isAr ? "(يوقّع المستلم أدناه)" : "(see signature below)")}</div>
              {r.delivered_to_phone && <div className="text-[11px] ltr-nums">{r.delivered_to_phone}</div>}
              {r.delivered_to_id_number && <div className="text-[11px] ltr-nums">{isAr ? "رقم البطاقة:" : "ID:"} {r.delivered_to_id_number}</div>}
            </div>
          </div>

          <section className="mt-5">
            <table className="w-full border-collapse text-[13px]" dir={isAr ? "rtl" : "ltr"}>
              <thead>
                <tr>
                  <th className="border border-gray-400 px-2 py-2 text-center font-normal w-[12%]">{isAr ? "الكود" : "Code"}</th>
                  <th className="border border-gray-400 px-2 py-2 text-center font-normal">{isAr ? "المنتج" : "Product"}</th>
                  <th className="border border-gray-400 px-2 py-2 text-center font-normal w-[12%]">{isAr ? "الكمية" : "Qty"}</th>
                  <th className="border border-gray-400 px-2 py-2 text-center font-normal w-[35%]">{isAr ? "ملاحظة" : "Note"}</th>
                </tr>
              </thead>
              <tbody>
                {printRows ? (
                  printRows.map((it) => {
                    const totalDelivered = it.this_qty + it.prior_qty + it.later_qty;
                    const remaining = Math.max(0, it.invoice_qty - totalDelivered);
                    const complete = remaining === 0;
                    const dim = it.this_qty === 0;
                    // Build the smart summary line for the note column
                    const summary = isAr
                      ? `من أصل ${it.invoice_qty} — الآن: ${it.this_qty}` +
                        (it.prior_qty > 0 ? ` • مسبقًا: ${it.prior_qty}` : "") +
                        (it.later_qty > 0 ? ` • لاحقًا: ${it.later_qty}` : "") +
                        (remaining > 0 ? ` • الباقي: ${remaining}` : " • مكتمل ✓")
                      : `Of ${it.invoice_qty} — now: ${it.this_qty}` +
                        (it.prior_qty > 0 ? ` • prior: ${it.prior_qty}` : "") +
                        (it.later_qty > 0 ? ` • later: ${it.later_qty}` : "") +
                        (remaining > 0 ? ` • remaining: ${remaining}` : " • complete ✓");
                    const combinedNote = [it.this_note, summary].filter(Boolean).join(" — ");

                    // Multi-part breakdown
                    let partsBlock: React.ReactNode = null;
                    if (it.is_multi_part) {
                      const t = it.parts_this, p = it.parts_prior, l = it.parts_later;
                      const fullAll = t.full + p.full + l.full;
                      const mixerAll = t.mixer + p.mixer + l.mixer;
                      const trimAll = t.trim + p.trim + l.trim;
                      const totalMixers = mixerAll + fullAll;
                      const totalTrims = trimAll + fullAll;
                      const missMix = Math.max(0, it.invoice_qty - totalMixers);
                      const missTrim = Math.max(0, it.invoice_qty - totalTrims);
                      // Only show the parts breakdown table when the line actually
                      // has split parts (mixer/trim) somewhere across receipts.
                      // If everything was delivered as "full", the main row + the
                      // "فاضل N" badge is enough — no need for the extra table.
                      const hasSplitParts = mixerAll > 0 || trimAll > 0;
                      const rowsDef = [
                        { label: isAr ? "المنتج كامل" : "Full product", now: t.full, all: fullAll },
                        { label: isAr ? "الخلاط الدفن (MIXER)" : "Mixer (concealed)", now: t.mixer, all: mixerAll },
                        { label: isAr ? "الجزء الظاهر (Trim)" : "External trim", now: t.trim, all: trimAll },
                      ];
                      if (hasSplitParts) {
                      partsBlock = (

                        <div className="mt-1.5 border border-gray-500 bg-white print:border-black" dir={isAr ? "rtl" : "ltr"}>
                          <div className="border-b border-gray-500 px-2 py-0.5 text-[10px] font-bold text-gray-900 print:border-black">
                            {isAr ? "تفصيل الأجزاء لهذا البند" : "Parts breakdown for this line"}
                          </div>
                          <table className="w-full border-collapse text-[10px]">
                            <thead>
                              <tr>
                                <th className="border border-gray-500 px-1.5 py-0.5 text-start font-semibold text-gray-900 print:border-black">{isAr ? "الجزء" : "Part"}</th>
                                <th className="border border-gray-500 px-1.5 py-0.5 text-center font-semibold text-gray-900 print:border-black">{isAr ? "في هذا المحضر" : "This receipt"}</th>
                                <th className="border border-gray-500 px-1.5 py-0.5 text-center font-semibold text-gray-900 print:border-black">{isAr ? "الإجمالي" : "Total"}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rowsDef.map((rd, i) => (
                                <tr key={i}>
                                  <td className="border border-gray-500 px-1.5 py-0.5 text-gray-900 print:border-black">{rd.label}</td>
                                  <td className="border border-gray-500 px-1.5 py-0.5 text-center ltr-nums font-bold text-gray-900 print:border-black">{rd.now}</td>
                                  <td className="border border-gray-500 px-1.5 py-0.5 text-center ltr-nums text-gray-900 print:border-black">{rd.all}</td>
                                </tr>
                              ))}
                              <tr>
                                <td className="border border-gray-500 px-1.5 py-0.5 font-semibold text-gray-900 print:border-black">
                                  {isAr ? "إجمالي المكسر (كامل + دفن)" : "Total mixers (full + concealed)"}
                                </td>
                                <td className="border border-gray-500 px-1.5 py-0.5 text-center ltr-nums text-gray-900 print:border-black" colSpan={2}>
                                  <b>{totalMixers}</b> / {it.invoice_qty}
                                  {missMix > 0 && <span className="ms-1 font-semibold">— {isAr ? "ناقص" : "missing"} {missMix}</span>}
                                </td>
                              </tr>
                              <tr>
                                <td className="border border-gray-500 px-1.5 py-0.5 font-semibold text-gray-900 print:border-black">
                                  {isAr ? "إجمالي الظاهر (كامل + Trim)" : "Total trims (full + trim)"}
                                </td>
                                <td className="border border-gray-500 px-1.5 py-0.5 text-center ltr-nums text-gray-900 print:border-black" colSpan={2}>
                                  <b>{totalTrims}</b> / {it.invoice_qty}
                                  {missTrim > 0 && <span className="ms-1 font-semibold">— {isAr ? "ناقص" : "missing"} {missTrim}</span>}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      );
                      }
                    }


                    // Detailed breakdown tooltip for the "فاضل N" badge
                    const badgeTooltip = isAr
                      ? `الفاتورة: ${it.invoice_qty}\nهذا المحضر: ${it.this_qty}\nمحاضر سابقة: ${it.prior_qty}\nمحاضر لاحقة: ${it.later_qty}\nالمتبقي: ${remaining}`
                      : `Invoice: ${it.invoice_qty}\nThis receipt: ${it.this_qty}\nPrior receipts: ${it.prior_qty}\nLater receipts: ${it.later_qty}\nRemaining: ${remaining}`;

                    return (
                      <tr key={it.invoice_item_id} className={dim ? "text-gray-500" : ""}>
                        <td className="border border-gray-400 px-2 py-2 text-center align-middle ltr-nums text-[11px]">{it.serial_number || "—"}</td>
                        <td className="border border-gray-400 px-2 py-2 align-middle">
                          <div className={dim ? "font-normal" : "font-medium"}>{it.product_name}</div>
                          {it.color && <div className="text-[11px] text-gray-700">{isAr ? "اللون:" : "Color:"} {it.color}</div>}
                          {partsBlock}
                        </td>
                        <td className="border border-gray-400 px-2 py-2 text-center align-middle">
                          <div className="ltr-nums text-base font-bold">{it.this_qty}</div>
                          <div
                            title={badgeTooltip}
                            className={`mt-0.5 inline-block cursor-help rounded-full border px-1.5 py-[1px] text-[9.5px] font-semibold ltr-nums print:border-black print:bg-white print:text-black ${
                              complete
                                ? "border-emerald-600 bg-white text-emerald-700"
                                : "border-amber-600 bg-white text-amber-700"
                            }`}
                          >
                            {complete
                              ? (isAr ? "مكتمل ✓" : "Complete ✓")
                              : (isAr ? `فاضل ${remaining}` : `${remaining} left`)}
                          </div>
                        </td>
                        <td className="border border-gray-400 px-2 py-2 align-middle text-[11px]">{combinedNote}</td>
                      </tr>
                    );
                  })
                ) : (
                  items.map((it) => (
                    <tr key={it.id}>
                      <td className="border border-gray-400 px-2 py-2 text-center align-middle ltr-nums text-[11px]">{it.serial_number || "—"}</td>
                      <td className="border border-gray-400 px-2 py-2 align-middle">
                        <div className="font-medium">{it.product_name}</div>
                        {it.color && <div className="text-[11px] text-gray-700">{isAr ? "اللون:" : "Color:"} {it.color}</div>}
                      </td>
                      <td className="border border-gray-400 px-2 py-2 text-center align-middle ltr-nums font-semibold">{it.quantity}</td>
                      <td className="border border-gray-400 px-2 py-2 align-middle text-[11px]">{it.note || ""}</td>
                    </tr>
                  ))
                )}
                {(printRows ? printRows.length === 0 : items.length === 0) && (
                  <tr><td colSpan={4} className="border border-gray-400 px-2 py-4 text-center text-gray-500">—</td></tr>
                )}
                {shipping != null && shipping > 0 && (
                  <tr className="bg-gray-50">
                    <td className="border border-gray-400 px-2 py-2 text-center align-middle text-[11px]">—</td>
                    <td className="border border-gray-400 px-2 py-2 align-middle font-semibold">{isAr ? "رسوم الشحن" : "Shipping fees"}</td>
                    <td className="border border-gray-400 px-2 py-2 text-center align-middle ltr-nums font-semibold">{shipping.toLocaleString()}</td>
                    <td className="border border-gray-400 px-2 py-2 align-middle text-[11px]"></td>
                  </tr>
                )}
              </tbody>
            </table>

            {taxEnabled && printRows && (
              <div className="mt-3 flex justify-end" dir={isAr ? "rtl" : "ltr"}>
                <table className="w-full max-w-sm border-collapse text-[12px]">
                  <tbody>
                    <tr>
                      <td className="border border-gray-400 px-2 py-1.5">{isAr ? "الفرعي" : "Subtotal"}</td>
                      <td className="border border-gray-400 px-2 py-1.5 text-right ltr-nums font-semibold">{taxSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                    {shipping != null && shipping > 0 && (
                      <tr>
                        <td className="border border-gray-400 px-2 py-1.5">{isAr ? "الشحن" : "Shipping"}</td>
                        <td className="border border-gray-400 px-2 py-1.5 text-right ltr-nums font-semibold">{shipping.toLocaleString()}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="border border-gray-400 px-2 py-1.5">{isAr ? `ضريبة القيمة المضافة (${Math.round(taxRate * 100)}%)` : `VAT (${Math.round(taxRate * 100)}%)`}</td>
                      <td className="border border-gray-400 px-2 py-1.5 text-right ltr-nums font-semibold">{taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                    <tr className="bg-gray-100">
                      <td className="border border-gray-400 px-2 py-1.5 font-bold">{isAr ? "الإجمالي شامل الضريبة" : "Total incl. VAT"}</td>
                      <td className="border border-gray-400 px-2 py-1.5 text-right ltr-nums font-bold">{taxTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>


          {r.notes && (
            <section className="mt-5 text-[12px]" dir={isAr ? "rtl" : "ltr"}>
              <div className="font-semibold">{isAr ? "ملاحظات:" : "Notes:"}</div>
              <p className="mt-1 whitespace-pre-wrap">{r.notes}</p>
            </section>
          )}

          <div className="mt-3 rounded-md border border-gray-300 bg-gray-50 p-3 text-[12px]" dir={isAr ? "rtl" : "ltr"}>
            {isAr
              ? "أقرّ أنا الموقّع أدناه باستلام البنود المذكورة أعلاه بحالة سليمة وكاملة المواصفات."
              : "I, the undersigned, hereby acknowledge receipt of the above items in good and complete condition."}
          </div>

          <section className="mt-8 grid grid-cols-2 gap-6 text-[12px]" dir={isAr ? "rtl" : "ltr"}>
            <SignatureBlock title={isAr ? "توقيع المستلم" : "Recipient"} name={r.delivered_to_name} sig={r.signature_customer} />
            <SignatureBlock title={isAr ? "مدير الحسابات" : "Accountant"} name={r.accountant_name} sig={r.signature_accountant} />
          </section>

          <footer className="mt-6 border-t border-gray-300 pt-2 text-center text-[10.5px] leading-relaxed" dir="ltr">
            <div>403 - Fourth Floor - Unit 238 - 5th Settlement Urban Center - Cairo – Egypt</div>
            <div>Tel: (+20) 12 23998124 / Email: inquiries@steinheim-eg.com / Web Site: www.steinheim-eg.com</div>
          </footer>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isAr ? "تأكيد حذف المحضر" : "Confirm receipt deletion"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isAr
                ? `هل أنت متأكد من حذف محضر الاستلام رقم ${r?.receipt_number ?? ""}؟ لا يمكن التراجع عن هذا الإجراء.`
                : `Are you sure you want to delete receipt ${r?.receipt_number ?? ""}? This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{isAr ? "إلغاء" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (isAr ? "جارٍ الحذف…" : "Deleting…") : (isAr ? "أكيد، احذف" : "Yes, delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


function SignatureBlock({ title, name, sig }: { title: string; name?: string | null; sig?: string | null }) {
  return (
    <div className="text-center">
      <div className="mb-1 text-[11px] uppercase text-gray-600">{title}</div>
      <div className="flex h-20 items-center justify-center rounded border border-gray-300 bg-white">
        {sig ? <img src={sig} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-[10px] text-gray-400">—</span>}
      </div>
      <div className="mt-1 border-t border-gray-400 pt-1 text-[11px] font-medium">{name || ""}</div>
    </div>
  );
}

const FIELD_LABELS_AR: Record<string, string> = {
  delivered_to_name: "اسم المستلم",
  delivered_to_phone: "هاتف المستلم",
  delivered_to_id_number: "رقم البطاقة",
  notes: "الملاحظات",
  manager_name: "اسم المدير",
  accountant_name: "اسم مدير الحسابات",
  signature_customer: "توقيع المستلم",
  signature_manager: "توقيع المدير",
  signature_accountant: "توقيع مدير الحسابات",
  status: "الحالة",
  shipping_fees: "رسوم الشحن",
};

function AuditEntry({ entry, isAr }: { entry: any; isAr: boolean }) {
  const [open, setOpen] = useState(false);
  const fields: string[] = (entry.changed_fields || []).filter(
    (f: string) => !["id", "created_at", "user_id", "invoice_id", "receipt_number", "created_by", "created_by_email", "updated_by", "updated_by_email"].includes(f),
  );
  const before = entry.before_data || {};
  const after = entry.after_data || {};
  const fmt = (v: any) => {
    if (v == null || v === "") return "—";
    if (typeof v === "string" && v.startsWith("data:image")) return isAr ? "[توقيع]" : "[signature]";
    if (typeof v === "string" && v.length > 80) return v.slice(0, 80) + "…";
    return String(v);
  };
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
            entry.action === "created" ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700" :
            entry.action === "deleted" ? "border-red-500/30 bg-red-500/15 text-red-700" :
            "border-amber-500/30 bg-amber-500/15 text-amber-700"
          }`}>{entry.action}</span>
          <span className="text-xs font-medium">{entry.actor_email || (isAr ? "نظام" : "system")}</span>
          <span className="text-xs text-muted-foreground">{new Date(entry.created_at).toLocaleString("ar-EG")}</span>
        </div>
        {fields.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} className="h-7 text-xs">
            {open ? (isAr ? "إخفاء" : "Hide") : (isAr ? `عرض الحقول (${fields.length})` : `Show fields (${fields.length})`)}
          </Button>
        )}
      </div>
      {open && fields.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {fields.map((f) => {
            const beforeIsSig = typeof before[f] === "string" && before[f].startsWith("data:image");
            const afterIsSig = typeof after[f] === "string" && after[f].startsWith("data:image");
            return (
              <div key={f} className="grid grid-cols-1 gap-1 rounded border border-border/40 bg-background p-2 text-xs sm:grid-cols-[120px_1fr_1fr]">
                <div className="font-semibold text-muted-foreground">{FIELD_LABELS_AR[f] || f}</div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">{isAr ? "قبل" : "Before"}</div>
                  {beforeIsSig ? (
                    <img src={before[f]} alt="" className="h-12 rounded border bg-white" />
                  ) : (
                    <div className="break-all text-red-700 line-through">{fmt(before[f])}</div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">{isAr ? "بعد" : "After"}</div>
                  {afterIsSig ? (
                    <img src={after[f]} alt="" className="h-12 rounded border bg-white" />
                  ) : (
                    <div className="break-all text-emerald-700">{fmt(after[f])}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RemainingSummary({ rows, isAr, invoiceId }: { rows: PrintRow[]; isAr: boolean; invoiceId?: string }) {
  const lines = rows.map((it) => {
    const totalDelivered = it.this_qty + it.prior_qty + it.later_qty;
    const remaining = Math.max(0, it.invoice_qty - totalDelivered);
    return { ...it, totalDelivered, remaining };
  });
  const totalReq = lines.reduce((s, l) => s + l.invoice_qty, 0);
  const totalDone = lines.reduce((s, l) => s + Math.min(l.invoice_qty, l.totalDelivered), 0);
  const totalRem = Math.max(0, totalReq - totalDone);
  const openLines = lines.filter((l) => l.remaining > 0);

  return (
    <div className="no-print rounded-2xl border bg-card p-5 shadow-elegant">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{isAr ? "ملخّص التسليم عبر كل المحاضر" : "Delivery summary across all receipts"}</h3>
          <p className="text-[11px] text-muted-foreground">
            {isAr
              ? "لحظي — يتجمّع من كل محاضر هذه الفاتورة (بما فيها المحضر الحالي)."
              : "Live — aggregated from every receipt on this invoice (including this one)."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-semibold">
            {isAr ? "المطلوب" : "Required"}: <span className="ltr-nums">{totalReq}</span>
          </span>
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
            {isAr ? "مسلَّم" : "Delivered"}: <span className="ltr-nums">{totalDone}</span>
          </span>
          <span className={`rounded-full border px-2 py-0.5 font-semibold ${totalRem === 0 ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
            {isAr ? "الباقي" : "Remaining"}: <span className="ltr-nums">{totalRem}</span>
          </span>
          {invoiceId && totalRem > 0 && (
            <Link
              to="/delivery-receipts/new"
              search={{ invoiceId } as any}
              className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-semibold text-primary hover:bg-primary/20"
            >
              {isAr ? "أنشئ محضر للباقي" : "New receipt for remaining"} →
            </Link>
          )}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-[11px]">
            <tr>
              <th className="px-2 py-1.5 text-start">{isAr ? "المنتج" : "Product"}</th>
              <th className="px-2 py-1.5 text-center">{isAr ? "المطلوب" : "Req"}</th>
              <th className="px-2 py-1.5 text-center">{isAr ? "هذا المحضر" : "This"}</th>
              <th className="px-2 py-1.5 text-center">{isAr ? "محاضر أخرى" : "Other"}</th>
              <th className="px-2 py-1.5 text-center">{isAr ? "الإجمالي" : "Total"}</th>
              <th className="px-2 py-1.5 text-center">{isAr ? "الباقي" : "Remain"}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((l) => {
              const other = l.prior_qty + l.later_qty;
              const done = l.remaining === 0;
              return (
                <tr key={l.invoice_item_id} className={done ? "bg-emerald-500/5" : ""}>
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{l.product_name}</div>
                    {(l.serial_number || l.color) && (
                      <div className="text-[10px] text-muted-foreground">
                        {l.serial_number && <span className="me-2">SN: {l.serial_number}</span>}
                        {l.color && <span>{isAr ? "اللون" : "Color"}: {l.color}</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center ltr-nums">{l.invoice_qty}</td>
                  <td className="px-2 py-1.5 text-center ltr-nums">{l.this_qty}</td>
                  <td className="px-2 py-1.5 text-center ltr-nums">{other}</td>
                  <td className="px-2 py-1.5 text-center ltr-nums font-semibold">{Math.min(l.invoice_qty, l.totalDelivered)}</td>
                  <td className={`px-2 py-1.5 text-center ltr-nums font-bold ${done ? "text-emerald-600" : "text-amber-600"}`}>
                    {l.remaining}
                    {done && " ✓"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openLines.length === 0 && (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-center text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          {isAr ? "كل بنود الفاتورة تم تسليمها ✓" : "All invoice items have been delivered ✓"}
        </div>
      )}
    </div>
  );
}
