import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { FilePen, Inbox, Loader2, ExternalLink, CheckCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useRealtimeTable } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n";
import { fmtDateTime, fmtMoney } from "@/lib/utils-money";
import { toast } from "sonner";

/**
 * Dedicated invoice-edit notification bell.
 * Distinct from the generic notifications bell — a pulsing pen-on-paper icon
 * with a red ring, designed for the finance manager to spot invoice edits
 * the instant they happen. Each entry deep-links straight to the invoice.
 */

type EditRow = {
  id: string;
  invoice_id: string;
  invoice_number: string | null;
  customer: string | null;
  actor: string | null;
  created_at: string;
  prev_total: number | null;
  new_total: number | null;
  delta: number | null;
  source: "event" | "audit";
};

const SEEN_KEY = "invoice_edits_bell_seen_at_v1";

function readSeenAt(): number {
  if (typeof window === "undefined") return 0;
  const v = Number(window.localStorage.getItem(SEEN_KEY));
  return Number.isFinite(v) ? v : 0;
}
function writeSeenAt(ts: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SEEN_KEY, String(ts));
}

export function InvoiceEditsBell() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [items, setItems] = useState<EditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<number>(() => readSeenAt());

  const load = async () => {
    setLoading(true);
    const [{ data: events }, { data: audits }] = await Promise.all([
      supabase
        .from("invoice_events")
        .select("id,invoice_id,event_type,details,created_at")
        .eq("event_type", "edited")
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("audit_log")
        .select("id,entity_id,entity_type,action,actor_email,details,created_at")
        .eq("entity_type", "invoices")
        .eq("action", "updated")
        .order("created_at", { ascending: false })
        .limit(40),
    ]);

    const merged: EditRow[] = [];
    const byKey = new Map<string, EditRow>(); // dedupe key: invoice_id + minute bucket

    const keyFor = (id: string, ts: string) =>
      `${id}|${Math.floor(new Date(ts).getTime() / 30000)}`; // 30s window

    for (const e of (events ?? []) as any[]) {
      const d = e.details ?? {};
      const prev = num(d.previous_total ?? d.before?.total);
      const next = num(d.total ?? d.after?.total);
      const row: EditRow = {
        id: `e-${e.id}`,
        invoice_id: e.invoice_id,
        invoice_number: d.invoice_number ?? d.after?.invoice_number ?? null,
        customer: d.customer_name ?? d.after?.customer_name ?? null,
        actor: d.actor_email ?? null,
        created_at: e.created_at,
        prev_total: prev,
        new_total: next,
        delta: prev != null && next != null ? next - prev : null,
        source: "event",
      };
      const k = keyFor(e.invoice_id, e.created_at);
      byKey.set(k, row);
      merged.push(row);
    }
    for (const a of (audits ?? []) as any[]) {
      const k = keyFor(a.entity_id, a.created_at);
      if (byKey.has(k)) continue; // already covered by invoice_event
      const d = a.details ?? {};
      const before = d.before ?? {};
      const after = d.after ?? d ?? {};
      const prev = num(before.total);
      const next = num(after.total);
      merged.push({
        id: `a-${a.id}`,
        invoice_id: a.entity_id,
        invoice_number: after.invoice_number ?? before.invoice_number ?? null,
        customer: after.customer_name ?? before.customer_name ?? null,
        actor: a.actor_email,
        created_at: a.created_at,
        prev_total: prev,
        new_total: next,
        delta: prev != null && next != null ? next - prev : null,
        source: "audit",
      });
    }
    merged.sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at));
    setItems(merged.slice(0, 30));
    setLoading(false);
  };

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  useRealtimeTable("invoice_events", load);
  useRealtimeTable("audit_log", load);

  const unseen = useMemo(() => {
    const cutoff = seenAt;
    return items.filter((i) => +new Date(i.created_at) > cutoff).length;
  }, [items, seenAt]);

  const markAllSeen = () => {
    const now = Date.now();
    writeSeenAt(now);
    setSeenAt(now);
    toast.success(isAr ? "تم وضع علامة كمقروء" : "Marked as seen");
  };

  if (!user) return null;
  const hasUnseen = unseen > 0;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && hasUnseen) {
          // Defer mark-as-seen so the user sees the highlights first.
          setTimeout(() => {
            const now = Date.now();
            writeSeenAt(now);
            setSeenAt(now);
          }, 1500);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={isAr ? "تعديلات الفواتير" : "Invoice edits"}
          title={isAr ? "تعديلات الفواتير الأخيرة" : "Recent invoice edits"}
          className={`relative rounded-full press-spring ${
            hasUnseen ? "text-rose-600 dark:text-rose-400" : ""
          }`}
        >
          <FilePen
            className={`h-4 w-4 ${
              hasUnseen
                ? "animate-[wiggle_1.4s_ease-in-out_infinite] drop-shadow-[0_0_6px_rgba(244,63,94,0.55)]"
                : ""
            }`}
          />
          {hasUnseen && (
            <>
              <span className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-rose-500/40 animate-ping" />
              <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-[0_0_0_2px_hsl(var(--background)),0_4px_10px_-2px_rgba(244,63,94,.7)] ring-1 ring-white/30 bg-gradient-to-br from-rose-400 via-rose-500 to-rose-600 animate-pulse">
                {unseen > 9 ? "9+" : unseen}
              </span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[380px] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-gradient-to-r from-rose-500/10 via-transparent to-transparent px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2 text-sm font-bold">
            <FilePen className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span className="truncate">
              {isAr ? "تعديلات الفواتير" : "Invoice edits"}
            </span>
            {hasUnseen && (
              <span className="shrink-0 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {unseen}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Link to="/finance-audit" onClick={() => setOpen(false)}>
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]">
                <ExternalLink className="h-3 w-3" />
                {isAr ? "السجل الكامل" : "Full log"}
              </Button>
            </Link>
            {hasUnseen && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-[11px]"
                onClick={markAllSeen}
              >
                <CheckCheck className="h-3 w-3" />
                {isAr ? "قرأت الكل" : "Mark all"}
              </Button>
            )}
          </div>
        </div>
        <div className="max-h-[440px] overflow-y-auto">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <Inbox className="h-8 w-8 opacity-40" />
              {isAr ? "لا توجد تعديلات حتى الآن" : "No invoice edits yet"}
            </div>
          ) : (
            items.map((n) => {
              const ts = +new Date(n.created_at);
              const fresh = ts > seenAt;
              const deltaPositive = (n.delta ?? 0) > 0;
              const deltaNegative = (n.delta ?? 0) < 0;
              return (
                <Link
                  key={n.id}
                  to="/invoices/$id"
                  params={{ id: n.invoice_id }}
                  onClick={() => setOpen(false)}
                  className={`block border-b border-border/40 px-4 py-3 transition hover:bg-muted/40 ${
                    fresh ? "bg-rose-500/5" : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                        deltaPositive
                          ? "bg-emerald-500/10 text-emerald-600"
                          : deltaNegative
                            ? "bg-destructive/10 text-destructive"
                            : "bg-amber-500/10 text-amber-600"
                      }`}
                    >
                      <FilePen className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className={`truncate text-sm ${fresh ? "font-bold" : "font-semibold"}`}>
                          {isAr ? "تم تعديل فاتورة" : "Invoice edited"}
                        </span>
                        {n.invoice_number && (
                          <span className="font-mono text-xs text-primary">{n.invoice_number}</span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {n.customer || (isAr ? "عميل نقدي" : "Walk-in")}
                        {n.actor ? ` · ${n.actor}` : ""}
                      </div>
                      {n.delta != null && n.delta !== 0 && (
                        <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[11px]">
                          <span className="text-muted-foreground">
                            {isAr ? "قبل" : "Before"}:
                          </span>
                          <span className="font-medium tabular-nums">
                            {fmtMoney(n.prev_total ?? 0, "EGP", lang)}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className="font-medium tabular-nums">
                            {fmtMoney(n.new_total ?? 0, "EGP", lang)}
                          </span>
                          <span
                            className={`ms-1 rounded px-1.5 py-0.5 font-bold tabular-nums ${
                              deltaPositive
                                ? "bg-emerald-500/15 text-emerald-700"
                                : "bg-destructive/15 text-destructive"
                            }`}
                          >
                            {deltaPositive ? "+" : ""}
                            {fmtMoney(n.delta, "EGP", lang)}
                          </span>
                        </div>
                      )}
                      <div className="mt-1 text-[10px] tabular-nums text-muted-foreground">
                        {fmtDateTime(n.created_at, lang)}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function num(v: any): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
