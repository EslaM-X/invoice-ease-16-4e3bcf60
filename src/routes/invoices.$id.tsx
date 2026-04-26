import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft, Languages, Pencil, Ban, Eye } from "lucide-react";
import { fmtDateTime, fmtMoney } from "@/lib/utils-money";
import type { Settings } from "@/lib/data";
import { getSettings } from "@/lib/data";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import steinheimLogo from "@/assets/steinheim-logo.png";
import { InvoiceTimeline } from "@/components/invoice-timeline";
import { useRealtimeTable } from "@/lib/realtime";

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

  if (!inv) return <div className="text-muted-foreground">{t("loading")}</div>;

  const isAr = lang === "ar";
  const isVoided = inv.status === "voided";

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
          <Button onClick={() => window.print()} className="gap-2 rounded-full px-5 shadow-glow"><Printer className="h-4 w-4" />{t("print")} / PDF</Button>
        </div>
      </div>

      <div className="print-area mx-auto max-w-3xl overflow-hidden rounded-3xl border border-border/60 bg-card shadow-elegant relative" dir={dir}>
        {isVoided && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
            <span className="rotate-[-20deg] rounded-lg border-4 border-destructive px-8 py-2 text-5xl font-black tracking-widest text-destructive opacity-30">
              {isAr ? "ملغاة" : "VOIDED"}
            </span>
          </div>
        )}
        <div className="invoice-page flex flex-col px-8 pt-8 pb-6 sm:px-12 sm:pt-10" dir="ltr">
          {/* Header: date top-right, logo center, registry top-left */}
          <header className="relative flex flex-col items-center pb-2">
            <div className="absolute top-0 left-0 text-[11px] leading-tight text-black ltr-nums" style={{ direction: "ltr" }}>
              <div>السجل التجاري: <span className="font-semibold">68689</span></div>
              <div>البطاقة الضريبية: <span className="font-semibold">450374114</span></div>
            </div>
            <div className="absolute top-0 right-0 text-[11px] text-black ltr-nums">
              {new Date(inv.created_at).toLocaleDateString("en-GB")}
            </div>
            <img
              src={logoUrl || steinheimLogo}
              alt="Steinheim"
              className="invoice-logo h-24 w-auto object-contain"
            />
          </header>

          <div className="mt-4 text-center text-[15px] text-black" dir={isAr ? "rtl" : "ltr"}>
            {isAr ? "فاتورة تجارية" : "Commercial Invoice"} <span className="ltr-nums">#{inv.receipt_number ?? inv.invoice_number}</span>
          </div>

          <div className="mt-6 text-[14px] text-black" dir={isAr ? "rtl" : "ltr"}>
            {isAr ? "صادرة إلى: " : "Issued to: "}
            <span className="font-medium">{inv.customer_name || "—"}</span>
          </div>

          <section className="mt-5">
            <table className="w-full border-collapse text-[13px] text-black" dir={isAr ? "rtl" : "ltr"}>
              <thead>
                <tr>
                  <th className="border border-gray-400 px-2 py-2 text-center font-normal">{isAr ? "وصف الصنف" : "Item Description"}</th>
                  <th className="border border-gray-400 px-2 py-2 text-center font-normal w-[14%]">{isAr ? "الكمية" : "Quantity"}</th>
                  <th className="border border-gray-400 px-2 py-2 text-center font-normal w-[18%]">{isAr ? "السعر" : "Price"}</th>
                  <th className="border border-gray-400 px-2 py-2 text-center font-normal w-[20%]">{isAr ? "الإجمالي" : "Total Price"}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="border border-gray-400 px-2 py-3 text-center align-middle">
                      <div>{it.product_name}</div>
                      {it.serial_number && <div className="text-[12px]">{it.serial_number}</div>}
                    </td>
                    <td className="border border-gray-400 px-2 py-3 text-center align-middle ltr-nums">{it.quantity}</td>
                    <td className="border border-gray-400 px-2 py-3 text-center align-middle ltr-nums">{Number(it.unit_price).toFixed(2)}$</td>
                    <td className="border border-gray-400 px-2 py-3 text-center align-middle ltr-nums">{Number(it.line_total).toFixed(2)}$</td>
                  </tr>
                ))}
                {Number(inv.discount) > 0 && (
                  <tr>
                    <td colSpan={3} className="border border-gray-400 px-2 py-2 text-center">{isAr ? "الخصم" : "Discount"}</td>
                    <td className="border border-gray-400 px-2 py-2 text-center ltr-nums">-{Number(inv.discount).toFixed(2)}$</td>
                  </tr>
                )}
                <tr>
                  <td colSpan={3} className="border border-gray-400 px-2 py-2 text-center">{isAr ? "الإجمالي" : "Total"}</td>
                  <td className="border border-gray-400 px-2 py-2 text-center font-medium ltr-nums">{Number(inv.total).toFixed(2)} $</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="mt-6 text-[13px] text-black space-y-3" dir={isAr ? "rtl" : "ltr"}>
            <div>
              <div>{isAr ? "شروط الدفع:" : "Payment Terms:"}</div>
              <ul className="mt-1 ms-6 list-disc">
                <li>{isAr ? "عينات مجانية." : "Free of Charge Samples."}</li>
                <li>{isAr ? "الأصناف غير خاضعة لضريبة القيمة المضافة." : "Items are not subject to VAT."}</li>
              </ul>
            </div>
            <div>
              <div>{isAr ? "شروط التسليم:" : "Delivery Terms:"}</div>
              <ul className="mt-1 ms-6 list-disc">
                <li>{isAr ? "تسليم فوري." : "Immediate Delivery."}</li>
              </ul>
            </div>
            {inv.notes && (
              <div>
                <div>{isAr ? "ملاحظات:" : "Notes:"}</div>
                <p className="mt-1 whitespace-pre-wrap">{inv.notes}</p>
              </div>
            )}
          </section>

          {/* Spacer pushes signature + footer to bottom of page */}
          <div className="grow min-h-[40px]" />

          <div className="mt-8 text-[13px] text-black" dir="ltr">
            <div className="font-semibold">{isAr ? "مدير الحسابات" : "Chief Financial Officer"}</div>
            <div>{isAr ? "تامر عبد العليم" : "Tamer Abdel-Alim"}</div>
          </div>

          <div className="mt-6 text-center text-[11px] text-muted-foreground" dir={isAr ? "rtl" : "ltr"}>
            {isAr ? "شكراً لتعاملكم معنا" : "Thank you for your business"}
          </div>

          <footer className="mt-4 border-t border-gray-300 pt-2 text-center text-[10.5px] leading-relaxed text-black" dir="ltr">
            <div>403 - Fourth Floor - Unit 238 - 5th Settlement Urban Center - Cairo – Egypt</div>
            <div>Tel: (+20) 12 23998124 / Email: inquiries@steinheim-eg.com / Web Site: www.steinheim-eg.com</div>
          </footer>
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
                <Button size="sm" className="gap-1.5" onClick={() => { setPreviewOpen(false); setTimeout(() => window.print(), 100); }}>
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
