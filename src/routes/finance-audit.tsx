import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtDateTime, fmtMoney } from "@/lib/utils-money";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Banknote, Plus, Pencil, Trash2, FileText, Wallet, TrendingUp, TrendingDown,
  Search, Filter, ChevronDown, Receipt, AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/finance-audit")({
  component: () => (
    <AppShell>
      <FinanceAuditPage />
    </AppShell>
  ),
});

type Row = {
  id: string;
  source: "audit" | "invoice_event";
  created_at: string;
  actor_email: string | null;
  entity_type: string; // invoices | invoice_items | payments | invoices_event
  entity_id: string | null;
  action: string;      // created | updated | deleted | edited | voided
  details: any;
};

const FINANCE_ENTITIES = ["invoices", "invoice_items", "payments"];

function FinanceAuditPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [auditRows, setAuditRows] = useState<any[]>([]);
  const [eventRows, setEventRows] = useState<any[]>([]);
  const [entity, setEntity] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  const [actorQ, setActorQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const load = async () => {
    const [{ data: a }, { data: e }] = await Promise.all([
      supabase
        .from("audit_log")
        .select("*")
        .in("entity_type", FINANCE_ENTITIES)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("invoice_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    setAuditRows((a as any[]) ?? []);
    setEventRows((e as any[]) ?? []);
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);
  useRealtimeTable("audit_log", load, []);
  useRealtimeTable("invoice_events", load, []);

  const rows = useMemo<Row[]>(() => {
    const a: Row[] = auditRows.map((r) => ({
      id: `a-${r.id}`,
      source: "audit",
      created_at: r.created_at,
      actor_email: r.actor_email,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      action: r.action,
      details: r.details,
    }));
    const e: Row[] = eventRows.map((r) => ({
      id: `e-${r.id}`,
      source: "invoice_event",
      created_at: r.created_at,
      actor_email: r.details?.actor_email ?? null,
      entity_type: "invoices",
      entity_id: r.invoice_id,
      action: r.event_type,
      details: r.details,
    }));
    return [...a, ...e].sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at));
  }, [auditRows, eventRows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (entity !== "all" && r.entity_type !== entity) return false;
      if (action !== "all" && r.action !== action) return false;
      if (actorQ && !(r.actor_email ?? "").toLowerCase().includes(actorQ.toLowerCase())) return false;
      if (from && new Date(r.created_at) < new Date(from)) return false;
      if (to && new Date(r.created_at) > new Date(to + "T23:59:59")) return false;
      return true;
    });
  }, [rows, entity, action, actorQ, from, to]);

  const stats = useMemo(() => {
    let edits = 0, dels = 0, creates = 0, voids = 0, deltaSum = 0;
    for (const r of filtered) {
      if (r.action === "deleted" || r.action === "voided") dels++;
      else if (r.action === "updated" || r.action === "edited") edits++;
      else if (r.action === "created") creates++;
      if (r.action === "voided") voids++;
      const d = r.details || {};
      if (typeof d.previous_total === "number" && typeof d.total === "number") {
        deltaSum += Math.abs(d.total - d.previous_total);
      }
    }
    return { edits, dels, creates, voids, deltaSum };
  }, [filtered]);

  const toggle = (id: string) =>
    setOpenIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const entityLabel = (t: string) =>
    isAr
      ? ({ invoices: "فاتورة", invoice_items: "بند فاتورة", payments: "دفعة" } as any)[t] ?? t
      : ({ invoices: "Invoice", invoice_items: "Invoice item", payments: "Payment" } as any)[t] ?? t;

  const actionMeta = (a: string) => {
    switch (a) {
      case "created": return { label: isAr ? "إنشاء" : "Created", Icon: Plus, cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" };
      case "updated":
      case "edited":  return { label: isAr ? "تعديل" : "Edited",  Icon: Pencil, cls: "bg-amber-500/10 text-amber-700 border-amber-500/30" };
      case "deleted": return { label: isAr ? "حذف" : "Deleted",   Icon: Trash2, cls: "bg-destructive/10 text-destructive border-destructive/30" };
      case "voided":  return { label: isAr ? "إبطال" : "Voided",  Icon: AlertTriangle, cls: "bg-rose-500/10 text-rose-700 border-rose-500/40" };
      default:        return { label: a, Icon: FileText, cls: "bg-muted text-foreground" };
    }
  };

  const entityIcon = (t: string) =>
    t === "payments" ? Wallet : t === "invoice_items" ? Receipt : FileText;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5">
        <div>
          <div className="eyebrow mb-2 flex items-center gap-2 text-rose-600">
            <Banknote className="h-4 w-4" /> {isAr ? "للمدير المالي" : "Finance manager"}
          </div>
          <h1 className="display-xl text-foreground">
            {isAr ? "سجل تعديلات الفواتير" : "Invoice changes ledger"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAr
              ? "كل التعديلات والحذف والإضافات على الفواتير والبنود والدفعات، مع من قام بها ومتى وبفرق المبلغ."
              : "All edits, deletions, and additions to invoices, items, and payments — with who, when, and the money diff."}
          </p>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label={isAr ? "إنشاء" : "Created"} value={stats.creates} Icon={Plus} color="text-emerald-600" />
        <Stat label={isAr ? "تعديلات" : "Edits"} value={stats.edits} Icon={Pencil} color="text-amber-600" />
        <Stat label={isAr ? "حذف" : "Deletions"} value={stats.dels} Icon={Trash2} color="text-destructive" />
        <Stat label={isAr ? "إبطال" : "Voids"} value={stats.voids} Icon={AlertTriangle} color="text-rose-600" />
        <Stat
          label={isAr ? "إجمالي فرق المبالغ" : "Total amount delta"}
          value={fmtMoney(stats.deltaSum, "EGP", lang)}
          Icon={TrendingUp}
          color="text-primary"
        />
      </div>

      {/* Filters */}
      <div className="ios-card p-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          <Filter className="h-3.5 w-3.5" /> {isAr ? "تصفية" : "Filter"}
        </div>
        <select
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          className="rounded-lg border bg-card px-3 py-1.5 text-xs"
        >
          <option value="all">{isAr ? "كل الكيانات" : "All entities"}</option>
          {FINANCE_ENTITIES.map((e) => (
            <option key={e} value={e}>{entityLabel(e)}</option>
          ))}
        </select>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="rounded-lg border bg-card px-3 py-1.5 text-xs"
        >
          <option value="all">{isAr ? "كل الإجراءات" : "All actions"}</option>
          <option value="created">{isAr ? "إنشاء" : "Created"}</option>
          <option value="updated">{isAr ? "تعديل" : "Updated"}</option>
          <option value="edited">{isAr ? "تعديل (حدث)" : "Edited"}</option>
          <option value="deleted">{isAr ? "حذف" : "Deleted"}</option>
          <option value="voided">{isAr ? "إبطال" : "Voided"}</option>
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={actorQ}
            onChange={(e) => setActorQ(e.target.value)}
            placeholder={isAr ? "بحث بالمستخدم..." : "Search user..."}
            className="h-8 w-40 ps-7 text-xs"
          />
        </div>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-36 text-xs" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-36 text-xs" />
        <div className="ms-auto text-xs text-muted-foreground">
          {filtered.length} {isAr ? "نتيجة" : "results"}
        </div>
      </div>

      {/* List */}
      <div className="ios-card divide-y divide-border/60 overflow-hidden p-0">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {isAr ? "لا توجد عمليات تطابق الفلاتر." : "No records match the filters."}
          </div>
        ) : (
          filtered.map((r) => {
            const meta = actionMeta(r.action);
            const Icon = meta.Icon;
            const EIcon = entityIcon(r.entity_type);
            const isOpen = openIds.has(r.id);
            const d = r.details || {};
            const prev = d.previous_total ?? d.before?.total;
            const curr = d.total ?? d.after?.total;
            const hasMoney = typeof prev === "number" || typeof curr === "number";
            const delta = (typeof prev === "number" && typeof curr === "number") ? (curr - prev) : null;
            const invNo = d.invoice_number ?? d.after?.invoice_number ?? d.before?.invoice_number ?? null;
            const amount = d.amount ?? d.after?.amount ?? d.before?.amount ?? null;
            return (
              <div key={r.id} className="px-4 py-3">
                <button
                  onClick={() => toggle(r.id)}
                  className="flex w-full items-start justify-between gap-3 text-start"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${meta.cls}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="inline-flex items-center gap-1">
                          <EIcon className="h-3.5 w-3.5 text-muted-foreground" />
                          {entityLabel(r.entity_type)}
                        </span>
                        <Badge variant="outline" className={`text-[10px] ${meta.cls}`}>{meta.label}</Badge>
                        {invNo && (
                          <Link
                            to="/invoices/$id"
                            params={{ id: r.entity_id ?? "" }}
                            className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {invNo}
                          </Link>
                        )}
                        {amount != null && r.entity_type === "payments" && (
                          <span className="font-mono text-xs">{fmtMoney(Number(amount), "EGP", lang)}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.actor_email ?? "—"} · {fmtDateTime(r.created_at, lang)}
                      </div>
                      {hasMoney && delta !== null && delta !== 0 && (
                        <div className={`inline-flex items-center gap-1 text-xs font-semibold ${delta > 0 ? "text-emerald-600" : "text-destructive"}`}>
                          {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {delta > 0 ? "+" : ""}{fmtMoney(delta, "EGP", lang)}
                          <span className="text-muted-foreground font-normal">
                            ({fmtMoney(Number(prev), "EGP", lang)} → {fmtMoney(Number(curr), "EGP", lang)})
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <pre className="mt-3 ms-12 overflow-x-auto rounded-lg border bg-muted/40 p-3 text-[11px] leading-relaxed">
                    {JSON.stringify(r.details, null, 2)}
                  </pre>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Stat({
  label, value, Icon, color,
}: { label: string; value: string | number; Icon: any; color: string }) {
  return (
    <div className="ios-card p-3">
      <div className="flex items-center justify-between">
        <div className="eyebrow text-[0.6rem]">{label}</div>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div className={`mt-2 text-xl font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
