import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Eye, Copy, Ban, Trash2, FileSpreadsheet, FileText, Download, Pencil } from "lucide-react";
import { fmtDate, fmtMoney } from "@/lib/utils-money";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { exportInvoicesToCSV, exportInvoicesToExcel, exportInvoicesBatchPDF, type InvoiceRow } from "@/lib/invoice-export";
import { exportInvoicesOrdersStyle } from "@/lib/orders-export";
import { Checkbox } from "@/components/ui/checkbox";
import { useRealtimeTable } from "@/lib/realtime";
import { AuthorBadge } from "@/components/author-badge";
import { TableSkeleton } from "@/components/skeletons";

export const Route = createFileRoute("/invoices/")({ component: () => <AppShell><InvoicesList /></AppShell> });

function InvoicesList() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "voided">("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "paid" | "partial" | "unpaid">("all");
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "total_desc" | "total_asc">("date_desc");
  const navigate = useNavigate();

  const load = async () => {
    if (!user) return;
    let query = supabase.from("invoices").select("*").order("created_at", { ascending: false });
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to + "T23:59:59");
    const { data } = await query;
    setList(data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [user, from, to]);
  useRealtimeTable("invoices", () => { load(); });

  const filtered = list
    .filter((i) => {
      if (statusFilter !== "all" && (i.status ?? "completed") !== statusFilter) return false;
      if (paymentFilter !== "all") {
        const total = Number(i.total ?? 0);
        const paid = Number(i.paid_amount ?? 0);
        const ratio = total > 0 ? paid / total : 0;
        if (paymentFilter === "paid" && ratio < 0.999) return false;
        if (paymentFilter === "unpaid" && paid > 0.001) return false;
        if (paymentFilter === "partial" && (paid <= 0.001 || ratio >= 0.999)) return false;
      }
      const s = q.trim().toLowerCase();
      if (!s) return true;
      return (
        (i.invoice_number ?? "").toLowerCase().includes(s) ||
        String(i.receipt_number ?? "").includes(s) ||
        (i.customer_name ?? "").toLowerCase().includes(s) ||
        (i.customer_phone ?? "").toLowerCase().includes(s)
      );
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "date_asc": return +new Date(a.created_at) - +new Date(b.created_at);
        case "total_desc": return Number(b.total) - Number(a.total);
        case "total_asc": return Number(a.total) - Number(b.total);
        default: return +new Date(b.created_at) - +new Date(a.created_at);
      }
    });

  const handleRpcError = (msg: string) => {
    if (msg.includes("OUT_OF_STOCK")) {
      const name = msg.split("OUT_OF_STOCK:")[1]?.split("\n")[0]?.trim() ?? "";
      toast.error(`${t("not_enough_stock")}${name ? `: ${name}` : ""}`);
    } else {
      toast.error(msg || t("error_occurred"));
    }
  };

  const voidInvoice = async (id: string) => {
    const { error } = await supabase.rpc("void_invoice", { _invoice_id: id } as any);
    if (error) return toast.error(error.message);
    toast.success(t("invoice_voided"));
    load();
  };

  const deleteInvoice = async (id: string) => {
    const { error } = await supabase.rpc("delete_invoice", { _invoice_id: id } as any);
    if (error) return toast.error(error.message);
    toast.success(t("invoice_deleted"));
    load();
  };

  const duplicate = async (id: string) => {
    if (!user) return;
    const { data: inv } = await supabase.from("invoices").select("*").eq("id", id).single();
    const { data: items } = await supabase.from("invoice_items").select("*").eq("invoice_id", id);
    if (!inv) return;
    const payload = (items ?? []).map((it: any) => ({
      product_id: it.product_id,
      product_name: it.product_name,
      serial_number: it.serial_number,
      color: it.color,
      quantity: it.quantity,
      unit_price: Number(it.unit_price),
      discount: Number(it.discount),
    }));
    const { data: newId, error } = await supabase.rpc("create_invoice", {
      _customer_id: inv.customer_id,
      _discount: Number(inv.discount ?? 0),
      _notes: inv.notes ?? null,
      _language: inv.language ?? lang,
      _items: payload as any,
    } as any);
    if (error || !newId) return handleRpcError(error?.message ?? "");
    toast.success(t("saved"));
    navigate({ to: "/invoices/$id", params: { id: newId as string } });
  };

  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const selectableFiltered = filtered.filter((i) => i.status !== "voided");
  const allSelected = selectableFiltered.length > 0 && selectableFiltered.every((i) => selected.has(i.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectableFiltered.map((i) => i.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const doExport = async (kind: "csv" | "xlsx" | "pdf") => {
    if (filtered.length === 0) return toast.error(t("no_data"));
    setExporting(true);
    try {
      const rows = filtered as InvoiceRow[];
      if (kind === "csv") exportInvoicesToCSV(rows, lang);
      else if (kind === "xlsx") exportInvoicesToExcel(rows, lang);
      else await exportInvoicesBatchPDF(rows, lang);
      toast.success(t("exported"));
    } catch (e: any) {
      toast.error(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const exportOrdersStyle = async () => {
    const picks = filtered.filter((i) => selected.has(i.id) && i.status !== "voided");
    if (picks.length === 0) return toast.error(t("no_data"));
    setExporting(true);
    try {
      await exportInvoicesOrdersStyle(picks.map((i) => ({
        id: i.id,
        invoice_number: i.invoice_number,
        customer_name: i.customer_name ?? null,
      })));
      toast.success(t("exported"));
    } catch (e: any) {
      toast.error(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-gradient-gold">{t("invoices")}</h1>
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={exporting} className="gap-2 rounded-full">
                <Download className="h-4 w-4" />{exporting ? t("exporting") : t("export_filtered")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => doExport("xlsx")} className="gap-2">
                <FileSpreadsheet className="h-4 w-4" />{t("export_excel")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("csv")} className="gap-2">
                <FileSpreadsheet className="h-4 w-4" />{t("export_csv")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("pdf")} className="gap-2">
                <FileText className="h-4 w-4" />{t("export_pdf")} (batch)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Link to="/invoices/new"><Button className="gap-2 shadow-glow"><Plus className="h-4 w-4" />{t("new_invoice")}</Button></Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث برقم الفاتورة، اسم العميل أو رقم الهاتف…" className="ps-9" />
        </div>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">كل الحالات</option>
          <option value="completed">مكتملة</option>
          <option value="voided">ملغاة</option>
        </select>
        <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value as any)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">كل المدفوعات</option>
          <option value="paid">مدفوعة بالكامل</option>
          <option value="partial">مدفوعة جزئياً</option>
          <option value="unpaid">غير مدفوعة</option>
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="date_desc">الأحدث أولاً</option>
          <option value="date_asc">الأقدم أولاً</option>
          <option value="total_desc">الأعلى قيمة</option>
          <option value="total_asc">الأقل قيمة</option>
        </select>
        <div className="flex items-center justify-end text-xs text-muted-foreground sm:col-span-2 lg:col-span-6">
          عرض {filtered.length} من {list.length} فاتورة
        </div>
      </div>

      <div className="surface-elevated overflow-hidden rounded-2xl border bg-card">
        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{t("no_data")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
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
                {filtered.map((i) => {
                  const voided = i.status === "voided";
                  return (
                    <tr key={i.id} className={`hover:bg-muted/30 ${voided ? "opacity-60" : ""}`}>
                      <td className="px-4 py-3 font-medium">
                        <div className="flex items-center gap-2">
                          {i.receipt_number != null && (
                            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">#{i.receipt_number}</span>
                          )}
                          <span>{i.invoice_number}</span>
                          {voided && (
                            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-destructive">
                              {t("voided")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{i.customer_name || "—"}</div>
                        <AuthorBadge email={i.created_by_email} label="created by" className="mt-0.5" />
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">{fmtDate(i.created_at, lang)}</td>
                      <td className="px-4 py-3 font-semibold">{fmtMoney(Number(i.total), "EGP", lang)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <Link to="/invoices/$id" params={{ id: i.id }}>
                            <Button variant="ghost" size="icon" title={t("view")}><Eye className="h-4 w-4" /></Button>
                          </Link>
                          {!voided && (
                            <Link to="/invoices/$id/edit" params={{ id: i.id }}>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 rounded-full border-primary/40 bg-primary/5 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                                title={t("edit")}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">{t("edit")}</span>
                              </Button>
                            </Link>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => duplicate(i.id)} title={t("duplicate")}><Copy className="h-4 w-4" /></Button>
                          {!voided && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" title={t("void")}><Ban className="h-4 w-4 text-warning" /></Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{t("void_invoice")}</AlertDialogTitle>
                                  <AlertDialogDescription>{i.invoice_number} — {t("void_invoice_confirm")}</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => voidInvoice(i.id)}>{t("confirm")}</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" title={t("delete_invoice")}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t("delete_invoice")}</AlertDialogTitle>
                                <AlertDialogDescription>{i.invoice_number} — {t("delete_invoice_confirm")}</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteInvoice(i.id)}>{t("confirm")}</AlertDialogAction>
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
