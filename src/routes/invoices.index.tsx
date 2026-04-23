import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Eye, Copy, Trash2 } from "lucide-react";
import { fmtDate, fmtMoney } from "@/lib/utils-money";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { nextInvoiceNumber } from "@/lib/data";

export const Route = createFileRoute("/invoices/")({ component: () => <AppShell><InvoicesList /></AppShell> });

function InvoicesList() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [list, setList] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const navigate = useNavigate();

  const load = async () => {
    if (!user) return;
    let query = supabase.from("invoices").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to + "T23:59:59");
    const { data } = await query;
    setList(data ?? []);
  };
  useEffect(() => { load(); }, [user, from, to]);

  const filtered = list.filter((i) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (i.invoice_number ?? "").toLowerCase().includes(s) || (i.customer_name ?? "").toLowerCase().includes(s);
  });

  const remove = async (id: string) => {
    const { error } = await supabase.from("invoices").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("invoice_deleted"));
    load();
  };

  const duplicate = async (id: string) => {
    if (!user) return;
    const { data: inv } = await supabase.from("invoices").select("*").eq("id", id).single();
    const { data: items } = await supabase.from("invoice_items").select("*").eq("invoice_id", id);
    if (!inv) return;
    const number = await nextInvoiceNumber(user.id);
    const { data: nInv, error } = await supabase.from("invoices").insert({
      user_id: user.id,
      invoice_number: number,
      customer_id: inv.customer_id, customer_name: inv.customer_name,
      customer_phone: inv.customer_phone, customer_address: inv.customer_address,
      subtotal: inv.subtotal, discount: inv.discount, total: inv.total,
      notes: inv.notes, language: inv.language, status: "completed",
    }).select("id").single();
    if (error || !nInv) return toast.error(error?.message ?? t("error_occurred"));
    if (items?.length) {
      await supabase.from("invoice_items").insert(items.map((it: any) => ({
        invoice_id: nInv.id,
        product_id: it.product_id, product_name: it.product_name,
        serial_number: it.serial_number, color: it.color,
        quantity: it.quantity, unit_price: it.unit_price, discount: it.discount, line_total: it.line_total,
      })));
    }
    toast.success(t("saved"));
    navigate({ to: "/invoices/$id", params: { id: nInv.id } });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("invoices")}</h1>
        <Link to="/invoices/new"><Button className="gap-2 shadow-glow"><Plus className="h-4 w-4" />{t("new_invoice")}</Button></Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="relative sm:col-span-1">
          <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="ps-9" />
        </div>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} placeholder={t("from")} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} placeholder={t("to")} />
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{t("no_data")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{t("invoice_number")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("customer")}</th>
                  <th className="px-4 py-3 text-start font-medium hidden sm:table-cell">{t("date")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("total")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((i) => (
                  <tr key={i.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{i.invoice_number}</td>
                    <td className="px-4 py-3">{i.customer_name || "—"}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">{fmtDate(i.created_at, lang)}</td>
                    <td className="px-4 py-3 font-semibold">{fmtMoney(Number(i.total), "SAR", lang)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Link to="/invoices/$id" params={{ id: i.id }}><Button variant="ghost" size="icon"><Eye className="h-4 w-4" /></Button></Link>
                        <Button variant="ghost" size="icon" onClick={() => duplicate(i.id)}><Copy className="h-4 w-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("confirm_delete")}</AlertDialogTitle>
                              <AlertDialogDescription>{i.invoice_number}</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => remove(i.id)}>{t("confirm")}</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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
