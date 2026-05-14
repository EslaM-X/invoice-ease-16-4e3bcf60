import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { getOfflineDb, type OutboxEntry, getPendingCount } from "@/lib/offline-db";
import { deleteOutboxEntry } from "@/lib/outbox";
import { flushOutboxNow, retryOutboxEntry, MAX_RETRIES } from "@/lib/sync-engine";
import { formatRelativeTime } from "@/lib/sync-state";
import { RefreshCw, Trash2, AlertTriangle, Inbox, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/pending-operations")({
  component: () => (
    <AppShell>
      <PendingOperations />
    </AppShell>
  ),
});

function PendingOperations() {
  const { lang } = useI18n();
  const [list, setList] = useState<OutboxEntry[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [flushing, setFlushing] = useState(false);

  const load = async () => {
    try {
      const rows = await getOfflineDb().outbox.orderBy("created_at").toArray();
      setList(rows);
    } catch {
      setList([]);
    }
  };

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener("app:outbox-changed", onChange);
    window.addEventListener("app:sync-success", onChange);
    window.addEventListener("app:sync-failed", onChange);
    const iv = setInterval(load, 5_000);
    return () => {
      window.removeEventListener("app:outbox-changed", onChange);
      window.removeEventListener("app:sync-success", onChange);
      window.removeEventListener("app:sync-failed", onChange);
      clearInterval(iv);
    };
  }, []);

  const retry = async (id: number) => {
    setBusy(id);
    try {
      await retryOutboxEntry(id);
      toast.success(lang === "ar" ? "تمت إعادة المحاولة" : "Retried");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(null);
      load();
    }
  };

  const cancel = async (id: number) => {
    if (!confirm(lang === "ar" ? "إلغاء هذه العملية نهائياً؟" : "Cancel this operation permanently?")) return;
    await deleteOutboxEntry(id);
    toast.success(lang === "ar" ? "تم الإلغاء" : "Cancelled");
    load();
  };

  const flushAll = async () => {
    setFlushing(true);
    try {
      await flushOutboxNow();
    } finally {
      setFlushing(false);
      load();
    }
  };

  const opLabel = (op: string) => {
    if (lang === "ar") return op === "insert" ? "إضافة" : op === "update" ? "تعديل" : "حذف";
    return op;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gradient-gold">
            {lang === "ar" ? "العمليات المعلّقة" : "Pending operations"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {lang === "ar"
              ? "العمليات المحفوظة محلياً بانتظار الرفع إلى الخادم."
              : "Operations saved locally waiting to sync to the server."}
          </p>
        </div>
        <Button onClick={flushAll} disabled={flushing || list.length === 0} className="gap-2">
          {flushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {lang === "ar" ? "مزامنة الكل" : "Sync all"}
        </Button>
      </div>

      <div className="surface-elevated overflow-hidden rounded-2xl border bg-card">
        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-12 text-center text-sm text-muted-foreground">
            <Inbox className="h-10 w-10 opacity-40" />
            {lang === "ar" ? "لا توجد عمليات معلّقة — كل شيء متزامن." : "No pending operations — all synced."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{lang === "ar" ? "الجدول" : "Table"}</th>
                  <th className="px-4 py-3 text-start font-medium">{lang === "ar" ? "العملية" : "Op"}</th>
                  <th className="px-4 py-3 text-start font-medium">{lang === "ar" ? "السجل" : "Row"}</th>
                  <th className="px-4 py-3 text-start font-medium">{lang === "ar" ? "محاولات" : "Tries"}</th>
                  <th className="px-4 py-3 text-start font-medium">{lang === "ar" ? "آخر خطأ" : "Last error"}</th>
                  <th className="px-4 py-3 text-start font-medium">{lang === "ar" ? "العمر" : "Age"}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.map((e) => {
                  const exhausted = (e.retry_count ?? 0) >= MAX_RETRIES;
                  return (
                    <tr key={e.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{e.table}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px]">
                          {opLabel(e.op)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                        {e.row_id.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] ${
                            exhausted
                              ? "bg-destructive/15 text-destructive"
                              : (e.retry_count ?? 0) > 0
                              ? "bg-amber-500/15 text-amber-300"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {e.retry_count ?? 0}/{MAX_RETRIES}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[280px] truncate text-xs text-muted-foreground">
                        {e.last_error ? (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <AlertTriangle className="h-3 w-3" /> {e.last_error}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatRelativeTime(e.created_at, lang as any)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy === e.id}
                            onClick={() => e.id != null && retry(e.id)}
                            className="gap-1"
                          >
                            {busy === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                            {lang === "ar" ? "إعادة" : "Retry"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => e.id != null && cancel(e.id)}
                            className="gap-1 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                            {lang === "ar" ? "إلغاء" : "Cancel"}
                          </Button>
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

// Re-export so other modules can re-use the count helper from this route module.
export { getPendingCount };
