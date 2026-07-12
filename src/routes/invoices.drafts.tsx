import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2, FileText, ArrowRight, FileEdit, Eye } from "lucide-react";
import { fmtDate, fmtMoney } from "@/lib/utils-money";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useRealtimeTable } from "@/lib/realtime";
import { TableSkeleton } from "@/components/skeletons";

export const Route = createFileRoute("/invoices/drafts")({
  component: () => (
    <AppShell>
      <DraftsPage />
    </AppShell>
  ),
});

function DraftsPage() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deliveryDaysFilter, setDeliveryDaysFilter] = useState("all");
  const navigate = useNavigate();

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("invoices")
      .select("*")
      .eq("status", "draft")
      .order("created_at", { ascending: false });
    setList(data ?? []);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, [user]);
  useRealtimeTable("invoices", () => {
    load();
  });

  const handleRpcError = (msg: string) => {
    if (msg.includes("OUT_OF_STOCK")) {
      const name = msg.split("OUT_OF_STOCK:")[1]?.split("\n")[0]?.trim() ?? "";
      toast.error(`${t("not_enough_stock")}${name ? `: ${name}` : ""}`);
    } else {
      toast.error(msg || t("error_occurred"));
    }
  };

  const convertToReal = async (draftId: string) => {
    if (!user) return;
    setBusyId(draftId);
    try {
      const { data: inv } = await supabase
        .from("invoices")
        .select("*")
        .eq("id", draftId)
        .single();
      const { data: items } = await supabase
        .from("invoice_items")
        .select("*")
        .eq("invoice_id", draftId);
      if (!inv) return toast.error(t("error_occurred"));
      const payload = (items ?? []).map((it: any) => ({
        product_id: it.product_id,
        product_name: it.product_name,
        serial_number: it.serial_number,
        color: it.color,
        quantity: it.quantity,
        unit_price: Number(it.unit_price),
        discount: Number(it.discount),
      }));
      if (payload.length === 0) return toast.error(t("no_items"));
      const { data: newId, error } = await supabase.rpc("create_invoice", {
        _customer_id: (inv as any).customer_id,
        _discount: Number((inv as any).discount ?? 0),
        _notes: (inv as any).notes ?? null,
        _language: (inv as any).language ?? lang,
        _items: payload as any,
        _paid_amount: (inv as any).paid_amount ?? null,
        _system_notes: (inv as any).system_notes ?? null,
      } as any);
      if (error || !newId) return handleRpcError(error?.message ?? "");
      // Delete the draft (no stock to restore)
      await supabase.from("invoice_items").delete().eq("invoice_id", draftId);
      await supabase.from("invoices").delete().eq("id", draftId);
      toast.success(lang === "ar" ? "تم تحويل المسودة لفاتورة حقيقية" : "Draft converted to real invoice");
      navigate({ to: "/invoices/$id", params: { id: newId as string } });
    } finally {
      setBusyId(null);
    }
  };

  const deleteDraft = async (id: string) => {
    setBusyId(id);
    try {
      await supabase.from("invoice_items").delete().eq("invoice_id", id);
      const { error } = await supabase.from("invoices").delete().eq("id", id);
      if (error) return toast.error(error.message);
      toast.success(lang === "ar" ? "تم حذف المسودة" : "Draft deleted");
      load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gradient-gold">
            {lang === "ar" ? "مسودات الفواتير" : "Invoice drafts"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {lang === "ar"
              ? "المسودات لا تُخصم من المخزون ولا تظهر في التقارير. حوّلها لفاتورة حقيقية لتفعيلها."
              : "Drafts don't affect stock and are excluded from reports. Convert to real invoices to activate them."}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/invoices">
            <Button variant="outline" className="gap-2 rounded-full">
              <FileText className="h-4 w-4" />
              {lang === "ar" ? "كل الفواتير" : "All invoices"}
            </Button>
          </Link>
          <Link to="/invoices/new" search={{ draft: true }}>
            <Button className="gap-2 shadow-glow">
              <Plus className="h-4 w-4" />
              {lang === "ar" ? "مسودة جديدة" : "New draft"}
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">{lang === "ar" ? "شروط التسليم:" : "Delivery terms:"}</label>
        <select value={deliveryDaysFilter} onChange={(e) => setDeliveryDaysFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">{lang === "ar" ? "الكل" : "All"}</option>
          {[7, 21, 30, 45, 60].map((d) => (
            <option key={d} value={String(d)}>{lang === "ar" ? `${d} يوم` : `${d} days`}</option>
          ))}
        </select>
      </div>

      <div className="surface-elevated overflow-hidden rounded-2xl border bg-card">
        {(() => {
          const filtered = deliveryDaysFilter === "all"
            ? list
            : list.filter((i) => String(i.delivery_days ?? 21) === deliveryDaysFilter);
          return loading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <FileEdit className="mx-auto mb-3 h-10 w-10 opacity-40" />
            {lang === "ar" ? "لا توجد مسودات حالياً" : "No drafts yet"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">
                    {lang === "ar" ? "المرجع" : "Reference"}
                  </th>
                  <th className="px-4 py-3 text-start font-medium">{t("customer")}</th>
                  <th className="px-4 py-3 text-start font-medium hidden sm:table-cell">{t("date")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("total")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((i) => (
                  <tr key={i.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:text-amber-400">
                        {lang === "ar" ? "مسودة" : "Draft"}
                      </span>
                      <span className="ms-2 text-xs text-muted-foreground tabular-nums">{i.invoice_number}</span>
                    </td>
                    <td className="px-4 py-3">{i.customer_name || "—"}</td>
                    <td className="px-4 py-3 hidden sm:table-cell tabular-nums">
                      {fmtDate(i.created_at, lang)}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-semibold">
                      {fmtMoney(Number(i.total ?? 0), "EGP", lang)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Link to="/invoices/$id" params={{ id: i.id }}>
                          <Button variant="ghost" size="sm" className="gap-1">
                            <Eye className="h-4 w-4" />
                            {lang === "ar" ? "عرض / PDF" : "View / PDF"}
                          </Button>
                        </Link>
                        <Link to="/invoices/$id/edit" params={{ id: i.id }}>
                          <Button variant="ghost" size="sm" className="gap-1">
                            <Pencil className="h-4 w-4" />
                            {t("edit")}
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          variant="default"
                          className="gap-1 bg-emerald-600 hover:bg-emerald-700"
                          disabled={busyId === i.id}
                          onClick={() => convertToReal(i.id)}
                        >
                          <ArrowRight className="h-4 w-4" />
                          {lang === "ar" ? "تحويل لفاتورة" : "Convert"}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {lang === "ar" ? "حذف المسودة؟" : "Delete draft?"}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {lang === "ar"
                                  ? "سيتم حذف المسودة نهائياً. لا تأثير على المخزون."
                                  : "The draft will be permanently deleted. No stock impact."}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("cancel") || "Cancel"}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteDraft(i.id)}>
                                {t("delete") || "Delete"}
                              </AlertDialogAction>
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
        );
        })()}
      </div>
    </div>
  );
}
