import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft, Languages, Pencil, Ban, Eye, ClipboardCheck, Plus, CheckCircle2, Wallet } from "lucide-react";
import { deliveryStatusLabel, deliveryStatusColor } from "@/lib/delivery-receipts";
import { fmtDateTime, fmtMoney } from "@/lib/utils-money";
import type { Settings } from "@/lib/data";
import { getSettings } from "@/lib/data";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import steinheimLogo from "@/assets/steinheim-logo.png";
import { InvoiceTimeline } from "@/components/invoice-timeline";
import { useRealtimeTable } from "@/lib/realtime";
import { PaymentsManager } from "@/components/payments-manager";

export const Route = createFileRoute("/invoices/$id")({ component: () => <AppShell><InvoiceView /></AppShell> });

function InvoiceView() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const { t, lang, setLang, dir } = useI18n();
  const navigate = useNavigate();
  const [inv, setInv] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data: i } = await supabase.from("invoices").select("*").eq("id", id).single();
    const { data: it } = await supabase.from("invoice_items").select("*").eq("invoice_id", id);
    setInv(i);
    setItems(it ?? []);
    const s = await getSettings(user.id);
    setSettings(s);
    if (s?.logo_url) {
      const { data: signed } = await supabase.storage.from("logos").createSignedUrl(s.logo_url, 3600);
      if (signed?.signedUrl) setLogoUrl(signed.signedUrl);
    }
  };

  useEffect(() => { load(); }, [id, user]);
  useRealtimeTable("invoices", (p) => { if (p.new?.id === id || p.old?.id === id) load(); }, [id]);
  useRealtimeTable("invoice_items", (p) => { if (p.new?.invoice_id === id || p.old?.invoice_id === id) load(); }, [id]);
  useRealtimeTable("invoice_events", (p) => { if (p.new?.invoice_id === id) load(); }, [id]);

  const voidIt = async () => {
    const { error } = await supabase.rpc("void_invoice", { _invoice_id: id } as any);
    if (error) return toast.error(error.message);
    toast.success(t("invoice_voided"));
    load();
  };

  const toggleDelivered = async (next: boolean) => {
    const { error } = await supabase
      .from("invoices")
      .update({ delivery_status: next ? "delivered" : "pending" } as any)
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(next ? (lang === "ar" ? "تم التعليم بالتسليم" : "Marked delivered") : (lang === "ar" ? "تم إلغاء التسليم" : "Unmarked delivered"));
    load();
  };

  // Payments are managed via PaymentsManager dialog (adds/removes rows in `payments` table);
  // a DB trigger keeps invoices.paid_amount synced.


  if (!inv) return <div className="text-muted-foreground">{t("loading")}</div>;

  const isAr = lang === "ar";
  const isVoided = inv.status === "voided";

  // Use the invoice/receipt number as the default PDF filename.
  const safeName = (s: string) => String(s || "invoice").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").trim();
  const pdfFilename = `Steinheim-Invoice-${safeName(String(inv.receipt_number ?? inv.invoice_number))}`;

  // Browsers use document.title as the default "Save as PDF" filename.
  // We aggressively pin the title before printing — TanStack Router's
  // <HeadContent /> and the Lovable preview wrapper both try to overwrite it,
  // so we use a MutationObserver to keep it locked until the dialog closes.
  const printInvoice = () => {
    const original = document.title;
    const target = pdfFilename;

    // Remove any extra <title> tags (HeadContent may inject duplicates)
    const titles = Array.from(document.head.querySelectorAll("title"));
    titles.slice(1).forEach((n) => n.remove());

    let titleEl = document.head.querySelector("title");
    if (!titleEl) {
      titleEl = document.createElement("title");
      document.head.appendChild(titleEl);
    }
    titleEl.textContent = target;
    document.title = target;

    // Lock the title — re-apply if anything tries to change it
    const observer = new MutationObserver(() => {
      if (document.title !== target) document.title = target;
      const t = document.head.querySelector("title");
      if (t && t.textContent !== target) t.textContent = target;
    });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    const interval = window.setInterval(() => {
      if (document.title !== target) document.title = target;
    }, 50);

    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      observer.disconnect();
      window.clearInterval(interval);
      window.removeEventListener("afterprint", restore);
      // Small delay so the browser's "save" finishes capturing the title
      setTimeout(() => { document.title = original; }, 1000);
    };
    window.addEventListener("afterprint", restore);
    setTimeout(restore, 120_000); // safety net

    setTimeout(() => window.print(), 100);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <Link to="/invoices"><Button variant="ghost" className="gap-2 rounded-full"><ArrowLeft className="h-4 w-4" />{t("invoices")}</Button></Link>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2 rounded-full" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
            <Languages className="h-4 w-4" />{lang === "ar" ? "English" : "العربية"}
          </Button>
          {!isVoided && (
            <>
              <Button variant="outline" className="gap-2 rounded-full" onClick={() => navigate({ to: "/invoices/$id/edit", params: { id } })}>
                <Pencil className="h-4 w-4" />{t("edit")}
              </Button>
              {(() => {
                const totalNum = Number(inv.total);
                const paidNum = inv.paid_amount != null ? Number(inv.paid_amount) : +(totalNum * 0.5).toFixed(2);
                const remaining = +(totalNum - paidNum).toFixed(2);
                const isDelivered = inv.delivery_status === "delivered";
                return (
                  <>
                    <Button
                      variant={isDelivered ? "default" : "outline"}
                      className={`gap-2 rounded-full ${isDelivered ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"}`}
                      onClick={() => toggleDelivered(!isDelivered)}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {isDelivered ? (isAr ? "مُسلَّمة" : "Delivered") : (isAr ? "تعليم تسليم" : "Mark delivered")}
                    </Button>
                    {remaining > 0 && (
                      <Button
                        variant="outline"
                        className="gap-2 rounded-full border-blue-500/40 text-blue-700 dark:text-blue-400 hover:bg-blue-500/10"
                        onClick={payRemaining}
                      >
                        <Wallet className="h-4 w-4" />
                        {isAr ? `سداد المتبقي (${Number(remaining).toFixed(2)} EGP)` : `Pay remaining (${Number(remaining).toFixed(2)} EGP)`}
                      </Button>
                    )}
                  </>
                );
              })()}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="gap-2 rounded-full text-destructive hover:text-destructive">
                    <Ban className="h-4 w-4" />{t("void")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("void_invoice")}</AlertDialogTitle>
                    <AlertDialogDescription>{t("void_invoice_confirm")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={voidIt}>{t("confirm")}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          <Button variant="outline" className="gap-2 rounded-full" onClick={() => setPreviewOpen(true)}><Eye className="h-4 w-4" />{t("print_preview")}</Button>
          <Button onClick={printInvoice} className="gap-2 rounded-full px-5 shadow-glow"><Printer className="h-4 w-4" />{t("print")} / PDF</Button>
        </div>
      </div>

      <div className="print-area mx-auto max-w-3xl rounded-3xl border border-border/60 bg-card shadow-elegant relative print:rounded-none print:border-0 print:shadow-none" dir={dir}>
        {isVoided && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
            <span className="rotate-[-20deg] rounded-lg border-4 border-destructive px-8 py-2 text-5xl font-black tracking-widest text-destructive opacity-30">
              {isAr ? "ملغاة" : "VOIDED"}
            </span>
          </div>
        )}
        {!isVoided && inv.delivery_status === "delivered" && (
          <div className="pointer-events-none absolute inset-0 flex items-start justify-end z-10 p-6 sm:p-10">
            <span className="rotate-[12deg] rounded-lg border-4 border-emerald-600 px-6 py-1.5 text-3xl font-black tracking-widest text-emerald-600 opacity-30">
              {isAr ? "تم التسليم" : "DELIVERED"}
            </span>
          </div>
        )}
        {!isVoided && (() => {
          const totalNum = Number(inv.total);
          const paidNum = inv.paid_amount != null ? Number(inv.paid_amount) : +(totalNum * 0.5).toFixed(2);
          if (paidNum >= totalNum && totalNum > 0) {
            return (
              <div className="pointer-events-none absolute inset-0 flex items-end justify-start z-10 p-6 sm:p-10">
                <span className="rotate-[-12deg] rounded-lg border-4 border-blue-600 px-6 py-1.5 text-3xl font-black tracking-widest text-blue-600 opacity-30">
                  {isAr ? "مدفوعة بالكامل" : "PAID"}
                </span>
              </div>
            );
          }
          return null;
        })()}
        <div className="invoice-page flex flex-col px-8 pt-8 pb-2 sm:px-12 sm:pt-10" dir="ltr">
          {/* Header: date top-right, logo center, registry top-left */}
          <header className="relative flex flex-col items-center pb-2">
            <div className="absolute top-0 left-0 text-[11px] leading-tight text-black ltr-nums" style={{ direction: "ltr" }}>
              <div>السجل التجاري: <span className="font-semibold">68689</span></div>
              <div>البطاقة الضريبية: <span className="font-semibold">450374114</span></div>
            </div>
            <div className="absolute top-0 right-0 text-[11px] text-black ltr-nums text-right leading-tight">
              <div>{new Date().toLocaleString("en-GB", { hour12: false })}</div>
              {(inv.created_by_email || user?.email) && (
                <div className="text-[10px] text-gray-700">{inv.created_by_email || user?.email}</div>
              )}
            </div>
            <img
              src={logoUrl || steinheimLogo}
              alt="Steinheim"
              className="invoice-logo h-24 w-auto object-contain"
            />
          </header>

          <div className="mt-4 text-center text-[15px] text-black" dir="ltr">
            Invoice <span className="ltr-nums">#{inv.receipt_number ?? inv.invoice_number}</span>
          </div>

          <div className="mt-6 text-[13px] text-black space-y-0.5" dir={isAr ? "rtl" : "ltr"}>
            <div>
              {isAr ? "العميل: " : "Customer: "}
              <span className="font-semibold">{inv.customer_name || "—"}</span>
            </div>
            {inv.customer_phone && (
              <div>
                {isAr ? "الهاتف: " : "Phone: "}
                <span className="ltr-nums font-medium">{inv.customer_phone}</span>
              </div>
            )}
            {inv.customer_address && (
              <div>
                {isAr ? "العنوان: " : "Address: "}
                <span className="font-medium">{inv.customer_address}</span>
              </div>
            )}
          </div>

          <section className="mt-5">
            <table className="w-full border-collapse text-[13px] text-black" dir={isAr ? "rtl" : "ltr"}>
              <thead>
                <tr>
                  <th className="border border-gray-400 px-2 py-2 text-center font-normal">{isAr ? "وصف الصنف" : "Item Description"}</th>
                  <th className="border border-gray-400 px-2 py-2 text-center font-normal w-[12%]">{isAr ? "الكمية" : "Qty"}</th>
                  <th className="border border-gray-400 px-2 py-2 text-center font-normal w-[18%]">{isAr ? "سعر الوحدة" : "Unit Price"}</th>
                  <th className="border border-gray-400 px-2 py-2 text-center font-normal w-[18%]">{isAr ? "الإجمالي" : "Total"}</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const LEGACY = ["رسوم خدمة / Service Fee", "رسوم خدمة", "Service Fee"];
                  const isFee = (it: any) =>
                    !it.product_id &&
                    (LEGACY.includes(it.product_name) || it.product_name === "رسوم شحن") &&
                    Number(it.unit_price) === 250;
                  const nonFee = items.filter((it) => !isFee(it));
                  const feeItems = items.filter((it) => isFee(it));
                  const ordered = [...nonFee, ...feeItems];
                  return ordered.map((it) => (
                    <tr key={it.id}>
                      <td className="border border-gray-400 px-2 py-2 text-center align-middle">
                        <div className="font-medium">{isFee(it) ? "رسوم شحن" : it.product_name}</div>
                        <div className="mt-0.5 flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-[11px] text-gray-700">
                          {it.serial_number && <span className="ltr-nums">SN: {it.serial_number}</span>}
                          {it.color && <span>{isAr ? "اللون" : "Color"}: {it.color}</span>}
                        </div>
                      </td>
                      <td className="border border-gray-400 px-2 py-2 text-center align-middle ltr-nums">{it.quantity}</td>
                      <td className="border border-gray-400 px-2 py-2 text-center align-middle ltr-nums">EGP {Number(it.unit_price).toFixed(2)}</td>
                      <td className="border border-gray-400 px-2 py-2 text-center align-middle ltr-nums">EGP {Number(it.line_total).toFixed(2)}</td>
                    </tr>
                  ));
                })()}
                <tr>
                  <td colSpan={3} className="border border-gray-400 px-2 py-2 text-center">{isAr ? "إجمالي السعر" : "Subtotal"}</td>
                  <td className="border border-gray-400 px-2 py-2 text-center ltr-nums">EGP {Number(inv.subtotal).toFixed(2)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="border border-gray-400 px-2 py-2 text-center">{isAr ? "الخصم" : "Discount"}</td>
                  <td className="border border-gray-400 px-2 py-2 text-center ltr-nums">- EGP {Number(inv.discount).toFixed(2)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="border border-gray-400 px-2 py-2 text-center font-semibold">{isAr ? "الإجمالي بعد الخصم" : "Total after Discount"}</td>
                  <td className="border border-gray-400 px-2 py-2 text-center font-semibold ltr-nums">EGP {Number(inv.total).toFixed(2)}</td>
                </tr>
                {(() => {
                  const totalNum = Number(inv.total);
                  const paidNum = inv.paid_amount != null ? Number(inv.paid_amount) : +(totalNum * 0.5).toFixed(2);
                  const remainingNum = +(totalNum - paidNum).toFixed(2);
                  const paidPct = totalNum > 0 ? Math.round((paidNum / totalNum) * 100) : 0;
                  const remainingPct = totalNum > 0 ? 100 - paidPct : 0;
                  return (
                    <>
                      <tr>
                        <td colSpan={3} className="border border-gray-400 px-2 py-2 text-center">{isAr ? `المبلغ المسدد (${paidPct}%)` : `Paid Amount (${paidPct}%)`}</td>
                        <td className="border border-gray-400 px-2 py-2 text-center ltr-nums">EGP {paidNum.toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td colSpan={3} className="border border-gray-400 px-2 py-2 text-center">{isAr ? `المبلغ المتبقي (${remainingPct}%)` : `Remaining Amount (${remainingPct}%)`}</td>
                        <td className="border border-gray-400 px-2 py-2 text-center ltr-nums">EGP {remainingNum.toFixed(2)}</td>
                      </tr>
                    </>
                  );
                })()}
              </tbody>
            </table>
          </section>

          <section className="mt-6 text-[13px] text-black space-y-3" dir={isAr ? "rtl" : "ltr"}>
            <div>
              <div>{isAr ? "شروط التسليم:" : "Delivery Terms:"}</div>
              <ul className="mt-1 ms-6 list-disc">
                <li>{isAr ? "21 يوم عمل من تاريخ الفاتورة" : "21 working days from invoice date"}</li>
              </ul>
            </div>
            {inv.notes && (
              <div>
                <div>{isAr ? "ملاحظات:" : "Notes:"}</div>
                <p className="mt-1 whitespace-pre-wrap">{inv.notes}</p>
              </div>
            )}
          </section>

          <div className="mt-6 text-[13px] text-black" dir="ltr">
            <div className="font-semibold">{isAr ? "مدير الحسابات" : "Chief Financial Officer"}</div>
            <div>{isAr ? "تامر عبد العليم" : "Tamer Abdel-Alim"}</div>
          </div>

          <div className="mt-4 text-center text-[11px] text-black" dir={isAr ? "rtl" : "ltr"}>
            {isAr ? "شكراً لتعاملكم معنا" : "Thank you for your business"}
          </div>

          <footer className="mt-1 border-t border-gray-300 pt-2 text-center text-[10.5px] leading-relaxed text-black" dir="ltr">
            <div>403 - Fourth Floor - Unit 238 - 5th Settlement Urban Center - Cairo – Egypt</div>
            <div>Tel: (+20) 12 23998124 / Email: inquiries@steinheim-eg.com / Web Site: www.steinheim-eg.com</div>
          </footer>
        </div>
      </div>

      {inv.system_notes && (
        <div className="mx-auto max-w-3xl no-print">
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                {t("system_notes")}
              </h3>
              <div className="flex items-center gap-2">
                <Link to="/invoices-system-notes">
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
                    <Eye className="h-3 w-3" />
                    {lang === "ar" ? "السجل" : "History"}
                  </Button>
                </Link>
                <span className="text-[10px] uppercase tracking-wider text-amber-700/70 dark:text-amber-400/70">
                  {lang === "ar" ? "لا يطبع" : "Not printed"}
                </span>
              </div>
            </div>
            <p className="whitespace-pre-wrap text-sm text-foreground">{inv.system_notes}</p>
            <SystemNotesHistoryInline invoiceId={inv.id} />
          </div>
        </div>
      )}

      <div className="mx-auto max-w-3xl no-print">
        <div className="rounded-2xl border bg-card p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">{isAr ? "محاضر الاستلام" : "Delivery Receipts"}</h3>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${deliveryStatusColor(inv.delivery_status)}`}>
                {deliveryStatusLabel(inv.delivery_status, isAr)}
              </span>
            </div>
            {!isVoided && (
              <Button size="sm" className="gap-1.5" onClick={() => navigate({ to: "/delivery-receipts/new", search: { invoiceId: id } })}>
                <Plus className="h-3.5 w-3.5" />{isAr ? "إنشاء محضر" : "New receipt"}
              </Button>
            )}
          </div>
          <DeliveryReceiptsForInvoice invoiceId={id} />
        </div>
      </div>

      <div className="mx-auto max-w-3xl">
        <InvoiceTimeline invoiceId={id} />
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3">
              <span>{t("print_preview")}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
                  <Languages className="h-3.5 w-3.5" />{lang === "ar" ? "EN" : "ع"}
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => { setPreviewOpen(false); setTimeout(printInvoice, 100); }}>
                  <Printer className="h-3.5 w-3.5" />{t("print")}
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-2xl border bg-card p-6 shadow-sm" dir={dir}>
            <div className="flex items-start justify-between gap-3 pb-5 border-b">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={logoUrl || steinheimLogo}
                  alt=""
                  className="h-12 w-auto max-w-[140px] object-contain shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{settings?.company_name || "Steinheim"}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{settings?.company_phone}</div>
                </div>
              </div>
              <div className="text-end">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{isAr ? "فاتورة" : "Invoice"}</div>
                <div className="text-lg font-semibold tabular-nums">{inv.invoice_number}</div>
                {inv.receipt_number != null && <div className="text-[10px] text-muted-foreground">#{inv.receipt_number}</div>}
              </div>
            </div>
            <div className="mt-4 text-sm">
              <div className="text-muted-foreground text-xs">{t("bill_to")}</div>
              <div className="font-semibold">{inv.customer_name || "—"}</div>
            </div>
            <table className="mt-4 w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="pb-1.5 text-start">{isAr ? "المنتج" : "Item"}</th>
                  <th className="pb-1.5 text-end">{t("quantity")}</th>
                  <th className="pb-1.5 text-end">{t("unit_price")}</th>
                  <th className="pb-1.5 text-end">{t("line_total")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-1.5">{it.product_name}</td>
                    <td className="py-1.5 text-end tabular-nums">{it.quantity}</td>
                    <td className="py-1.5 text-end tabular-nums">{fmtMoney(Number(it.unit_price), settings?.currency || "EGP", lang)}</td>
                    <td className="py-1.5 text-end font-medium tabular-nums">{fmtMoney(Number(it.line_total), settings?.currency || "EGP", lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 ms-auto w-56 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{t("subtotal")}</span><span className="tabular-nums">{fmtMoney(Number(inv.subtotal), settings?.currency || "EGP", lang)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t("discount")}</span><span className="tabular-nums">-{fmtMoney(Number(inv.discount), settings?.currency || "EGP", lang)}</span></div>
              <div className="mt-1 flex justify-between border-t pt-2 text-base font-semibold">
                <span>{t("total")}</span>
                <span className="tabular-nums">{fmtMoney(Number(inv.total), settings?.currency || "EGP", lang)}</span>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SystemNotesHistoryInline({ invoiceId }: { invoiceId: string }) {
  const { lang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Array<{ id: string; old_value: string | null; new_value: string | null; changed_by_email: string | null; changed_at: string }>>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("invoice_system_notes_history" as any)
      .select("id,old_value,new_value,changed_by_email,changed_at")
      .eq("invoice_id", invoiceId)
      .order("changed_at", { ascending: false });
    setRows(((data ?? []) as unknown) as any);
    setLoading(false);
  };

  useEffect(() => { if (open) load(); }, [open, invoiceId]);
  useRealtimeTable("invoice_system_notes_history" as any, () => { if (open) load(); }, [open, invoiceId]);

  return (
    <div className="mt-3 border-t border-amber-500/20 pt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
      >
        {open
          ? (lang === "ar" ? "إخفاء سجل التعديلات" : "Hide change log")
          : (lang === "ar" ? "عرض سجل تعديلات الملاحظة" : "View note change log")}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {loading ? (
            <div className="text-xs text-muted-foreground">{t("loading")}</div>
          ) : rows.length === 0 ? (
            <div className="text-xs text-muted-foreground">{lang === "ar" ? "لا يوجد سجل" : "No history yet"}</div>
          ) : rows.map((h) => (
            <div key={h.id} className="rounded-lg border bg-background/60 p-2 text-xs">
              <div className="mb-1 flex justify-between text-muted-foreground">
                <span className="font-medium text-foreground">{h.changed_by_email || (lang === "ar" ? "مستخدم" : "User")}</span>
                <span className="tabular-nums">{fmtDateTime(h.changed_at, lang)}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded border border-destructive/30 bg-destructive/5 p-1.5">
                  <div className="text-[10px] uppercase text-destructive">{lang === "ar" ? "قبل" : "Before"}</div>
                  <p className="whitespace-pre-wrap">{h.old_value || (lang === "ar" ? "(فارغ)" : "(empty)")}</p>
                </div>
                <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-1.5">
                  <div className="text-[10px] uppercase text-emerald-600 dark:text-emerald-400">{lang === "ar" ? "بعد" : "After"}</div>
                  <p className="whitespace-pre-wrap">{h.new_value || (lang === "ar" ? "(فارغ)" : "(empty)")}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeliveryReceiptsForInvoice({ invoiceId }: { invoiceId: string }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [list, setList] = useState<any[]>([]);
  const load = async () => {
    const { data } = await supabase
      .from("delivery_receipts" as any)
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: false });
    setList((data ?? []) as any[]);
  };
  useEffect(() => { load(); }, [invoiceId]);
  useRealtimeTable("delivery_receipts" as any, (p: any) => {
    if (p.new?.invoice_id === invoiceId || p.old?.invoice_id === invoiceId) load();
  }, [invoiceId]);
  if (list.length === 0) {
    return <div className="text-xs text-muted-foreground">{isAr ? "لا يوجد محاضر بعد" : "No receipts yet"}</div>;
  }
  return (
    <div className="space-y-2">
      {list.map((r) => (
        <Link key={r.id} to="/delivery-receipts/$id" params={{ id: r.id }}
          className="flex items-center justify-between gap-3 rounded-lg border bg-background/40 p-2.5 hover:bg-muted/50">
          <div>
            <div className="font-mono text-sm font-medium">{r.receipt_number}</div>
            <div className="text-[11px] text-muted-foreground">{r.delivered_to_name || "—"} · {fmtDateTime(r.delivered_at, lang)}</div>
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
            r.status === "signed"
              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400"
          }`}>
            {r.status === "signed" ? (isAr ? "موقّع" : "Signed") : (isAr ? "مسودة" : "Draft")}
          </span>
        </Link>
      ))}
    </div>
  );
}
