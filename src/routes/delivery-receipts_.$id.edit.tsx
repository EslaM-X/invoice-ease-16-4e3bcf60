import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { DeliveryReceiptForm } from "@/components/delivery-receipt-form";

export const Route = createFileRoute("/delivery-receipts_/$id/edit")({
  component: () => <AppShell><EditReceipt /></AppShell>,
});

function EditReceipt() {
  const { id } = Route.useParams();
  const { lang } = useI18n();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { data: r } = await supabase.from("delivery_receipts" as any).select("*").eq("id", id).single();
      const { data: its } = await supabase.from("delivery_receipt_items" as any).select("*").eq("receipt_id", id);
      setData({ receipt: r, items: its ?? [] });
    })();
  }, [id]);

  if (!data?.receipt) return <div className="text-muted-foreground">{lang === "ar" ? "جاري التحميل…" : "Loading…"}</div>;

  return (
    <DeliveryReceiptForm
      mode="edit"
      invoiceId={data.receipt.invoice_id}
      receiptId={id}
      existing={{
        ...data.receipt,
        items: data.items.map((i: any) => ({
          invoice_item_id: i.invoice_item_id,
          quantity: i.quantity,
          note: i.note,
          product_name: i.product_name,
          serial_number: i.serial_number,
          color: i.color,
        })),
      }}
    />
  );
}
