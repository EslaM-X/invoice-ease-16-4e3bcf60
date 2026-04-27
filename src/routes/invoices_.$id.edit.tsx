import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { InvoiceBuilder, type BuilderItem } from "@/components/invoice-builder";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/invoices_/$id/edit")({
  component: () => (
    <AppShell>
      <EditInvoice />
    </AppShell>
  ),
});

function EditInvoice() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const { t } = useI18n();
  const [initial, setInitial] = useState<{
    customerId: string;
    items: BuilderItem[];
    discount: number;
    notes: string;
    paid_amount?: number | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: inv } = await supabase
        .from("invoices")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      const { data: items } = await supabase
        .from("invoice_items")
        .select("*")
        .eq("invoice_id", id);
      if (inv) {
        const LEGACY = ["رسوم خدمة / Service Fee", "رسوم خدمة", "Service Fee"];
        const mapped = (items ?? []).map((it: any) => {
          const isFee = !it.product_id && (LEGACY.includes(it.product_name) || it.product_name === "رسوم شحن") && Number(it.unit_price) === 250;
          return {
            product_id: it.product_id,
            product_name: isFee ? "رسوم شحن" : it.product_name,
            serial_number: it.serial_number ?? "",
            color: it.color ?? "",
            quantity: it.quantity,
            unit_price: Number(it.unit_price),
            discount: Number(it.discount),
            __isFee: isFee,
          } as any;
        });
        // Move service fee to the end so it always appears as the last line
        const nonFee = mapped.filter((m: any) => !m.__isFee).map(({ __isFee, ...r }: any) => r);
        const feeItems = mapped.filter((m: any) => m.__isFee).map(({ __isFee, ...r }: any) => r);
        setInitial({
          customerId: inv.customer_id ?? "",
          items: [...nonFee, ...feeItems],
          discount: Number(inv.discount ?? 0),
          notes: inv.notes ?? "",
          paid_amount: (inv as any).paid_amount != null ? Number((inv as any).paid_amount) : null,
        });
      }
      setLoading(false);
    })();
  }, [id, user]);

  if (loading) return <div className="text-muted-foreground">{t("loading")}</div>;
  if (!initial) return <div className="text-muted-foreground">{t("error_occurred")}</div>;

  return <InvoiceBuilder mode="edit" invoiceId={id} initial={initial} />;
}
