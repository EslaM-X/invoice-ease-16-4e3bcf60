import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { DeliveryReceiptForm } from "@/components/delivery-receipt-form";

type Search = { invoiceId?: string };

export const Route = createFileRoute("/delivery-receipts/new")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    invoiceId: typeof s.invoiceId === "string" ? s.invoiceId : undefined,
  }),
  component: () => <AppShell><NewReceipt /></AppShell>,
});

function NewReceipt() {
  const { invoiceId } = Route.useSearch();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const navigate = useNavigate();
  const [picked, setPicked] = useState<string | undefined>(invoiceId);
  const [list, setList] = useState<any[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (picked) return;
    (async () => {
      const { data } = await supabase
        .from("invoices")
        .select("id, invoice_number, customer_name, total, delivery_status, status, created_at")
        .not("status", "in", "(voided,draft)")
        .neq("delivery_status", "delivered")
        .order("created_at", { ascending: false })
        .limit(200);
      setList(data ?? []);
    })();
  }, [picked]);

  if (picked) {
    return <DeliveryReceiptForm mode="new" invoiceId={picked} />;
  }

  const filtered = list.filter((i) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      i.invoice_number?.toLowerCase().includes(s) ||
      i.customer_name?.toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link to="/delivery-receipts">
          <Button variant="ghost" className="gap-2 rounded-full">
            <ArrowLeft className="h-4 w-4" /> {isAr ? "محاضر الاستلام" : "Receipts"}
          </Button>
        </Link>
      </div>
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">{isAr ? "اختر فاتورة لإنشاء محضر" : "Pick an invoice"}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {isAr ? "تعرض فقط الفواتير غير الملغاة وغير المسلَّمة بالكامل." : "Only non-voided & not fully delivered invoices."}
        </p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={isAr ? "ابحث…" : "Search…"}
          className="mt-3 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        />
        <div className="mt-4 max-h-[60vh] divide-y overflow-y-auto rounded-lg border">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">{isAr ? "لا توجد فواتير" : "No invoices"}</div>
          ) : (
            filtered.map((i) => (
              <button
                key={i.id}
                onClick={() => {
                  setPicked(i.id);
                  navigate({ to: "/delivery-receipts/new", search: { invoiceId: i.id } });
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-muted/50"
              >
                <div>
                  <div className="font-mono text-sm font-medium">{i.invoice_number}</div>
                  <div className="text-xs text-muted-foreground">{i.customer_name || "—"}</div>
                </div>
                <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase">
                  {i.delivery_status === "partial" ? (isAr ? "جزئي" : "Partial") : (isAr ? "لم يُسلَّم" : "Pending")}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
