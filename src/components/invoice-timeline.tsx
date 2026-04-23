import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/utils-money";
import { CheckCircle2, Pencil, Ban } from "lucide-react";

type Event = {
  id: string;
  event_type: "created" | "edited" | "voided" | "restored";
  details: any;
  created_at: string;
};

const ICONS = {
  created: CheckCircle2,
  edited: Pencil,
  voided: Ban,
  restored: CheckCircle2,
};

const COLORS = {
  created: "text-success",
  edited: "text-primary",
  voided: "text-destructive",
  restored: "text-success",
};

export function InvoiceTimeline({ invoiceId }: { invoiceId: string }) {
  const { t, lang } = useI18n();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("invoice_events" as any)
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("created_at", { ascending: true });
      setEvents((data as any) ?? []);
      setLoading(false);
    })();
  }, [invoiceId]);

  if (loading || events.length === 0) return null;

  const labelFor = (type: Event["event_type"]) => {
    if (type === "created") return t("event_created");
    if (type === "edited") return t("event_edited");
    if (type === "voided") return t("event_voided");
    return type;
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 no-print">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {t("timeline")}
      </h3>
      <ol className="relative space-y-4 ps-6">
        <span className="absolute start-2 top-2 bottom-2 w-px bg-border/60" />
        {events.map((ev) => {
          const Icon = ICONS[ev.event_type] ?? CheckCircle2;
          const color = COLORS[ev.event_type] ?? "text-muted-foreground";
          return (
            <li key={ev.id} className="relative">
              <span className={`absolute -start-[18px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background ring-2 ring-border ${color}`}>
                <Icon className="h-3 w-3" />
              </span>
              <div className="text-sm font-medium">{labelFor(ev.event_type)}</div>
              <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {fmtDateTime(ev.created_at, lang)}
              </div>
              {ev.details?.total !== undefined && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {lang === "ar" ? "الإجمالي" : "Total"}: {Number(ev.details.total).toFixed(2)} EGP
                  {ev.details.previous_total !== undefined && ev.event_type === "edited" && (
                    <span className="ms-2 text-muted-foreground/70">
                      ({lang === "ar" ? "كان" : "was"} {Number(ev.details.previous_total).toFixed(2)})
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
