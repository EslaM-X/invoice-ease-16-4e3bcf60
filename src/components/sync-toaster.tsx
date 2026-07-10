import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

/**
 * Listens to app:sync-success / app:sync-failed / app:realtime-status events
 * and surfaces user-facing toasts. Mounted once at the app root.
 *
 * Realtime toasts are throttled and coalesced: many tables can disconnect
 * during one network blip; users see one "reconnecting" toast, not twenty.
 */
export function SyncToaster() {
  const { lang } = useI18n();
  const reconnectingToastId = useRef<string | number | null>(null);
  const lastEmit = useRef<{ status: string; at: number }>({ status: "", at: 0 });

  useEffect(() => {
    const onSuccess = (e: Event) => {
      const count = (e as CustomEvent).detail?.count ?? 0;
      if (count <= 0) return;
      toast.success(
        lang === "ar"
          ? `تمت مزامنة ${count} عملية بنجاح`
          : `Synced ${count} operation${count === 1 ? "" : "s"}`,
      );
    };
    const onFailed = (e: Event) => {
      const items = (e as CustomEvent).detail?.items ?? [];
      if (!items.length) return;
      toast.error(
        lang === "ar"
          ? `فشل رفع ${items.length} عملية بعد 5 محاولات`
          : `${items.length} operation${items.length === 1 ? "" : "s"} failed after 5 retries`,
        {
          duration: 10_000,
          action: {
            label: lang === "ar" ? "عرض التفاصيل" : "View details",
            onClick: () => { window.location.href = "/pending-operations"; },
          },
        },
      );
    };
    const onRealtime = (e: Event) => {
      const detail = (e as CustomEvent).detail as { status: string; table?: string; attempt?: number };
      if (!detail?.status) return;
      const now = Date.now();
      // Coalesce bursts across many tables: at most one toast per status per 4s.
      if (lastEmit.current.status === detail.status && now - lastEmit.current.at < 4000) return;
      lastEmit.current = { status: detail.status, at: now };

      if (detail.status === "reconnecting") {
        if (reconnectingToastId.current == null) {
          reconnectingToastId.current = toast.loading(
            lang === "ar"
              ? `فقدنا الاتصال اللحظي... جاري إعادة المحاولة (محاولة ${detail.attempt ?? 1})`
              : `Realtime disconnected — retrying (attempt ${detail.attempt ?? 1})`,
            { duration: 30_000 },
          );
        }
      } else if (detail.status === "reconnected") {
        if (reconnectingToastId.current != null) {
          toast.dismiss(reconnectingToastId.current);
          reconnectingToastId.current = null;
        }
        toast.success(
          lang === "ar" ? "عاد الاتصال اللحظي — التحديثات تعمل" : "Realtime reconnected — live updates resumed",
          { duration: 3000 },
        );
      } else if (detail.status === "failed") {
        if (reconnectingToastId.current != null) {
          toast.dismiss(reconnectingToastId.current);
          reconnectingToastId.current = null;
        }
        toast.error(
          lang === "ar"
            ? "تعذّر استعادة الاتصال اللحظي. حدّث الصفحة إذا استمرت المشكلة."
            : "Realtime failed to reconnect. Refresh the page if the issue persists.",
          { duration: 8000 },
        );
      }
    };

    window.addEventListener("app:sync-success", onSuccess);
    window.addEventListener("app:sync-failed", onFailed);
    window.addEventListener("app:realtime-status", onRealtime);
    return () => {
      window.removeEventListener("app:sync-success", onSuccess);
      window.removeEventListener("app:sync-failed", onFailed);
      window.removeEventListener("app:realtime-status", onRealtime);
    };
  }, [lang]);
  return null;
}

