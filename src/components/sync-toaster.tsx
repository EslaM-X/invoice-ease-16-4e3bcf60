import { useEffect } from "react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";

/**
 * Listens to app:sync-success / app:sync-failed events and surfaces toasts.
 * Mounted once at the app root.
 */
export function SyncToaster() {
  const { lang } = useI18n();
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
    window.addEventListener("app:sync-success", onSuccess);
    window.addEventListener("app:sync-failed", onFailed);
    return () => {
      window.removeEventListener("app:sync-success", onSuccess);
      window.removeEventListener("app:sync-failed", onFailed);
    };
  }, [lang]);
  return null;
}
