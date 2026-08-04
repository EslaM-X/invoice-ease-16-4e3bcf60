import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Search, Download, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import type { Customer } from "@/lib/data";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { exportCustomersToExcel, exportCustomersToCSV, type CustomerRow } from "@/lib/invoice-export";
import { useRealtimeTable, useBatchedRealtimeTables } from "@/lib/realtime";
import { AuthorBadge } from "@/components/author-badge";
import { cachedListFetch } from "@/lib/list-cache";
import { enqueueOrRun } from "@/lib/outbox";
import { getPendingRowIds } from "@/lib/sync-state";
import { CloudUpload } from "lucide-react";
import type { SalesEvent } from "@/lib/data";
import { CUSTOMER_CATEGORIES, SALES_CHANNELS, categoryBadgeClass, labelForCustomerCategory, labelForSalesChannel } from "@/lib/sales-classification";
import { buildCustomerStats, tierClass, tierLabel, EMPTY_STATS, type CustomerInvoice, type CustomerStats } from "@/lib/customer-stats";
import { CustomerProfileSheet } from "@/components/customer-profile-sheet";
import { fmtMoney } from "@/lib/utils-money";
import { useMemo } from "react";


export const Route = createFileRoute("/customers")({
  component: () => <AppShell><Customers /></AppShell>,
  head: () => ({
    meta: [
      { title: "Customers CRM — Steinheim Suite" },
      { name: "description", content: "Manage customer profiles, purchase history, balances, ratings, and communications inside your Steinheim Suite workspace." },
      { property: "og:title", content: "Customers CRM — Steinheim Suite" },
      { property: "og:description", content: "Manage customer profiles, purchase history, balances, and communications." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function Customers() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [list, setList] = useState<Customer[]>([]);
  const [salesEvents, setSalesEvents] = useState<SalesEvent[]>([]);
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const emptyForm = { name: "", phone: "", address: "", category: "", company_name: "", contact_person: "", sales_channel: "showroom", sales_event_id: "", source_notes: "" };
  const [form, setForm] = useState(emptyForm);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [sortBy, setSortBy] = useState<"value" | "count" | "recent" | "name">("value");
  const [vipOnly, setVipOnly] = useState(false);
  const [dueOnly, setDueOnly] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    const { data } = await cachedListFetch<Customer>("customers", async () => {
      const { data } = await supabase.from("customers").select("*").order("created_at", { ascending: false });
      return (data ?? []) as Customer[];
    });
    setList(data);
    const { data: ev } = await (supabase.from as any)("sales_events").select("*").order("year", { ascending: false }).order("name");
    setSalesEvents((ev ?? []) as SalesEvent[]);
  };
  const loadInvoices = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("invoices")
      .select("id, invoice_number, customer_id, customer_name, customer_phone, subtotal, discount, total, tax_enabled, tax_rate, paid_amount, status, delivery_computed_state, created_at")
      .order("created_at", { ascending: false });
    setInvoices((data ?? []) as unknown as CustomerInvoice[]);
  };
  const refreshPending = async () => setPendingIds(await getPendingRowIds("customers"));
  useEffect(() => { load(); loadInvoices(); refreshPending(); }, [user]);
  useEffect(() => {
    const on = () => refreshPending();
    window.addEventListener("app:outbox-changed", on);
    window.addEventListener("app:sync-success", on);
    return () => {
      window.removeEventListener("app:outbox-changed", on);
      window.removeEventListener("app:sync-success", on);
    };
  }, []);
  useRealtimeTable("customers", () => { load(); refreshPending(); });
  useBatchedRealtimeTables(["invoices", "payments"], () => { loadInvoices(); });

  const statsMap = useMemo(
    () => buildCustomerStats(list.map((c) => ({ id: c.id, name: c.name, phone: c.phone })), invoices),
    [list, invoices],
  );
  const statsFor = (id: string): CustomerStats => statsMap.get(id) ?? EMPTY_STATS;

  const filtered = list.filter((c) => {
    const s = q.trim().toLowerCase();
    if (categoryFilter !== "all" && (c.category ?? "") !== categoryFilter) return false;
    if (channelFilter !== "all" && (c.sales_channel ?? "") !== channelFilter) return false;
    if (eventFilter !== "all" && (c.sales_event_id ?? "") !== eventFilter) return false;
    const st = statsFor(c.id);
    if (vipOnly && st.tier !== "vip") return false;
    if (dueOnly && st.remaining <= 0.01) return false;
    if (!s) return true;
    return [c.name, c.phone, c.address, c.company_name, c.contact_person, c.source_notes].some((x) => (x ?? "").toLowerCase().includes(s));
  }).sort((a, b) => {
    const sa = statsFor(a.id), sb = statsFor(b.id);
    if (sortBy === "value") return sb.totalValue - sa.totalValue;
    if (sortBy === "count") return sb.count - sa.count;
    if (sortBy === "recent") return new Date(sb.lastAt ?? 0).getTime() - new Date(sa.lastAt ?? 0).getTime();
    return a.name.localeCompare(b.name);
  });

  const profileCustomer = profileId ? list.find((c) => c.id === profileId) ?? null : null;


  const openAdd = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (c: Customer) => { setEditing(c); setForm({ name: c.name, phone: c.phone ?? "", address: c.address ?? "", category: c.category ?? "", company_name: c.company_name ?? "", contact_person: c.contact_person ?? "", sales_channel: c.sales_channel ?? "showroom", sales_event_id: c.sales_event_id ?? "", source_notes: c.source_notes ?? "" }); setOpen(true); };

  const save = async () => {
    if (!user) return;
    if (!form.name.trim()) return toast.error(t("required"));
    // Normalize: empty strings → null so UUID/optional columns don't reject the insert
    const cleaned = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      category: form.category || null,
      company_name: form.company_name.trim() || null,
      contact_person: form.contact_person.trim() || null,
      sales_channel: form.sales_channel || null,
      sales_event_id: form.sales_event_id || null,
      source_notes: form.source_notes.trim() || null,
    };
    try {
      if (editing) {
        const r = await enqueueOrRun({
          table: "customers",
          op: "update",
          row_id: editing.id,
          payload: cleaned,
          run: async () => {
            const { error } = await supabase.from("customers").update(cleaned).eq("id", editing.id);
            if (error) throw error;
          },
        });
        toast.success(r.queued ? "تم الحفظ محلياً (سيُرفع عند رجوع الإنترنت)" : t("customer_saved"));
      } else {
        const newId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}`;
        const payload = { id: newId, ...cleaned, user_id: user.id };
        const r = await enqueueOrRun({
          table: "customers",
          op: "insert",
          row_id: newId,
          payload,
          run: async () => {
            const { error } = await supabase.from("customers").insert(payload);
            if (error) throw error;
          },
        });
        toast.success(r.queued ? "تم الحفظ محلياً (سيُرفع عند رجوع الإنترنت)" : t("customer_saved"));
      }
      setOpen(false);
      load();
    } catch (err: any) {
      toast.error(err?.message ?? "Save failed");
    }
  };

  const remove = async (id: string) => {
    try {
      const r = await enqueueOrRun({
        table: "customers",
        op: "delete",
        row_id: id,
        payload: {},
        run: async () => {
          const { error } = await supabase.from("customers").delete().eq("id", id);
          if (error) throw error;
        },
      });
      toast.success(r.queued ? "تم الحذف محلياً (سيُرفع عند رجوع الإنترنت)" : t("customer_deleted"));
      load();
    } catch (err: any) {
      toast.error(err?.message ?? "Delete failed");
    }
  };

  const { lang } = useI18n();
  const doExport = (kind: "xlsx" | "csv") => {
    if (filtered.length === 0) return toast.error(t("no_data") || "No data");
    try {
      const rows = filtered as CustomerRow[];
      if (kind === "xlsx") exportCustomersToExcel(rows, lang as any);
      else exportCustomersToCSV(rows, lang as any);
      toast.success(t("exported") || "Exported");
    } catch (e: any) {
      toast.error(e.message || "Export failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-gradient-gold">{t("customers")}</h1>
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2 rounded-full">
                <Download className="h-4 w-4" />{t("export_filtered") || "Export"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => doExport("xlsx")} className="gap-2">
                <FileSpreadsheet className="h-4 w-4" />{t("export_excel") || "Excel"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("csv")} className="gap-2">
                <FileText className="h-4 w-4" />{t("export_csv") || "CSV"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openAdd} className="gap-2"><Plus className="h-4 w-4" /> {t("add_customer")}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? t("edit_customer") : t("add_customer")}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>{t("name")}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>{t("phone")}</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><Label>{t("address")}</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label>Catgry</Label><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">{lang === "ar" ? "غير مصنف" : "Uncategorized"}</option>{CUSTOMER_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{lang === "ar" ? c.ar : c.en}</option>)}</select></div>
                  <div><Label>{lang === "ar" ? "مصدر العميل" : "Source"}</Label><select value={form.sales_channel} onChange={(e) => setForm({ ...form, sales_channel: e.target.value })} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">{lang === "ar" ? "غير مصنف" : "Uncategorized"}</option>{SALES_CHANNELS.map((c) => <option key={c.value} value={c.value}>{lang === "ar" ? c.ar : c.en}</option>)}</select></div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label>{lang === "ar" ? "اسم الشركة / المعرض" : "Company / showroom"}</Label><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></div>
                  <div><Label>{lang === "ar" ? "اسم الشخص المسؤول" : "Contact person"}</Label><Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
                </div>
                <div><Label>{lang === "ar" ? "المعرض / الحدث" : "Event"}</Label><select value={form.sales_event_id} onChange={(e) => setForm({ ...form, sales_event_id: e.target.value })} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">{lang === "ar" ? "بدون" : "None"}</option>{salesEvents.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}{ev.year ? ` ${ev.year}` : ""}</option>)}</select></div>
                <div><Label>{lang === "ar" ? "ملاحظات المصدر" : "Source notes"}</Label><Input value={form.source_notes} onChange={(e) => setForm({ ...form, source_notes: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
                <Button onClick={save}>{t("save")}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="ps-9" />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="all">{lang === "ar" ? "كل تصنيفات العملاء" : "All categories"}</option>{CUSTOMER_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{lang === "ar" ? c.ar : c.en}</option>)}</select>
        <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="all">{lang === "ar" ? "كل المصادر" : "All sources"}</option>{SALES_CHANNELS.map((c) => <option key={c.value} value={c.value}>{lang === "ar" ? c.ar : c.en}</option>)}</select>
        <select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="all">{lang === "ar" ? "كل المعارض" : "All events"}</option>{salesEvents.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}{ev.year ? ` ${ev.year}` : ""}</option>)}</select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="h-9 rounded-full border bg-background px-3 text-xs">
          <option value="value">{lang === "ar" ? "ترتيب: الأعلى قيمة" : "Sort: Highest value"}</option>
          <option value="count">{lang === "ar" ? "ترتيب: عدد الفواتير" : "Sort: Invoice count"}</option>
          <option value="recent">{lang === "ar" ? "ترتيب: آخر تعامل" : "Sort: Most recent"}</option>
          <option value="name">{lang === "ar" ? "ترتيب: الاسم" : "Sort: Name"}</option>
        </select>
        <button
          type="button"
          onClick={() => setVipOnly((v) => !v)}
          className={`h-9 rounded-full border px-3 text-xs font-semibold transition-colors ${vipOnly ? tierClass("vip") : "bg-background text-muted-foreground"}`}
        >
          {lang === "ar" ? "VIP فقط" : "VIP only"}
        </button>
        <button
          type="button"
          onClick={() => setDueOnly((v) => !v)}
          className={`h-9 rounded-full border px-3 text-xs font-semibold transition-colors ${dueOnly ? "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300" : "bg-background text-muted-foreground"}`}
        >
          {lang === "ar" ? "عليه متبقي" : "Has balance"}
        </button>
      </div>

      <div className="surface-elevated overflow-hidden rounded-2xl border bg-card perf-contain">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{t("no_customers")}</div>
        ) : (
          <div className="overflow-x-auto smooth-scroll">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-muted/50 text-start">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{t("name")}</th>
                <th className="px-4 py-3 text-start font-medium">{lang === "ar" ? "حجم الشغل" : "Volume"}</th>
                <th className="px-4 py-3 text-start font-medium hidden sm:table-cell">{t("phone")}</th>
                <th className="px-4 py-3 text-start font-medium hidden sm:table-cell">Catgry</th>
                <th className="px-4 py-3 text-start font-medium hidden lg:table-cell">{lang === "ar" ? "المصدر" : "Source"}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((c) => {
                const st = statsFor(c.id);
                const pct = Math.round(st.deliveredRatio * 100);
                return (
                <tr
                  key={c.id}
                  onClick={() => setProfileId(c.id)}
                  className="cursor-pointer hover:bg-muted/30"
                >
                  <td className="px-4 py-3 font-medium">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{c.name}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tierClass(st.tier)}`}>
                        {tierLabel(st.tier, lang === "ar")}
                      </span>
                      {st.remaining > 0.01 ? (
                        <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-300">
                          {lang === "ar" ? "متبقي" : "Due"} {fmtMoney(st.remaining)}
                        </span>
                      ) : null}
                      {pendingIds.has(c.id) ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                          <CloudUpload className="h-2.5 w-2.5" />
                          {lang === "ar" ? "قيد المزامنة" : "Pending"}
                        </span>
                      ) : null}
                    </div>
                    <AuthorBadge email={c.created_by_email} label="created by" className="mt-0.5" />
                  </td>
                  <td className="px-4 py-3">
                    {st.count === 0 ? (
                      <span className="text-xs text-muted-foreground">{lang === "ar" ? "لا فواتير" : "No invoices"}</span>
                    ) : (
                      <div className="min-w-[130px]">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-bold tabular-nums">{fmtMoney(st.totalValue)}</span>
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {st.count} {lang === "ar" ? "فاتورة" : "inv"}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                          {lang === "ar" ? `مُسلَّم ${st.delivered}/${st.count}` : `Delivered ${st.delivered}/${st.count}`}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">{c.phone || "—"}</td>
                  <td className="px-4 py-3 hidden sm:table-cell"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${categoryBadgeClass(c.category)}`}>{labelForCustomerCategory(c.category, lang as any)}</span></td>
                  <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground">{labelForSalesChannel(c.sales_channel, lang as any)}{c.company_name ? ` · ${c.company_name}` : ""}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("confirm_delete")}</AlertDialogTitle>
                            <AlertDialogDescription>{c.name}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => remove(c.id)}>{t("confirm")}</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <CustomerProfileSheet
        open={!!profileCustomer}
        onOpenChange={(v) => { if (!v) setProfileId(null); }}
        customer={profileCustomer}
        stats={profileCustomer ? statsFor(profileCustomer.id) : null}
        isAr={lang === "ar"}
      />
    </div>

  );
}
