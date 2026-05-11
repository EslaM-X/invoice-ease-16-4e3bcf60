import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { InvoiceBuilder, type BuilderItem } from "@/components/invoice-builder";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";

export const Route = createFileRoute("/invoices_/$id/edit")({
  component: () => (
    <AppShell>
      <EditInvoice />
    </AppShell>
  ),
});

const LEGACY_FEE = ["رسوم خدمة / Service Fee", "رسوم خدمة", "Service Fee"];

function EditInvoice() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const { t } = useI18n();
  const [initial, setInitial] = useState<{
    customerId: string;
    items: BuilderItem[];
    discount: number;
    notes: string;
    system_notes?: string;
    paid_amount?: number | null;
    delivery_status?: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [snapshotKey, setSnapshotKey] = useState(0);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data: inv } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    const { data: items } = await supabase
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", id)
      .order("created_at", { ascending: true });

    if (!inv) {
      setInitial(null);
      setLoading(false);
      return;
    }

    const mapped = (items ?? []).map((it: any) => {
      const isFee =
        !it.product_id &&
        (LEGACY_FEE.includes(it.product_name) || it.product_name === "رسوم شحن") &&
        Number(it.unit_price) === 250;
      return {
        product_id: it.product_id,
        product_name: isFee ? "رسوم شحن" : it.product_name,
        serial_number: it.serial_number ?? "",
        color: it.color ?? "",
        quantity: it.quantity,
        unit_price: Number(it.unit_price),
        discount: Number(it.discount),
        __isFee: isFee,
      };
    });

    const nonFee = mapped
      .filter((m: any) => !m.__isFee)
      .map(({ __isFee, ...r }: any) => r);
    const feeItems = mapped
      .filter((m: any) => m.__isFee)
      .map(({ __isFee, ...r }: any) => r);

    const invAny = inv as any;
    setInitial({
      customerId: inv.customer_id ?? "",
      items: [...nonFee, ...feeItems],
      discount: Number(inv.discount ?? 0),
      notes: inv.notes ?? "",
      system_notes: invAny.system_notes ?? "",
      paid_amount: invAny.paid_amount != null ? Number(invAny.paid_amount) : null,
    });
    setSnapshotKey((k) => k + 1);
    setLoading(false);
  }, [id, user]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  useEffect(() => {
    const onFocus = () => setReloadKey((k) => k + 1);
    const onVisible = () => {
      if (document.visibilityState === "visible") setReloadKey((k) => k + 1);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useRealtimeTable(
    "invoices",
    (p) => {
      if (p.new?.id === id || p.old?.id === id) setReloadKey((k) => k + 1);
    },
    [id],
  );
  useRealtimeTable(
    "invoice_items",
    (p) => {
      if (p.new?.invoice_id === id || p.old?.invoice_id === id) setReloadKey((k) => k + 1);
    },
    [id],
  );

  if (loading && !initial) return <div className="text-muted-foreground">{t("loading")}</div>;
  if (!initial) return <div className="text-muted-foreground">{t("error_occurred")}</div>;

  return <InvoiceBuilder key={`${id}-${snapshotKey}`} mode="edit" invoiceId={id} initial={initial} />;
}
