import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft, Languages, Pencil, Ban } from "lucide-react";
import { fmtDate, fmtMoney } from "@/lib/utils-money";
import type { Settings } from "@/lib/data";
import { getSettings } from "@/lib/data";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";

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
          <Button onClick={() => window.print()} className="gap-2 rounded-full px-5 shadow-glow"><Printer className="h-4 w-4" />{t("print")} / PDF</Button>
        </div>
      </div>

      <div className="print-area mx-auto max-w-3xl overflow-hidden rounded-3xl border border-border/60 bg-card shadow-elegant relative" dir={dir}>
        {isVoided && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rotate-[-20deg] rounded-lg border-4 border-destructive px-8 py-2 text-5xl font-black tracking-widest text-destructive opacity-30">
              {isAr ? "ملغاة" : "VOIDED"}
            </span>
          </div>
        )}
        <div className="px-10 pt-10 pb-8">
          <header className="flex items-start justify-between gap-4 pb-8">
            <div className="flex items-center gap-3">
              {logoUrl ? <img src={logoUrl} alt="Logo" className="h-14 w-14 rounded-2xl object-contain" /> : <div className="h-14 w-14 rounded-2xl gradient-primary shadow-glow" />}
              <div>
                <div className="text-base font-semibold tracking-tight">{settings?.company_name || t("company_name")}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{settings?.company_address}</div>
                <div className="text-xs text-muted-foreground">{settings?.company_phone} {settings?.company_email ? `· ${settings.company_email}` : ""}</div>
              </div>
            </div>
            <div className="text-end">
              <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">{isAr ? "فاتورة" : "Invoice"}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{inv.invoice_number}</div>
              <div className="mt-1 text-xs text-muted-foreground">{fmtDate(inv.created_at, lang)}</div>
            </div>
          </header>

          <div className="h-px bg-border/60" />

          <section className="mt-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t("bill_to")}</div>
            <div className="mt-1.5 text-base font-semibold tracking-tight">{inv.customer_name || "—"}</div>
            <div className="text-sm text-muted-foreground">{inv.customer_phone}</div>
            <div className="text-sm text-muted-foreground">{inv.customer_address}</div>
          </section>

          <section className="mt-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="pb-2.5 text-start font-semibold">{isAr ? "المنتج" : "Item"}</th>
                  <th className="pb-2.5 text-start font-semibold">{t("serial_number")}</th>
                  <th className="pb-2.5 text-start font-semibold">{t("color")}</th>
                  <th className="pb-2.5 text-end font-semibold">{t("quantity")}</th>
                  <th className="pb-2.5 text-end font-semibold">{t("unit_price")}</th>
                  <th className="pb-2.5 text-end font-semibold">{t("line_total")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-3 font-medium">{it.product_name}</td>
                    <td className="py-3 text-muted-foreground">{it.serial_number || "—"}</td>
                    <td className="py-3 text-muted-foreground">{it.color || "—"}</td>
                    <td className="py-3 text-end tabular-nums">{it.quantity}</td>
                    <td className="py-3 text-end tabular-nums">{fmtMoney(Number(it.unit_price), settings?.currency || "SAR", lang)}</td>
                    <td className="py-3 text-end font-semibold tabular-nums">{fmtMoney(Number(it.line_total), settings?.currency || "SAR", lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="mt-6 ms-auto w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">{t("subtotal")}</span><span className="tabular-nums">{fmtMoney(Number(inv.subtotal), settings?.currency || "SAR", lang)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{t("discount")}</span><span className="tabular-nums">-{fmtMoney(Number(inv.discount), settings?.currency || "SAR", lang)}</span></div>
            <div className="mt-2 flex justify-between border-t border-border/60 pt-3 text-lg font-semibold tracking-tight">
              <span>{t("total")}</span>
              <span className="tabular-nums">{fmtMoney(Number(inv.total), settings?.currency || "SAR", lang)}</span>
            </div>
          </section>

          {inv.notes && (
            <section className="mt-8 rounded-2xl bg-muted/40 p-4 text-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t("notes")}</div>
              <p className="mt-1.5 whitespace-pre-wrap">{inv.notes}</p>
            </section>
          )}

          <footer className="mt-8 grid gap-4 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:grid-cols-2">
            {settings?.payment_terms && <div><div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground">{t("payment_terms")}</div>{settings.payment_terms}</div>}
            {settings?.delivery_terms && <div><div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground">{t("delivery_terms")}</div>{settings.delivery_terms}</div>}
          </footer>

          {(settings?.social_facebook || settings?.social_instagram || settings?.social_twitter || settings?.social_website) && (
            <div className="mt-5 flex flex-wrap gap-4 border-t border-border/60 pt-4 text-xs text-muted-foreground">
              {settings?.social_website && <span>🌐 {settings.social_website}</span>}
              {settings?.social_facebook && <span>📘 {settings.social_facebook}</span>}
              {settings?.social_instagram && <span>📸 {settings.social_instagram}</span>}
              {settings?.social_twitter && <span>𝕏 {settings.social_twitter}</span>}
            </div>
          )}

          <div className="mt-8 text-center text-xs font-medium tracking-wide text-muted-foreground">{t("thank_you")}</div>
        </div>
      </div>
    </div>
  );
}
