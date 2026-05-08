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
import { fmtDateTime, fmtMoney } from "@/lib/utils-money";
import { toast } from "sonner";
import { Search, Pencil, Save, X, ExternalLink, StickyNote } from "lucide-react";

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    if (user) load();
  }, [user]);

  useRealtimeTable("invoices", () => {
    if (user) load();
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.invoice_number.toLowerCase().includes(s) ||
        String(r.receipt_number ?? "").includes(s) ||
        (r.customer_name ?? "").toLowerCase().includes(s) ||
        (r.system_notes ?? "").toLowerCase().includes(s),
    );
  }, [rows, q]);

  const startEdit = (r: Row) => {
    setEditingId(r.id);
    setDraft(r.system_notes ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    const trimmed = draft.trim();
    const { error } = await supabase
      .from("invoices")
      .update({ system_notes: trimmed === "" ? null : trimmed } as any)
      .eq("id", id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("saved"));
    cancelEdit();
    load();
  };

  return (
    <div className="space-y-5 w-full max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold tracking-tight">
          <StickyNote className="h-6 w-6 text-amber-500" />
          {t("invoices_with_system_notes")}
        </h1>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium tabular-nums">
          {filtered.length}
        </span>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("search_invoice_or_name")}
          className="ps-9"
        />
      </div>

      {loading ? (
        <div className="text-muted-foreground">{t("loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
          {lang === "ar" ? "لا توجد فواتير عليها ملاحظات نظام" : "No invoices with system notes"}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const editing = editingId === r.id;
            return (
              <div
                key={r.id}
                className="rounded-2xl border bg-card p-4 sm:p-5 shadow-sm space-y-3"
              >
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
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={4}
                        autoFocus
                        className="bg-background"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={cancelEdit} className="gap-1">
                          <X className="h-3.5 w-3.5" />
                          {lang === "ar" ? "إلغاء" : "Cancel"}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => saveEdit(r.id)}
                          disabled={saving}
                          className="gap-1"
                        >
                          <Save className="h-3.5 w-3.5" />
                          {t("save")}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <p className="whitespace-pre-wrap text-sm flex-1">{r.system_notes}</p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEdit(r)}
                        className="gap-1 shrink-0"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {lang === "ar" ? "تعديل" : "Edit"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
