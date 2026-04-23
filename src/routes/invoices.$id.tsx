import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft, Languages } from "lucide-react";
import { fmtDate, fmtMoney } from "@/lib/utils-money";
import type { Settings } from "@/lib/data";
import { getSettings } from "@/lib/data";

export const Route = createFileRoute("/invoices/$id")({ component: () => <AppShell><InvoiceView /></AppShell> });

function InvoiceView() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const { t, lang, setLang, dir } = useI18n();
  const [inv, setInv] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
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
    })();
  }, [id, user]);

  if (!inv) return <div className="text-muted-foreground">{t("loading")}</div>;

  const isAr = lang === "ar";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <Link to="/invoices"><Button variant="ghost" className="gap-2"><ArrowLeft className="h-4 w-4" />{t("invoices")}</Button></Link>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
            <Languages className="h-4 w-4" />{lang === "ar" ? "English" : "العربية"}
          </Button>
          <Button onClick={() => window.print()} className="gap-2 shadow-glow"><Printer className="h-4 w-4" />{t("print")} / PDF</Button>
        </div>
      </div>

      <div className="print-area mx-auto max-w-3xl rounded-2xl border bg-card p-8 shadow-sm" dir={dir}>
        <header className="flex items-start justify-between gap-4 border-b pb-6">
          <div className="flex items-center gap-3">
            {logoUrl ? <img src={logoUrl} alt="Logo" className="h-16 w-16 rounded-lg object-contain" /> : <div className="h-16 w-16 rounded-lg gradient-primary" />}
            <div>
              <div className="text-xl font-bold">{settings?.company_name || t("company_name")}</div>
              <div className="text-xs text-muted-foreground">{settings?.company_address}</div>
              <div className="text-xs text-muted-foreground">{settings?.company_phone} {settings?.company_email ? `· ${settings.company_email}` : ""}</div>
            </div>
          </div>
          <div className="text-end">
            <div className="text-2xl font-bold">{isAr ? "فاتورة" : "INVOICE"}</div>
            <div className="text-sm text-muted-foreground">{inv.invoice_number}</div>
            <div className="text-xs text-muted-foreground">{fmtDate(inv.created_at, lang)}</div>
          </div>
        </header>

        <section className="mt-6">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("bill_to")}</div>
          <div className="mt-1 font-semibold">{inv.customer_name || "—"}</div>
          <div className="text-sm text-muted-foreground">{inv.customer_phone}</div>
          <div className="text-sm text-muted-foreground">{inv.customer_address}</div>
        </section>

        <section className="mt-6 overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{isAr ? "المنتج" : "Item"}</th>
                <th className="px-3 py-2 text-start font-medium">{t("serial_number")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("color")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("quantity")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("unit_price")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("line_total")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="px-3 py-2 font-medium">{it.product_name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{it.serial_number || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{it.color || "—"}</td>
                  <td className="px-3 py-2 text-end">{it.quantity}</td>
                  <td className="px-3 py-2 text-end">{fmtMoney(Number(it.unit_price), settings?.currency || "SAR", lang)}</td>
                  <td className="px-3 py-2 text-end font-semibold">{fmtMoney(Number(it.line_total), settings?.currency || "SAR", lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-5 ms-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">{t("subtotal")}</span><span>{fmtMoney(Number(inv.subtotal), settings?.currency || "SAR", lang)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">{t("discount")}</span><span>-{fmtMoney(Number(inv.discount), settings?.currency || "SAR", lang)}</span></div>
          <div className="flex justify-between border-t pt-2 text-lg font-bold"><span>{t("total")}</span><span>{fmtMoney(Number(inv.total), settings?.currency || "SAR", lang)}</span></div>
        </section>

        {inv.notes && (
          <section className="mt-6 rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="font-semibold">{t("notes")}</div>
            <p className="text-muted-foreground whitespace-pre-wrap">{inv.notes}</p>
          </section>
        )}

        <footer className="mt-6 grid gap-3 border-t pt-5 text-xs text-muted-foreground sm:grid-cols-2">
          {settings?.payment_terms && <div><div className="mb-1 font-semibold text-foreground">{t("payment_terms")}</div>{settings.payment_terms}</div>}
          {settings?.delivery_terms && <div><div className="mb-1 font-semibold text-foreground">{t("delivery_terms")}</div>{settings.delivery_terms}</div>}
        </footer>

        {(settings?.social_facebook || settings?.social_instagram || settings?.social_twitter || settings?.social_website) && (
          <div className="mt-4 flex flex-wrap gap-3 border-t pt-3 text-xs text-muted-foreground">
            {settings?.social_website && <span>🌐 {settings.social_website}</span>}
            {settings?.social_facebook && <span>📘 {settings.social_facebook}</span>}
            {settings?.social_instagram && <span>📸 {settings.social_instagram}</span>}
            {settings?.social_twitter && <span>𝕏 {settings.social_twitter}</span>}
          </div>
        )}

        <div className="mt-5 text-center text-sm font-medium text-muted-foreground">{t("thank_you")}</div>
      </div>
    </div>
  );
}
