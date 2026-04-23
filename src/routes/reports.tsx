import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDate, fmtMoney } from "@/lib/utils-money";
import { Download, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/reports")({ component: () => <AppShell><Reports /></AppShell> });

function Reports() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customers, setCustomers] = useState<any[]>([]);
  const [list, setList] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    supabase.from("customers").select("id,name").eq("user_id", user.id).then(({ data }) => setCustomers(data ?? []));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      let q = supabase.from("invoices").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      if (from) q = q.gte("created_at", from);
      if (to) q = q.lte("created_at", to + "T23:59:59");
      if (customerId) q = q.eq("customer_id", customerId);
      const { data } = await q;
      setList(data ?? []);
    })();
  }, [user, from, to, customerId]);

  const totalSales = list.reduce((s, i) => s + Number(i.total ?? 0), 0);

  const exportExcel = () => {
    const rows = list.map((i) => ({
      [t("invoice_number")]: i.invoice_number,
      [t("date")]: fmtDate(i.created_at, lang),
      [t("customer")]: i.customer_name ?? "",
      [t("subtotal")]: Number(i.subtotal),
      [t("discount")]: Number(i.discount),
      [t("total")]: Number(i.total),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Invoices");
    XLSX.writeFile(wb, "invoices.xlsx");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("reports")}</h1>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => window.print()}><Download className="h-4 w-4" />{t("export_pdf")}</Button>
          <Button className="gap-2" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4" />{t("export_excel")}</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">— {t("all")} —</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="text-sm text-muted-foreground">{t("total_sales")}</div>
          <div className="mt-1 text-2xl font-bold">{fmtMoney(totalSales, "SAR", lang)}</div>
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="text-sm text-muted-foreground">{t("total_invoices")}</div>
          <div className="mt-1 text-2xl font-bold">{list.length}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card print-area">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{t("invoice_number")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("date")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("customer")}</th>
                <th className="px-4 py-3 text-end font-medium">{t("total")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-3 font-medium">{i.invoice_number}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDate(i.created_at, lang)}</td>
                  <td className="px-4 py-3">{i.customer_name || "—"}</td>
                  <td className="px-4 py-3 text-end font-semibold">{fmtMoney(Number(i.total), "SAR", lang)}</td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">{t("no_data")}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
