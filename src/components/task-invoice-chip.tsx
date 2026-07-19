import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileText, Wrench, User as UserIcon, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export type LinkedInvoiceMini = {
  id: string;
  invoice_number: string | null;
  customer_name: string | null;
  status: string | null;
};

const cache = new Map<string, LinkedInvoiceMini | null>();
const pending = new Map<string, Promise<LinkedInvoiceMini | null>>();

async function fetchInvoiceMini(id: string): Promise<LinkedInvoiceMini | null> {
  if (cache.has(id)) return cache.get(id)!;
  if (pending.has(id)) return pending.get(id)!;
  const p = (async () => {
    const { data } = await supabase
      .from("invoices")
      .select("id, invoice_number, customer_name, status")
      .eq("id", id)
      .maybeSingle();
    const row = (data as LinkedInvoiceMini | null) ?? null;
    cache.set(id, row);
    pending.delete(id);
    return row;
  })();
  pending.set(id, p);
  return p;
}

/** Compact chip shown on a task row / detail: invoice # + open|closed badge + DR count. */
export function TaskInvoiceChip({
  invoiceId,
  drCount,
  isAr,
  size = "sm",
  asLink = true,
}: {
  invoiceId: string;
  drCount?: number;
  isAr: boolean;
  size?: "xs" | "sm";
  asLink?: boolean;
}) {
  const [inv, setInv] = useState<LinkedInvoiceMini | null | undefined>(cache.get(invoiceId));

  useEffect(() => {
    let alive = true;
    if (inv === undefined) {
      fetchInvoiceMini(invoiceId).then((r) => { if (alive) setInv(r); });
    }
    return () => { alive = false; };
  }, [invoiceId]);

  if (inv === undefined) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full bg-muted/50 px-2 py-0.5 ${size === "xs" ? "text-[10px]" : "text-xs"} text-muted-foreground`}>
        <FileText className="h-3 w-3" />
        …
      </span>
    );
  }
  if (inv === null) return null;

  const closed = inv.status === "completed";
  const badgeAr = closed ? "خدمة ما بعد البيع" : "عميل";
  const badgeEn = closed ? "After-sales" : "Customer";
  const BadgeIcon = closed ? Wrench : UserIcon;

  const textSize = size === "xs" ? "text-[10px]" : "text-[11px]";
  const inner = (
    <span className={`inline-flex items-center gap-1 flex-wrap ${textSize} font-medium`}>
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 ring-1 ring-primary/20 tabular-nums">
        <FileText className="h-3 w-3" />
        {inv.invoice_number || inv.id.slice(0, 6)}
      </span>
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ring-1 ${
          closed
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30"
            : "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30"
        }`}
      >
        <BadgeIcon className="h-3 w-3" />
        {isAr ? badgeAr : badgeEn}
      </span>
      {drCount ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 text-muted-foreground px-2 py-0.5 ring-1 ring-border tabular-nums">
          <Truck className="h-3 w-3" />
          {drCount}
        </span>
      ) : null}
    </span>
  );

  if (!asLink) return inner;
  return (
    <Link
      to="/invoices/$id"
      params={{ id: invoiceId }}
      onClick={(e) => e.stopPropagation()}
      className="hover:opacity-80 transition-opacity"
      aria-label={isAr ? `فتح الفاتورة ${inv.invoice_number ?? ""}` : `Open invoice ${inv.invoice_number ?? ""}`}
    >
      {inner}
    </Link>
  );
}

export function invoiceIsClosed(status: string | null | undefined) {
  return status === "completed";
}
