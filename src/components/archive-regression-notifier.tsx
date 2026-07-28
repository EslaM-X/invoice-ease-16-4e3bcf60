import { useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/lib/use-role";

/**
 * Subscribes to invoice_archive_audit and toasts admins whenever the DB
 * blocks an archived+paid invoice from reverting to the open list, or when
 * the background auto-closer archives an invoice after receipt signing.
 *
 * Only mounts a subscription for admins.
 */
export function ArchiveRegressionNotifier() {
  const { isAdmin } = useRole();

  useEffect(() => {
    if (!isAdmin) return;

    const channel = supabase
      .channel("invoice-archive-audit-admin")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "invoice_archive_audit",
        },
        (payload) => {
          const row = payload.new as {
            event_type?: string;
            invoice_number?: string | null;
            reason?: string | null;
          };
          const label = row.invoice_number ? `#${row.invoice_number}` : "فاتورة";
          switch (row.event_type) {
            case "regression_prevented":
              toast.error(`تم منع رجوع ${label} للفواتير المفتوحة`, {
                description: row.reason ?? "الفاتورة مقفولة تلقائيًا لأنها مدفوعة ومُسلَّمة بالكامل.",
                duration: 8000,
              });
              break;
            case "auto_closed":
              toast.success(`تم إغلاق ${label} تلقائيًا`, {
                description: "التدقيق التلقائي أكد اكتمال الاستلام والدفع.",
                duration: 6000,
              });
              break;
            case "unarchived":
              toast.warning(`${label} خرجت من الأرشيف`, {
                description: row.reason ?? "تحقق من سبب الرجوع.",
                duration: 6000,
              });
              break;
            default:
              break;
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  return null;
}
