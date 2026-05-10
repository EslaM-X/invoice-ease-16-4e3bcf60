import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft, Pencil, Plus } from "lucide-react";
import { fmtDateTime } from "@/lib/utils-money";
import steinheimLogo from "@/assets/steinheim-logo.png";
import { getSettings, type Settings } from "@/lib/data";

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
  const [invoice, setInvoice] = useState<any>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

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
      }
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

  if (!r) return <div className="text-muted-foreground">{isAr ? "جاري التحميل…" : "Loading…"}</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <Link to="/delivery-receipts">
          <Button variant="ghost" className="gap-2 rounded-full"><ArrowLeft className="h-4 w-4" />{isAr ? "محاضر الاستلام" : "Receipts"}</Button>
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2 rounded-full" onClick={() => navigate({ to: "/delivery-receipts/$id/edit", params: { id } })}>
            <Pencil className="h-4 w-4" />{isAr ? "تعديل" : "Edit"}
          </Button>
          {invoice && (
            <Button variant="outline" className="gap-2 rounded-full" onClick={() => navigate({ to: "/delivery-receipts/new", search: { invoiceId: invoice.id } })}>
              <Plus className="h-4 w-4" />{isAr ? "محضر آخر لنفس الفاتورة" : "Another receipt"}
            </Button>
          )}
          <Button onClick={() => window.print()} className="gap-2 rounded-full px-5 shadow-glow">
            <Printer className="h-4 w-4" />{isAr ? "طباعة" : "Print"} / PDF
          </Button>
        </div>
      </div>

      <div className="print-area mx-auto max-w-3xl rounded-3xl border border-border/60 bg-white text-black shadow-elegant print:rounded-none print:border-0 print:shadow-none">
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
            <img src={logoUrl || steinheimLogo} alt="Steinheim" className="invoice-logo h-24 w-auto object-contain" style={{ filter: "brightness(0)" }} />
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
              <div className="font-semibold">{r.delivered_to_name || invoice?.customer_name || "—"}</div>
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
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="border border-gray-400 px-2 py-2 text-center align-middle ltr-nums text-[11px]">{it.serial_number || "—"}</td>
                    <td className="border border-gray-400 px-2 py-2 align-middle">
                      <div className="font-medium">{it.product_name}</div>
                      {it.color && <div className="text-[11px] text-gray-700">{isAr ? "اللون:" : "Color:"} {it.color}</div>}
                    </td>
                    <td className="border border-gray-400 px-2 py-2 text-center align-middle ltr-nums font-semibold">{it.quantity}</td>
                    <td className="border border-gray-400 px-2 py-2 align-middle text-[11px]">{it.note || ""}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={4} className="border border-gray-400 px-2 py-4 text-center text-gray-500">—</td></tr>
                )}
              </tbody>
            </table>
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

          <section className="mt-8 grid grid-cols-3 gap-4 text-[12px]" dir={isAr ? "rtl" : "ltr"}>
            <SignatureBlock title={isAr ? "توقيع المستلم" : "Recipient"} name={r.delivered_to_name} sig={r.signature_customer} />
            <SignatureBlock title={isAr ? "مدير الحسابات" : "Accountant"} name={r.accountant_name} sig={r.signature_accountant} />
            <SignatureBlock title={isAr ? "المدير العام" : "Manager"} name={r.manager_name} sig={r.signature_manager} />
          </section>

          <footer className="mt-6 border-t border-gray-300 pt-2 text-center text-[10.5px] leading-relaxed" dir="ltr">
            <div>403 - Fourth Floor - Unit 238 - 5th Settlement Urban Center - Cairo – Egypt</div>
            <div>Tel: (+20) 12 23998124 / Email: inquiries@steinheim-eg.com / Web Site: www.steinheim-eg.com</div>
          </footer>
        </div>
      </div>
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
