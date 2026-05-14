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
import { useRealtimeTable } from "@/lib/realtime";
import { AuthorBadge } from "@/components/author-badge";
import { cachedListFetch } from "@/lib/list-cache";
import { enqueueOrRun } from "@/lib/outbox";
import { getPendingRowIds } from "@/lib/sync-state";
import { CloudUpload } from "lucide-react";

export const Route = createFileRoute("/customers")({ component: () => <AppShell><Customers /></AppShell> });

function Customers() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [list, setList] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", address: "" });
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const load = async () => {
    if (!user) return;
    const { data } = await cachedListFetch<Customer>("customers", async () => {
      const { data } = await supabase.from("customers").select("*").order("created_at", { ascending: false });
      return (data ?? []) as Customer[];
    });
    setList(data);
  };
  const refreshPending = async () => setPendingIds(await getPendingRowIds("customers"));
  useEffect(() => { load(); refreshPending(); }, [user]);
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

  const filtered = list.filter((c) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return c.name.toLowerCase().includes(s) || (c.phone ?? "").toLowerCase().includes(s) || (c.address ?? "").toLowerCase().includes(s);
  });

  const openAdd = () => { setEditing(null); setForm({ name: "", phone: "", address: "" }); setOpen(true); };
  const openEdit = (c: Customer) => { setEditing(c); setForm({ name: c.name, phone: c.phone ?? "", address: c.address ?? "" }); setOpen(true); };

  const save = async () => {
    if (!user) return;
    if (!form.name.trim()) return toast.error(t("required"));
    try {
      if (editing) {
        const r = await enqueueOrRun({
          table: "customers",
          op: "update",
          row_id: editing.id,
          payload: form,
          run: async () => {
            const { error } = await supabase.from("customers").update(form).eq("id", editing.id);
            if (error) throw error;
          },
        });
        toast.success(r.queued ? "تم الحفظ محلياً (سيُرفع عند رجوع الإنترنت)" : t("customer_saved"));
      } else {
        const newId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}`;
        const payload = { id: newId, ...form, user_id: user.id };
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

      <div className="surface-elevated overflow-hidden rounded-2xl border bg-card">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{t("no_customers")}</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="bg-muted/50 text-start">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{t("name")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("phone")}</th>
                <th className="px-4 py-3 text-start font-medium hidden sm:table-cell">{t("address")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{c.name}</span>
                      {pendingIds.has(c.id) ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                          <CloudUpload className="h-2.5 w-2.5" />
                          {lang === "ar" ? "قيد المزامنة" : "Pending"}
                        </span>
                      ) : null}
                    </div>
                    <AuthorBadge email={c.created_by_email} label="created by" className="mt-0.5" />
                  </td>
                  <td className="px-4 py-3">{c.phone || "—"}</td>
                  <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">{c.address || "—"}</td>
                  <td className="px-4 py-3">
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
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
