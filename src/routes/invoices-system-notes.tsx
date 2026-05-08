import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtDateTime, fmtMoney } from "@/lib/utils-money";
import { toast } from "sonner";
import {
  Search, Pencil, Save, X, ExternalLink, StickyNote, Download,
  History as HistoryIcon, ChevronLeft, ChevronRight,
} from "lucide-react";

type Row = {
  id: string;
  invoice_number: string;
  receipt_number: number | null;
  customer_name: string | null;
  total: number;
  status: string;
  created_at: string;
  system_notes: string | null;
};

type HistoryRow = {
  id: string;
  old_value: string | null;
  new_value: string | null;
  changed_by_email: string | null;
  changed_at: string;
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export const Route = createFileRoute("/invoices-system-notes")({
  component: () => (
    <AppShell>
      <SystemNotesPage />
    </AppShell>
  ),
});

function SystemNotesPage() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "completed" | "voided">("all");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [historyFor, setHistoryFor] = useState<Row | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("invoices")
      .select("id,invoice_number,receipt_number,customer_name,total,status,created_at,system_notes")
      .not("system_notes", "is", null)
      .neq("system_notes", "")
      .order("created_at", { ascending: false });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => { if (user) load(); }, [user]);
  useRealtimeTable("invoices", () => { if (user) load(); });
  useRealtimeTable("invoice_system_notes_history" as any, () => {
    if (historyFor) loadHistory(historyFor.id);
  }, [historyFor?.id]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (!s) return true;
      return (
        r.invoice_number.toLowerCase().includes(s) ||
        String(r.receipt_number ?? "").includes(s) ||
        (r.customer_name ?? "").toLowerCase().includes(s) ||
        (r.system_notes ?? "").toLowerCase().includes(s)
      );
    });
  }, [rows, q, status]);

  useEffect(() => { setPage(1); }, [q, status, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const startEdit = (r: Row) => { setEditingId(r.id); setDraft(r.system_notes ?? ""); };
  const cancelEdit = () => { setEditingId(null); setDraft(""); };

  const saveEdit = async (id: string) => {
    setSaving(true);
    const trimmed = draft.trim();
    const { error } = await supabase
      .from("invoices")
      .update({ system_notes: trimmed === "" ? null : trimmed } as any)
      .eq("id", id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("saved"));
    cancelEdit();
    load();
  };

  const loadHistory = async (invoiceId: string) => {
    setHistoryLoading(true);
    const { data } = await supabase
      .from("invoice_system_notes_history" as any)
      .select("id,old_value,new_value,changed_by_email,changed_at")
      .eq("invoice_id", invoiceId)
      .order("changed_at", { ascending: false });
    setHistory((data ?? []) as HistoryRow[]);
    setHistoryLoading(false);
  };

  const openHistory = (r: Row) => { setHistoryFor(r); loadHistory(r.id); };

  const exportCSV = () => {
    const headers = ["Receipt #", "Invoice #", "Customer", "Status", "Total (EGP)", "Created at", "System notes"];
    const csvLine = (vals: (string | number | null)[]) =>
      vals.map((v) => {
        const s = v == null ? "" : String(v);
        return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
      }).join(",");
    const lines = [csvLine(headers)];
    for (const r of filtered) {
      lines.push(csvLine([
        r.receipt_number ?? "",
        r.invoice_number,
        r.customer_name ?? "",
        r.status,
        Number(r.total).toFixed(2),
        new Date(r.created_at).toISOString(),
        r.system_notes ?? "",
      ]));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `system-notes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 w-full max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold tracking-tight">
          <StickyNote className="h-6 w-6 text-amber-500" />
          {t("invoices_with_system_notes")}
        </h1>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium tabular-nums">
            {filtered.length}
          </span>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCSV} disabled={filtered.length === 0}>
            <Download className="h-3.5 w-3.5" />
            {lang === "ar" ? "تصدير CSV" : "Export CSV"}
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search_invoice_or_name")}
            className="ps-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{lang === "ar" ? "كل الحالات" : "All statuses"}</SelectItem>
            <SelectItem value="completed">{lang === "ar" ? "مكتملة" : "Completed"}</SelectItem>
            <SelectItem value="voided">{lang === "ar" ? "ملغاة" : "Voided"}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
          <SelectTrigger className="w-full sm:w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} / {lang === "ar" ? "صفحة" : "page"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-muted-foreground">{t("loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
          {lang === "ar" ? "لا توجد فواتير عليها ملاحظات نظام" : "No invoices with system notes"}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {pageRows.map((r) => {
              const editing = editingId === r.id;
              return (
                <div key={r.id} className="rounded-2xl border bg-card p-4 sm:p-5 shadow-sm space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold tabular-nums">
                          #{r.receipt_number ?? r.invoice_number}
                        </span>
                        {r.status === "voided" && (
                          <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
                            {lang === "ar" ? "ملغاة" : "Voided"}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {r.customer_name || (lang === "ar" ? "عميل نقدي" : "Walk-in")} ·{" "}
                        <span className="tabular-nums">{fmtDateTime(r.created_at, lang)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums">
                        {fmtMoney(Number(r.total), "EGP", lang)}
                      </span>
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openHistory(r)}>
                        <HistoryIcon className="h-3.5 w-3.5" />
                        {lang === "ar" ? "السجل" : "History"}
                      </Button>
                      <Link to="/invoices/$id" params={{ id: r.id }}>
                        <Button size="sm" variant="outline" className="gap-1.5">
                          <ExternalLink className="h-3.5 w-3.5" />
                          {lang === "ar" ? "فتح" : "Open"}
                        </Button>
                      </Link>
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                    {editing ? (
                      <>
                        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} autoFocus className="bg-background" />
                        <div className="mt-2 flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={cancelEdit} className="gap-1">
                            <X className="h-3.5 w-3.5" />{lang === "ar" ? "إلغاء" : "Cancel"}
                          </Button>
                          <Button size="sm" onClick={() => saveEdit(r.id)} disabled={saving} className="gap-1">
                            <Save className="h-3.5 w-3.5" />{t("save")}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <p className="whitespace-pre-wrap text-sm flex-1">{r.system_notes}</p>
                        <Button size="sm" variant="ghost" onClick={() => startEdit(r)} className="gap-1 shrink-0">
                          <Pencil className="h-3.5 w-3.5" />{lang === "ar" ? "تعديل" : "Edit"}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="text-xs text-muted-foreground tabular-nums">
              {lang === "ar"
                ? `عرض ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)} من ${filtered.length}`
                : `Showing ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)} of ${filtered.length}`}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="gap-1">
                <ChevronRight className="h-3.5 w-3.5 rtl:hidden" />
                <ChevronLeft className="h-3.5 w-3.5 hidden rtl:inline" />
                {lang === "ar" ? "السابق" : "Previous"}
              </Button>
              <span className="text-xs tabular-nums px-2">
                {currentPage} / {totalPages}
              </span>
              <Button size="sm" variant="outline" disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="gap-1">
                {lang === "ar" ? "التالي" : "Next"}
                <ChevronLeft className="h-3.5 w-3.5 rtl:hidden" />
                <ChevronRight className="h-3.5 w-3.5 hidden rtl:inline" />
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={!!historyFor} onOpenChange={(o) => { if (!o) { setHistoryFor(null); setHistory([]); } }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HistoryIcon className="h-4 w-4" />
              {lang === "ar" ? "سجل تعديلات ملاحظات النظام" : "System notes change log"}
              {historyFor && (
                <span className="text-sm font-normal text-muted-foreground tabular-nums">
                  · #{historyFor.receipt_number ?? historyFor.invoice_number}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {historyLoading ? (
            <div className="text-muted-foreground py-6 text-center">{t("loading")}</div>
          ) : history.length === 0 ? (
            <div className="text-muted-foreground py-6 text-center text-sm">
              {lang === "ar" ? "لا يوجد سجل تعديلات بعد" : "No edit history yet"}
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((h) => (
                <div key={h.id} className="rounded-xl border bg-card p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{h.changed_by_email || (lang === "ar" ? "مستخدم" : "User")}</span>
                    <span className="tabular-nums">{fmtDateTime(h.changed_at, lang)}</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2">
                      <div className="text-[10px] uppercase tracking-wider text-destructive mb-1">
                        {lang === "ar" ? "قبل" : "Before"}
                      </div>
                      <p className="whitespace-pre-wrap text-xs">{h.old_value || (lang === "ar" ? "(فارغ)" : "(empty)")}</p>
                    </div>
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
                      <div className="text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1">
                        {lang === "ar" ? "بعد" : "After"}
                      </div>
                      <p className="whitespace-pre-wrap text-xs">{h.new_value || (lang === "ar" ? "(فارغ)" : "(empty)")}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
