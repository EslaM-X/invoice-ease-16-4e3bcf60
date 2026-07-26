import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Eye, Copy, Ban, Trash2, FileSpreadsheet, FileText, Download, Pencil, Archive, ClipboardCheck, FileEdit } from "lucide-react";
import { fmtDate, fmtMoney } from "@/lib/utils-money";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { exportInvoicesToCSV, exportInvoicesToExcel, exportInvoicesBatchPDF, type InvoiceRow } from "@/lib/invoice-export";
import { exportInvoicesOrdersStyle } from "@/lib/orders-export";
import { Checkbox } from "@/components/ui/checkbox";
import { useBatchedRealtimeTables } from "@/lib/realtime";
import { AuthorBadge } from "@/components/author-badge";
import { TableSkeleton } from "@/components/skeletons";
import { cachedListFetch } from "@/lib/list-cache";
import type { SalesEvent } from "@/lib/data";
import { CUSTOMER_CATEGORIES, SALES_CHANNELS, categoryBadgeClass, labelForCustomerCategory, labelForSalesChannel } from "@/lib/sales-classification";
import { addBusinessDays } from "@/lib/delivery-terms";

export const Route = createFileRoute("/invoices/")({
  component: () => <AppShell><InvoicesList /></AppShell>,
  head: () => ({
    meta: [
      { title: "Invoices — Steinheim Suite" },
      { name: "description", content: "Browse, search, and manage every issued invoice with statuses, payments, deliveries, and audit history in Steinheim Suite." },
      { property: "og:title", content: "Invoices — Steinheim Suite" },
      { property: "og:description", content: "Browse, search, and manage every issued invoice with statuses, payments, and audit history." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function InvoicesList() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [list, setList] = useState<any[]>([]);
  const [salesEvents, setSalesEvents] = useState<SalesEvent[]>([]);
  const [drCounts, setDrCounts] = useState<Record<string, number>>({});
  const [delivProgress, setDelivProgress] = useState<Record<string, { delivered: number; total: number }>>({});
  const [serialsByInvoice, setSerialsByInvoice] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "voided">("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "paid" | "partial" | "unpaid">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [deliveryDaysFilter, setDeliveryDaysFilter] = useState("all");
  const [deliveryFromFilter, setDeliveryFromFilter] = useState("");
  const [deliveryToFilter, setDeliveryToFilter] = useState("");
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "total_desc" | "total_asc">("date_desc");
  const [hideClosed, setHideClosed] = useState(true);
  const navigate = useNavigate();

  const load = async () => {
    if (!user) return;
    const cacheKey = `invoices:${from || "_"}:${to || "_"}`;
    const { data } = await cachedListFetch<any>(cacheKey, async () => {
      let query = supabase
        .from("invoices")
        .select("*")
        .order("created_at", { ascending: false })
        .range(0, 9999); // lift the default 1000-row cap
      if (from) query = query.gte("created_at", from);
      if (to) query = query.lte("created_at", to + "T23:59:59");
      const { data } = await query;
      return data ?? [];
    }, { forceRefresh: true });
    setList(data);
    setLoading(false);
    const { data: ev } = await (supabase.from as any)("sales_events").select("*").order("year", { ascending: false }).order("name");
    setSalesEvents((ev ?? []) as SalesEvent[]);

    // Linked delivery receipts count + delivered quantity progress
    if (data.length) {
      const ids = data.map((i: any) => i.id);
      const [{ data: drs }, { data: invItems }] = await Promise.all([
        supabase
          .from("delivery_receipts" as any)
          .select("id, invoice_id, status")
          .in("invoice_id", ids)
          .range(0, 19999),
        supabase
          .from("invoice_items")
          .select("invoice_id, quantity, serial_number")
          .in("invoice_id", ids)
          .range(0, 49999), // serial search needs every line item
      ]);
      const counts: Record<string, number> = {};
      const drToInvoice: Record<string, string> = {};
      const validReceiptIds: string[] = [];
      (drs ?? []).forEach((r: any) => {
        if (!r.invoice_id) return;
        counts[r.invoice_id] = (counts[r.invoice_id] ?? 0) + 1;
        // Exclude drafts from delivered-quantity calculation
        if (r.status !== "draft") {
          drToInvoice[r.id] = r.invoice_id;
          validReceiptIds.push(r.id);
        }
      });
      setDrCounts(counts);

      const totals: Record<string, number> = {};
      const serialsMap: Record<string, string[]> = {};
      (invItems ?? []).forEach((it: any) => {
        if (!it.invoice_id) return;
        totals[it.invoice_id] = (totals[it.invoice_id] ?? 0) + Number(it.quantity ?? 0);
        if (it.serial_number) {
          // Normalize: lowercase + strip spaces/dashes/dots so search matches
          // regardless of how the serial was typed.
          const norm = String(it.serial_number).toLowerCase().replace(/[\s_\-./]+/g, "");
          (serialsMap[it.invoice_id] ??= []).push(norm);
        }
      });
      setSerialsByInvoice(serialsMap);

      const deliveredByInv: Record<string, number> = {};
      if (validReceiptIds.length) {
        const { data: drItems } = await supabase
          .from("delivery_receipt_items" as any)
          .select("receipt_id, quantity")
          .in("receipt_id", validReceiptIds);
        (drItems ?? []).forEach((di: any) => {
          const invId = drToInvoice[di.receipt_id];
          if (!invId) return;
          deliveredByInv[invId] = (deliveredByInv[invId] ?? 0) + Number(di.quantity ?? 0);
        });
      }

      const progress: Record<string, { delivered: number; total: number }> = {};
      ids.forEach((id: string) => {
        progress[id] = { delivered: deliveredByInv[id] ?? 0, total: totals[id] ?? 0 };
      });
      setDelivProgress(progress);
    }
  };
  // Debounce date range to avoid a re-query on every keystroke inside the date input.
  const [fromDebounced, setFromDebounced] = useState(from);
  const [toDebounced, setToDebounced] = useState(to);
  useEffect(() => {
    const h = setTimeout(() => { setFromDebounced(from); setToDebounced(to); }, 300);
    return () => clearTimeout(h);
  }, [from, to]);
  useEffect(() => { load(); }, [user, fromDebounced, toDebounced]);
  // Deferred text search — keeps the input responsive while filtering ~10k rows in memory.
  const qDeferred = useDeferredValue(q);
  useBatchedRealtimeTables(["invoices", "delivery_receipts"], () => { load(); }, [user?.id]);

  const isClosed = (i: any) => {
    if (i.status === "voided") return false;
    const total = Number(i.total ?? 0);
    const paid = Number(i.paid_amount ?? 0);
    const fullyPaid = total > 0 && paid >= total - 0.001;
    return fullyPaid && i.delivery_status === "delivered";
  };
  const closedCount = list.filter(isClosed).length;
  const draftCount = list.filter((i) => i.status === "draft").length;

  const filtered = list
    .filter((i) => {
      if (i.status === "draft") return false;
      if (hideClosed && isClosed(i)) return false;
      if (statusFilter !== "all" && (i.status ?? "completed") !== statusFilter) return false;
      if (categoryFilter !== "all" && (i.customer_category ?? "") !== categoryFilter) return false;
      if (channelFilter !== "all" && (i.sales_channel ?? "") !== channelFilter) return false;
      if (eventFilter !== "all" && (i.sales_event_id ?? "") !== eventFilter) return false;
      if (deliveryDaysFilter !== "all") {
        const d = i.delivery_days != null ? String(i.delivery_days) : "21";
        if (d !== deliveryDaysFilter) return false;
      }
      if (deliveryFromFilter || deliveryToFilter) {
        const days = Number(i.delivery_days ?? 21);
        const due = addBusinessDays(i.created_at, days).getTime();
        if (deliveryFromFilter && due < new Date(deliveryFromFilter).setHours(0, 0, 0, 0)) return false;
        if (deliveryToFilter && due > new Date(deliveryToFilter).setHours(23, 59, 59, 999)) return false;
      }
      if (paymentFilter !== "all") {
        const total = Number(i.total ?? 0);
        const paid = Number(i.paid_amount ?? 0);
        const ratio = total > 0 ? paid / total : 0;
        if (paymentFilter === "paid" && ratio < 0.999) return false;
        if (paymentFilter === "unpaid" && paid > 0.001) return false;
        if (paymentFilter === "partial" && (paid <= 0.001 || ratio >= 0.999)) return false;
      }
      const s = qDeferred.trim().toLowerCase();
      if (!s) return true;
      const sSerial = s.replace(/[\s_\-./]+/g, "");
      return (
        (i.invoice_number ?? "").toLowerCase().includes(s) ||
        String(i.receipt_number ?? "").includes(s) ||
        (i.customer_name ?? "").toLowerCase().includes(s) ||
        (i.customer_phone ?? "").toLowerCase().includes(s) ||
        (i.subject ?? "").toLowerCase().includes(s) ||
        (serialsByInvoice[i.id] ?? []).some((sn) => sn.includes(sSerial))
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

  const convertToDraft = async (id: string) => {
    const { error } = await supabase.rpc("convert_invoice_to_draft" as any, { _invoice_id: id } as any);
    if (error) return toast.error(error.message);
    toast.success(t("invoice_converted_to_draft"));
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
      _customer_category: inv.customer_category ?? null,
      _sales_channel: inv.sales_channel ?? null,
      _sales_event_id: inv.sales_event_id ?? null,
    } as any);
    if (error || !newId) return handleRpcError(error?.message ?? "");
    toast.success(t("saved"));
    navigate({ to: "/invoices/$id", params: { id: newId as string } });
  };

  const eventLabel = (id?: string | null) => {
    const ev = salesEvents.find((x) => x.id === id);
    return ev ? `${ev.name}${ev.year ? ` ${ev.year}` : ""}` : null;
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
          <Link to="/invoices/drafts">
            <Button variant="outline" className="gap-2 rounded-full border-amber-500/40 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400">
              <FileText className="h-4 w-4" />
              {t("drafts")}
              {draftCount > 0 && (
                <span className="ms-1 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                  {draftCount}
                </span>
              )}
            </Button>
          </Link>
          <Link to="/invoices/archive">
            <Button variant="outline" className="gap-2 rounded-full border-emerald-500/40 bg-emerald-500/5 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400">
              <Archive className="h-4 w-4" />
              {t("archive")}
              {closedCount > 0 && (
                <span className="ms-1 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                  {closedCount}
                </span>
              )}
            </Button>
          </Link>
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
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={lang === "ar" ? "بحث برقم/عميل/هاتف/موضوع/سيريال…" : "Search #/customer/phone/subject/serial…"} className="ps-9" />
        </div>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">{t("all_statuses")}</option>
          <option value="completed">{t("status_completed")}</option>
          <option value="voided">{t("status_voided")}</option>
        </select>
        <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value as any)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">{t("all_payments")}</option>
          <option value="paid">{t("payment_paid")}</option>
          <option value="partial">{t("payment_partial")}</option>
          <option value="unpaid">{t("payment_unpaid")}</option>
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="date_desc">{t("sort_date_desc")}</option>
          <option value="date_asc">{t("sort_date_asc")}</option>
          <option value="total_desc">{t("sort_total_desc")}</option>
          <option value="total_asc">{t("sort_total_asc")}</option>
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">{lang === "ar" ? "كل Catgry العملاء" : "All customer categories"}</option>
          {CUSTOMER_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{lang === "ar" ? c.ar : c.en}</option>)}
        </select>
        <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">{lang === "ar" ? "كل Catgry الفواتير" : "All invoice channels"}</option>
          {SALES_CHANNELS.map((c) => <option key={c.value} value={c.value}>{lang === "ar" ? c.ar : c.en}</option>)}
        </select>
        <select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">{lang === "ar" ? "كل المعارض والأحداث" : "All events"}</option>
          {salesEvents.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}{ev.year ? ` ${ev.year}` : ""}</option>)}
        </select>
        <select value={deliveryDaysFilter} onChange={(e) => setDeliveryDaysFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">{lang === "ar" ? "كل شروط التسليم" : "All delivery terms"}</option>
          {[7, 21, 30, 45, 60].map((d) => (
            <option key={d} value={String(d)}>{lang === "ar" ? `${d} يوم` : `${d} days`}</option>
          ))}
        </select>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground whitespace-nowrap">{lang === "ar" ? "تسليم من" : "Delivery from"}</span>
          <input type="date" value={deliveryFromFilter} onChange={(e) => setDeliveryFromFilter(e.target.value)} className="h-10 flex-1 min-w-0 rounded-md border border-input bg-background px-2 text-sm" />
          <span className="text-muted-foreground">{lang === "ar" ? "إلى" : "to"}</span>
          <input type="date" value={deliveryToFilter} onChange={(e) => setDeliveryToFilter(e.target.value)} className="h-10 flex-1 min-w-0 rounded-md border border-input bg-background px-2 text-sm" />
          {(deliveryFromFilter || deliveryToFilter) && (
            <button type="button" onClick={() => { setDeliveryFromFilter(""); setDeliveryToFilter(""); }} className="text-muted-foreground underline whitespace-nowrap">
              {lang === "ar" ? "مسح" : "Clear"}
            </button>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground sm:col-span-2 lg:col-span-6">
          <label className="inline-flex items-center gap-2 text-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={hideClosed}
              onChange={(e) => setHideClosed(e.target.checked)}
            />
            <span>{t("hide_closed_invoices")}</span>
            {closedCount > 0 && (
              <Link to="/invoices/archive" className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20">
                {closedCount} {t("in_archive")} →
              </Link>
            )}
          </label>
          <span>{t("showing_count").replace("{n}", String(filtered.length)).replace("{m}", String(list.length))}</span>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-primary/5 px-4 py-3">
          <div className="text-sm font-medium">{t("selected_count").replace("{n}", String(selected.size))}</div>
          <div className="flex gap-2">
            <Button onClick={exportOrdersStyle} disabled={exporting} className="gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              {t("export_orders_style")}
            </Button>
            <Button variant="outline" onClick={() => setSelected(new Set())}>
              {t("clear_selection")}
            </Button>
          </div>
        </div>
      )}

      <div className="surface-elevated overflow-hidden rounded-2xl border bg-card perf-contain">
        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{t("no_data")}</div>
        ) : (
          <div className="overflow-x-auto smooth-scroll">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label={t("select_all_aria")} />
                  </th>
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
                    <tr key={i.id} className={`cv-auto-md hover:bg-muted/30 ${voided ? "opacity-60" : ""}`}>
                      <td className="px-3 py-3">
                        {!voided && (
                          <Checkbox
                            checked={selected.has(i.id)}
                            onCheckedChange={() => toggleOne(i.id)}
                            aria-label={t("select_invoice_aria")}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        <div className="flex flex-wrap items-center gap-2">
                          {i.receipt_number != null && (
                            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">#{i.receipt_number}</span>
                          )}
                          <span>{i.invoice_number}</span>
                          {voided && (
                            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-destructive">
                              {t("voided")}
                            </span>
                          )}
                          {!voided && (() => {
                            const totalNum = Number(i.total ?? 0);
                            const paidNum = Number(i.paid_amount ?? 0);
                            const fullyPaid = totalNum > 0 && paidNum >= totalNum - 0.001;
                            const delivered = i.delivery_status === "delivered";
                            if (fullyPaid && delivered) {
                              return (
                                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400">
                                  {lang === "ar" ? "✓ مُغلقة" : "✓ Closed"}
                                </span>
                              );
                            }
                            return (
                              <>
                                {delivered ? (
                                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-400">
                                    {lang === "ar" ? "مُسلَّمة" : "Delivered"}
                                  </span>
                                ) : (() => {
                                  const p = delivProgress[i.id];
                                  if (p && p.total > 0 && p.delivered > 0 && p.delivered < p.total) {
                                    const remaining = p.total - p.delivered;
                                    return (
                                      <span
                                        className="rounded-full border border-orange-500/40 bg-orange-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-orange-700 dark:text-orange-400"
                                        title={`${p.delivered} / ${p.total}`}
                                      >
                                        {lang === "ar" ? `تسليم جزئي ${p.delivered}/${p.total} — باقي ${remaining}` : `Partial ${p.delivered}/${p.total} — ${remaining} left`}
                                      </span>
                                    );
                                  }
                                  if (p && p.total > 0 && p.delivered === 0) {
                                    return (
                                      <span className="rounded-full border border-slate-500/40 bg-slate-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700 dark:text-slate-300">
                                        {lang === "ar" ? `قيد الانتظار — باقي ${p.total}` : `Pending — ${p.total} left`}
                                      </span>
                                    );
                                  }
                                  return null;
                                })()}
                                {fullyPaid && (
                                  <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-700 dark:text-blue-400">
                                    {lang === "ar" ? "مدفوعة" : "Paid"}
                                  </span>
                                )}
                              </>
                            );
                          })()}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${categoryBadgeClass(i.customer_category)}`}>
                            {labelForCustomerCategory(i.customer_category, lang as any)}
                          </span>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${categoryBadgeClass(i.sales_channel)}`}>
                            {labelForSalesChannel(i.sales_channel, lang as any)}
                          </span>
                          {eventLabel(i.sales_event_id) && (
                            <span className="rounded-full border border-fuchsia-500/35 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-semibold text-fuchsia-700 dark:text-fuchsia-300">
                              {eventLabel(i.sales_event_id)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span>{i.customer_name || "—"}</span>
                          {(drCounts[i.id] ?? 0) > 0 && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400"
                              title={lang === "ar" ? "محاضر تسليم مرتبطة" : "Linked delivery receipts"}
                            >
                              <ClipboardCheck className="h-3 w-3" />
                              {drCounts[i.id]}
                            </span>
                          )}
                        </div>
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
                                <Button variant="ghost" size="icon" title={t("convert_to_draft")}>
                                  <FileEdit className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{t("convert_to_draft")}</AlertDialogTitle>
                                  <AlertDialogDescription>{i.invoice_number} — {t("convert_to_draft_confirm")}</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => convertToDraft(i.id)}>{t("confirm")}</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
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
