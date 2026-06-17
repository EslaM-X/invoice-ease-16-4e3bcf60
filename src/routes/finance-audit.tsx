/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Banknote,
  ChevronDown,
  FileText,
  Filter,
  Pencil,
  Plus,
  Receipt,
  Search,
  Trash2,
  Wallet,
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
  entity_type: string;
  entity_id: string | null;
  action: string;
  details: any;
};

const FINANCE_ENTITIES = ["invoices", "invoice_items", "payments"];

function FinanceAuditPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [auditRows, setAuditRows] = useState<any[]>([]);
  const [eventRows, setEventRows] = useState<any[]>([]);
  const [productMap, setProductMap] = useState<
    Record<string, { name: string; image_url: string | null; color: string | null; serial_number: string | null }>
  >({});
  const [entity, setEntity] = useState("all");
  const [action, setAction] = useState("all");
  const [q, setQ] = useState("");
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

    // Collect product_ids referenced in invoice_items rows to enrich the view.
    const pids = new Set<string>();
    for (const r of (a as any[]) ?? []) {
      if (r.entity_type !== "invoice_items") continue;
      const d = r.details ?? {};
      const pid = d.product_id ?? d.after?.product_id ?? d.before?.product_id;
      if (pid) pids.add(pid);
    }
    if (pids.size > 0) {
      const { data: prods } = await supabase
        .from("products")
        .select("id,name,image_url,color,serial_number")
        .in("id", Array.from(pids));
      const map: Record<string, any> = {};
      for (const p of (prods as any[]) ?? []) map[p.id] = p;
      setProductMap(map);
    }
  };

  useEffect(() => {
    if (user) load();
  }, [user]);
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
    // Deduplicate: when both an `invoice_events` row and an `audit_log` row
    // describe the same invoice change within a 30-second window, keep only
    // the invoice_event one (richer, finance-friendly payload).
    const eventKeys = new Set(
      e
        .filter((r) => normalizedAction(r.action) === "edited" && r.entity_id)
        .map(
          (r) => `${r.entity_id}|${Math.floor(+new Date(r.created_at) / 30000)}`,
        ),
    );
    const filteredAudit = a.filter((r) => {
      if (r.entity_type !== "invoices") return true;
      if (normalizedAction(r.action) !== "edited") return true;
      if (!r.entity_id) return true;
      const k = `${r.entity_id}|${Math.floor(+new Date(r.created_at) / 30000)}`;
      return !eventKeys.has(k);
    });
    return [...filteredAudit, ...e].sort(
      (x, y) => +new Date(y.created_at) - +new Date(x.created_at),
    );
  }, [auditRows, eventRows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (entity !== "all" && r.entity_type !== entity) return false;
      if (action !== "all" && normalizedAction(r.action) !== action) return false;
      if (from && new Date(r.created_at) < new Date(from)) return false;
      if (to && new Date(r.created_at) > new Date(to + "T23:59:59")) return false;
      if (!term) return true;
      const summary = describeRow(r, isAr, lang).searchText.toLowerCase();
      return summary.includes(term);
    });
  }, [rows, entity, action, q, from, to, isAr, lang]);

  const stats = useMemo(() => {
    const out = { created: 0, edited: 0, deleted: 0, voided: 0, moneyDelta: 0 };
    for (const r of filtered) {
      const n = normalizedAction(r.action);
      if (n === "created") out.created++;
      if (n === "edited") out.edited++;
      if (n === "deleted") out.deleted++;
      if (n === "voided") out.voided++;
      out.moneyDelta += Math.abs(describeRow(r, isAr, lang).delta ?? 0);
    }
    return out;
  }, [filtered, isAr, lang]);

  const toggle = (id: string) =>
    setOpenIds((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-6">
      <header className="border-b border-border pb-5">
        <div className="eyebrow mb-2 flex items-center gap-2 text-primary">
          <Banknote className="h-4 w-4" /> {isAr ? "عرض مالي واضح" : "Clear finance view"}
        </div>
        <h1 className="display-xl text-foreground">
          {isAr ? "سجل تعديلات الفواتير" : "Invoice changes ledger"}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {isAr
            ? "ملخص مفهوم لكل إضافة أو تعديل أو حذف في الفواتير والبنود والدفعات، بدون بيانات تقنية مربكة."
            : "Plain-language history for invoice, item, and payment additions, edits, and deletions — without raw technical data."}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={isAr ? "إضافات" : "Added"} value={stats.created} tone="emerald" Icon={Plus} />
        <Stat label={isAr ? "تعديلات" : "Edited"} value={stats.edited} tone="amber" Icon={Pencil} />
        <Stat label={isAr ? "حذف" : "Deleted"} value={stats.deleted} tone="rose" Icon={Trash2} />
        <Stat
          label={isAr ? "إلغاء" : "Voided"}
          value={stats.voided}
          tone="rose"
          Icon={AlertTriangle}
        />
        <Stat
          label={isAr ? "فرق المبالغ" : "Money diff"}
          value={fmtMoney(stats.moneyDelta, "EGP", lang)}
          tone="primary"
          Icon={Banknote}
        />
      </div>

      <div className="ios-card flex flex-wrap items-center gap-2 p-4">
        <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          {isAr ? "فلترة" : "Filters"}
        </div>
        <select
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          className="rounded-lg border bg-card px-3 py-1.5 text-xs"
        >
          <option value="all">{isAr ? "كل الأنواع" : "All types"}</option>
          <option value="invoices">{isAr ? "الفواتير" : "Invoices"}</option>
          <option value="invoice_items">{isAr ? "بنود الفواتير" : "Invoice items"}</option>
          <option value="payments">{isAr ? "الدفعات" : "Payments"}</option>
        </select>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="rounded-lg border bg-card px-3 py-1.5 text-xs"
        >
          <option value="all">{isAr ? "كل العمليات" : "All actions"}</option>
          <option value="created">{isAr ? "إضافة" : "Added"}</option>
          <option value="edited">{isAr ? "تعديل" : "Edited"}</option>
          <option value="deleted">{isAr ? "حذف" : "Deleted"}</option>
          <option value="voided">{isAr ? "إلغاء" : "Voided"}</option>
        </select>
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              isAr ? "بحث برقم الفاتورة، المنتج، المستخدم…" : "Search invoice, product, user…"
            }
            className="h-8 ps-7 text-xs"
          />
        </div>
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-8 w-36 text-xs"
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-8 w-36 text-xs"
        />
        <div className="text-xs text-muted-foreground">
          {filtered.length} {isAr ? "عملية" : "records"}
        </div>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="ios-card py-16 text-center text-sm text-muted-foreground">
            {isAr ? "لا توجد عمليات تطابق الفلاتر." : "No records match the filters."}
          </div>
        ) : (
          filtered.map((r) => {
            const d = describeRow(r, isAr, lang);
            const meta = actionMeta(normalizedAction(r.action), isAr);
            const Icon = meta.Icon;
            const isOpen = openIds.has(r.id);
            const det = r.details ?? {};
            const pid =
              det.product_id ?? det.after?.product_id ?? det.before?.product_id ?? null;
            const product = pid ? productMap[pid] : null;
            const itemColor =
              det.after?.color ?? det.before?.color ?? det.color ?? product?.color ?? null;
            const itemSerial =
              det.after?.serial_number ??
              det.before?.serial_number ??
              det.serial_number ??
              product?.serial_number ??
              null;
            const itemQty = det.after?.quantity ?? det.before?.quantity ?? det.quantity ?? null;
            const positive = (d.delta ?? 0) > 0;
            const negative = (d.delta ?? 0) < 0;
            return (
              <article key={r.id} className="ios-card overflow-hidden p-0">
                <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start">
                  <span
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border ${meta.cls}`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={meta.cls}>
                        {meta.label}
                      </Badge>
                      <Badge variant="outline" className="bg-muted/50">
                        {d.entityLabel}
                      </Badge>
                      {d.invoiceNumber && r.entity_id && (
                        <Link
                          to="/invoices/$id"
                          params={{ id: r.entity_id }}
                          className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                        >
                          {d.invoiceNumber}
                        </Link>
                      )}
                    </div>
                    <h2 className="text-sm font-semibold text-foreground">{d.title}</h2>
                    <p className="text-xs leading-relaxed text-muted-foreground">{d.subtitle}</p>

                    {(product || itemSerial || itemColor || itemQty != null) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2">
                        {product?.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product?.name ?? ""}
                            className="h-10 w-10 shrink-0 rounded-md border object-cover"
                          />
                        ) : (
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground">
                            <Receipt className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1 text-xs">
                          <div className="truncate font-medium">
                            {product?.name ?? det.after?.product_name ?? det.before?.product_name ?? det.product_name ?? "—"}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                            {itemSerial && (
                              <span className="rounded bg-background px-1.5 py-0.5 font-mono">
                                S/N {itemSerial}
                              </span>
                            )}
                            {itemColor && (
                              <span className="rounded bg-background px-1.5 py-0.5">
                                {isAr ? "اللون" : "Color"}: {itemColor}
                              </span>
                            )}
                            {itemQty != null && (
                              <span className="rounded bg-background px-1.5 py-0.5 tabular-nums">
                                {isAr ? "الكمية" : "Qty"}: {itemQty}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {d.delta != null && d.delta !== 0 && (
                      <div
                        className={`mt-2 flex flex-wrap items-center gap-2 rounded-xl border-2 px-3 py-2 ${
                          positive
                            ? "border-emerald-500/40 bg-emerald-500/5"
                            : "border-destructive/40 bg-destructive/5"
                        }`}
                      >
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            positive
                              ? "bg-emerald-500/15 text-emerald-700"
                              : "bg-destructive/15 text-destructive"
                          }`}
                        >
                          {positive
                            ? isAr ? "زيادة" : "Increase"
                            : isAr ? "نقصان" : "Decrease"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {isAr ? "قبل" : "Before"}:
                        </span>
                        <span className="text-sm font-semibold tabular-nums">
                          {fmtMoney(numberOrNull(r.details?.previous_total ?? r.details?.before?.total) ?? 0, "EGP", lang)}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-xs text-muted-foreground">
                          {isAr ? "بعد" : "After"}:
                        </span>
                        <span className="text-sm font-semibold tabular-nums">
                          {fmtMoney(numberOrNull(r.details?.total ?? r.details?.after?.total) ?? 0, "EGP", lang)}
                        </span>
                        <span
                          className={`ms-auto rounded-lg px-2.5 py-1 text-base font-extrabold tabular-nums shadow-sm ${
                            positive
                              ? "bg-emerald-500 text-white"
                              : "bg-destructive text-destructive-foreground"
                          }`}
                        >
                          {positive ? "+" : ""}
                          {fmtMoney(d.delta, "EGP", lang)}
                        </span>
                      </div>
                    )}

                    {d.changes.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {d.changes.slice(0, 5).map((c) => (
                          <span
                            key={c}
                            className="rounded-md border bg-muted/40 px-2 py-1 text-[11px]"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground sm:col-span-1 sm:min-w-[180px] sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
                    <div className="min-w-0">
                      <div className="truncate">
                        {r.actor_email || (isAr ? "مستخدم غير معروف" : "Unknown user")}
                      </div>
                      <div className="tabular-nums">{fmtDateTime(r.created_at, lang)}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      {r.entity_id && (
                        <Link to="/invoices/$id" params={{ id: r.entity_id }}>
                          <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]">
                            <FileText className="h-3.5 w-3.5" />
                            {isAr ? "فتح" : "Open"}
                          </Button>
                        </Link>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-[11px]"
                        onClick={() => toggle(r.id)}
                      >
                        {isOpen
                          ? isAr ? "إخفاء" : "Hide"
                          : isAr ? "تفاصيل" : "Details"}
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                        />
                      </Button>
                    </div>
                  </div>
                </div>
                {isOpen && <DetailsPanel row={r} isAr={isAr} lang={lang} />}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}

function normalizedAction(action: string) {
  if (["updated", "edited", "invoice_updated", "po_items_updated"].includes(action))
    return "edited";
  if (["deleted", "removed"].includes(action)) return "deleted";
  if (["voided", "cancelled"].includes(action)) return "voided";
  if (["created", "added"].includes(action)) return "created";
  return action;
}

function actionMeta(action: string, isAr: boolean) {
  switch (action) {
    case "created":
      return {
        label: isAr ? "إضافة" : "Added",
        Icon: Plus,
        cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
      };
    case "edited":
      return {
        label: isAr ? "تعديل" : "Edited",
        Icon: Pencil,
        cls: "border-amber-500/30 bg-amber-500/10 text-amber-700",
      };
    case "deleted":
      return {
        label: isAr ? "حذف" : "Deleted",
        Icon: Trash2,
        cls: "border-destructive/30 bg-destructive/10 text-destructive",
      };
    case "voided":
      return {
        label: isAr ? "إلغاء" : "Voided",
        Icon: AlertTriangle,
        cls: "border-rose-500/40 bg-rose-500/10 text-rose-700",
      };
    default:
      return { label: action, Icon: FileText, cls: "border-border bg-muted text-foreground" };
  }
}

function describeRow(row: Row, isAr: boolean, lang: "ar" | "en") {
  const d = row.details ?? {};
  const before = d.before ?? d.old ?? d.previous ?? {};
  const after = d.after ?? d.new ?? d.current ?? {};
  const invNo =
    d.invoice_number ??
    after.invoice_number ??
    before.invoice_number ??
    d.invoice?.invoice_number ??
    null;
  const customer =
    d.customer_name ??
    after.customer_name ??
    before.customer_name ??
    d.invoice?.customer_name ??
    null;
  const product = d.product_name ?? after.product_name ?? before.product_name ?? d.name ?? null;
  const amount = numberOrNull(d.amount ?? after.amount ?? before.amount);
  const prevTotal = numberOrNull(
    d.previous_total ?? before.total ?? before.line_total ?? before.amount,
  );
  const currTotal = numberOrNull(d.total ?? after.total ?? after.line_total ?? after.amount);
  const delta = prevTotal != null && currTotal != null ? currTotal - prevTotal : null;
  const entityLabel = entityLabelFor(row.entity_type, isAr);
  const changes = collectChanges(before, after, isAr, lang);
  const action = normalizedAction(row.action);

  let title = "";
  let subtitle = "";
  if (row.entity_type === "payments") {
    title =
      action === "deleted"
        ? isAr
          ? "تم حذف دفعة"
          : "Payment was deleted"
        : action === "created"
          ? isAr
            ? "تم تسجيل دفعة"
            : "Payment was added"
          : isAr
            ? "تم تعديل دفعة"
            : "Payment was edited";
    subtitle = `${amount != null ? fmtMoney(amount, "EGP", lang) : isAr ? "قيمة غير محددة" : "No amount"} ${invNo ? `· ${invNo}` : ""}`;
  } else if (row.entity_type === "invoice_items") {
    title =
      action === "deleted"
        ? isAr
          ? "تم حذف بند من فاتورة"
          : "Invoice item was deleted"
        : action === "created"
          ? isAr
            ? "تم إضافة بند لفاتورة"
            : "Invoice item was added"
          : isAr
            ? "تم تعديل بند في فاتورة"
            : "Invoice item was edited";
    subtitle =
      [product, invNo, customer].filter(Boolean).join(" · ") ||
      (isAr ? "بند فاتورة" : "Invoice item");
  } else {
    title =
      action === "deleted"
        ? isAr
          ? "تم حذف فاتورة"
          : "Invoice was deleted"
        : action === "voided"
          ? isAr
            ? "تم إلغاء فاتورة"
            : "Invoice was voided"
          : action === "created"
            ? isAr
              ? "تم إنشاء فاتورة"
              : "Invoice was created"
            : isAr
              ? "تم تعديل بيانات فاتورة"
              : "Invoice details were edited";
    subtitle =
      [invNo, customer, currTotal != null ? fmtMoney(currTotal, "EGP", lang) : null]
        .filter(Boolean)
        .join(" · ") || (isAr ? "فاتورة" : "Invoice");
  }

  const searchText = [title, subtitle, row.actor_email, entityLabel, row.action, JSON.stringify(d)]
    .filter(Boolean)
    .join(" ");
  return { title, subtitle, changes, delta, invoiceNumber: invNo, entityLabel, searchText };
}

function entityLabelFor(t: string, isAr: boolean) {
  if (t === "payments") return isAr ? "دفعة" : "Payment";
  if (t === "invoice_items") return isAr ? "بند فاتورة" : "Invoice item";
  return isAr ? "فاتورة" : "Invoice";
}

const FIELD_LABELS: Record<string, { ar: string; en: string }> = {
  total: { ar: "الإجمالي", en: "Total" },
  amount: { ar: "المبلغ", en: "Amount" },
  paid_amount: { ar: "المدفوع", en: "Paid" },
  discount: { ar: "الخصم", en: "Discount" },
  quantity: { ar: "الكمية", en: "Qty" },
  unit_price: { ar: "سعر الوحدة", en: "Unit price" },
  line_total: { ar: "إجمالي البند", en: "Line total" },
  status: { ar: "الحالة", en: "Status" },
  delivery_status: { ar: "حالة التسليم", en: "Delivery" },
  customer_name: { ar: "العميل", en: "Customer" },
  product_name: { ar: "المنتج", en: "Product" },
  serial_number: { ar: "السيريال", en: "Serial" },
  color: { ar: "اللون", en: "Color" },
  notes: { ar: "ملاحظات العميل", en: "Notes" },
  system_notes: { ar: "الملاحظات الداخلية", en: "Internal notes" },
};

function collectChanges(before: any, after: any, isAr: boolean, lang: "ar" | "en") {
  if (!before || !after || Object.keys(before).length === 0 || Object.keys(after).length === 0)
    return [];
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return keys
    .filter(
      (k) => !["id", "user_id", "created_at", "updated_at", "created_by", "updated_by"].includes(k),
    )
    .filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
    .map(
      (k) =>
        `${FIELD_LABELS[k]?.[isAr ? "ar" : "en"] ?? k}: ${formatValue(before[k], lang)} → ${formatValue(after[k], lang)}`,
    );
}

function formatValue(v: any, lang: "ar" | "en") {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return Math.abs(v) >= 100 ? fmtMoney(v, "EGP", lang) : String(v);
  if (typeof v === "boolean")
    return v ? (lang === "ar" ? "نعم" : "Yes") : lang === "ar" ? "لا" : "No";
  return String(v).length > 70 ? `${String(v).slice(0, 70)}…` : String(v);
}

function numberOrNull(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function DetailsPanel({ row, isAr, lang }: { row: Row; isAr: boolean; lang: "ar" | "en" }) {
  const d = describeRow(row, isAr, lang);
  return (
    <div className="border-t bg-muted/20 px-4 py-3 text-xs">
      <div className="grid gap-2 sm:grid-cols-3">
        <Info
          label={isAr ? "نوع العملية" : "Action"}
          value={actionMeta(normalizedAction(row.action), isAr).label}
        />
        <Info label={isAr ? "تمت بواسطة" : "Done by"} value={row.actor_email || "—"} />
        <Info label={isAr ? "الوقت" : "Time"} value={fmtDateTime(row.created_at, lang)} />
      </div>
      {d.changes.length > 0 ? (
        <div className="mt-3 rounded-lg border bg-background p-3">
          <div className="mb-2 font-semibold">
            {isAr ? "التغييرات المفهومة" : "Readable changes"}
          </div>
          <ul className="space-y-1 text-muted-foreground">
            {d.changes.map((c) => (
              <li key={c}>• {c}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border bg-background p-3 text-muted-foreground">
          {isAr
            ? "لا توجد تفاصيل تغيير إضافية محفوظة لهذه العملية."
            : "No extra field-by-field details were saved for this record."}
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  Icon,
  tone,
}: {
  label: string;
  value: string | number;
  Icon: any;
  tone: "emerald" | "amber" | "rose" | "primary";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "rose"
          ? "text-destructive"
          : "text-primary";
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
