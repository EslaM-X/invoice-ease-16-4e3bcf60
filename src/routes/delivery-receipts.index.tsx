import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Eye, Trash2, Pencil, ClipboardCheck } from "lucide-react";
import { fmtDate } from "@/lib/utils-money";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useRealtimeTable } from "@/lib/realtime";
import { TableSkeleton } from "@/components/skeletons";

export const Route = createFileRoute("/delivery-receipts/")({
  component: () => <AppShell><ReceiptsList /></AppShell>,
});

function ReceiptsList() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("delivery_receipts" as any)
      .select("*")
      .order("created_at", { ascending: false });
    const list = (data ?? []) as any[];
    setRows(list);
    const ids = Array.from(new Set(list.map((r) => r.invoice_id)));
    if (ids.length > 0) {
      const { data: invs } = await supabase
        .from("invoices")
        .select("id, invoice_number, customer_name, total, delivery_status")
        .in("id", ids);
      const map: Record<string, any> = {};
      (invs ?? []).forEach((i: any) => (map[i.id] = i));
      setInvoices(map);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, [user]);
  useRealtimeTable("delivery_receipts" as any, () => load());

  const filtered = rows.filter((r) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    const inv = invoices[r.invoice_id];
    return (
      r.receipt_number?.toLowerCase().includes(s) ||
      r.delivered_to_name?.toLowerCase().includes(s) ||
      inv?.invoice_number?.toLowerCase().includes(s) ||
      inv?.customer_name?.toLowerCase().includes(s)
    );
  });

  const deleteOne = async (id: string) => {
    const { error } = await supabase.from("delivery_receipts" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(isAr ? "تم الحذف" : "Deleted");
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gradient-gold">
            {isAr ? "محاضر الاستلام" : "Delivery Receipts"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {isAr
              ? "أنشئ محاضر استلام للفواتير. يمكنك التسليم على دفعات وعمل أكثر من محضر لنفس الفاتورة."
              : "Create delivery receipts for invoices. Multiple partial deliveries per invoice are supported."}
          </p>
        </div>
        <Button onClick={() => navigate({ to: "/delivery-receipts/new" })} className="gap-2 shadow-glow">
          <Plus className="h-4 w-4" /> {isAr ? "محضر جديد" : "New receipt"}
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={isAr ? "ابحث برقم المحضر، رقم الفاتورة أو اسم العميل…" : "Search…"}
          className="ps-9"
        />
      </div>

      <div className="surface-elevated overflow-hidden rounded-2xl border bg-card">
        {loading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <ClipboardCheck className="mx-auto mb-2 h-8 w-8 opacity-40" />
            {isAr ? "لا يوجد محاضر بعد" : "No receipts yet"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr>
                  <th className="px-3 py-3 text-start">{isAr ? "رقم المحضر" : "Receipt #"}</th>
                  <th className="px-3 py-3 text-start">{isAr ? "الفاتورة" : "Invoice"}</th>
                  <th className="px-3 py-3 text-start">{isAr ? "المستلم" : "Recipient"}</th>
                  <th className="px-3 py-3 text-start">{isAr ? "التاريخ" : "Date"}</th>
                  <th className="px-3 py-3 text-start">{isAr ? "الحالة" : "Status"}</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => {
                  const inv = invoices[r.invoice_id];
                  return (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-3 py-3 font-mono font-medium">{r.receipt_number}</td>
                      <td className="px-3 py-3">
                        {inv ? (
                          <Link to="/invoices/$id" params={{ id: r.invoice_id }} className="text-primary hover:underline">
                            {inv.invoice_number}
                          </Link>
                        ) : (
                          "—"
                        )}
                        <div className="text-[11px] text-muted-foreground">{inv?.customer_name}</div>
                      </td>
                      <td className="px-3 py-3">{r.delivered_to_name || "—"}</td>
                      <td className="px-3 py-3 text-muted-foreground">{fmtDate(r.delivered_at, lang)}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          r.status === "signed"
                            ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                            : "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400"
                        }`}>
                          {r.status === "signed" ? (isAr ? "موقّع" : "Signed") : (isAr ? "مسودة" : "Draft")}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          <Link to="/delivery-receipts/$id" params={{ id: r.id }}>
                            <Button variant="ghost" size="icon" title={isAr ? "عرض" : "View"}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Link to="/delivery-receipts/$id/edit" params={{ id: r.id }}>
                            <Button variant="ghost" size="icon" title={isAr ? "تعديل" : "Edit"}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Link>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" title={isAr ? "حذف" : "Delete"}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{isAr ? "حذف المحضر" : "Delete receipt"}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {r.receipt_number} — {isAr ? "هل أنت متأكد؟" : "Are you sure?"}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{isAr ? "إلغاء" : "Cancel"}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteOne(r.id)}>
                                  {isAr ? "تأكيد" : "Confirm"}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
