import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime, fmtMoney } from "@/lib/utils-money";
import { useRealtimeTable } from "@/lib/realtime";
import { ShieldCheck, Plus, Pencil, Trash2, ChevronDown } from "lucide-react";

export const Route = createFileRoute("/audit-log")({ component: AuditLogPage });

type Row = {
  id: string;
  actor_email: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  details: any;
  created_at: string;
};

function AuditLogPage() {
  return <AppShell><AuditLog /></AppShell>;
}

/* -------- Friendly translations / labels -------- */

const ENTITY_LABEL_AR: Record<string, string> = {
  invoices: "فاتورة",
  products: "منتج",
  customers: "عميل",
  invoice_items: "بند فاتورة",
  settings: "إعدادات",
  profiles: "ملف شخصي",
};
const ENTITY_LABEL_EN: Record<string, string> = {
  invoices: "Invoice",
  products: "Product",
  customers: "Customer",
  invoice_items: "Invoice item",
  settings: "Settings",
  profiles: "Profile",
};

const ACTION_LABEL_AR: Record<string, string> = {
  created: "أنشأ",
  updated: "عدّل",
  deleted: "حذف",
};
const ACTION_LABEL_EN: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
};

const FIELD_LABEL_AR: Record<string, string> = {
  name: "الاسم",
  price: "السعر",
  stock_quantity: "الكمية بالمخزون",
  low_stock_threshold: "حد التنبيه",
  color: "اللون",
  serial_number: "الرقم التسلسلي",
  image_url: "الصورة",
  qr_code: "رمز QR",
  notes: "الملاحظات",
  total: "الإجمالي",
  subtotal: "المجموع الفرعي",
  discount: "الخصم",
  status: "الحالة",
  language: "اللغة",
  customer_name: "اسم العميل",
  customer_phone: "هاتف العميل",
  customer_address: "عنوان العميل",
  invoice_number: "رقم الفاتورة",
  receipt_number: "رقم الإيصال",
  phone: "الهاتف",
  address: "العنوان",
  email: "البريد",
  display_name: "الاسم المعروض",
  avatar_url: "الصورة الشخصية",
  company_name: "اسم الشركة",
  company_phone: "هاتف الشركة",
  company_email: "بريد الشركة",
  company_address: "عنوان الشركة",
  payment_terms: "شروط الدفع",
  delivery_terms: "شروط التسليم",
  currency: "العملة",
  logo_url: "الشعار",
  quantity: "الكمية",
  unit_price: "سعر الوحدة",
  line_total: "إجمالي البند",
  product_name: "اسم المنتج",
};
const FIELD_LABEL_EN: Record<string, string> = {
  name: "Name",
  price: "Price",
  stock_quantity: "Stock quantity",
  low_stock_threshold: "Low-stock threshold",
  color: "Color",
  serial_number: "Serial number",
  image_url: "Image",
  qr_code: "QR code",
  notes: "Notes",
  total: "Total",
  subtotal: "Subtotal",
  discount: "Discount",
  status: "Status",
  language: "Language",
  customer_name: "Customer name",
  customer_phone: "Customer phone",
  customer_address: "Customer address",
  invoice_number: "Invoice number",
  receipt_number: "Receipt number",
  phone: "Phone",
  address: "Address",
  email: "Email",
  display_name: "Display name",
  avatar_url: "Avatar",
  company_name: "Company name",
  company_phone: "Company phone",
  company_email: "Company email",
  company_address: "Company address",
  payment_terms: "Payment terms",
  delivery_terms: "Delivery terms",
  currency: "Currency",
  logo_url: "Logo",
  quantity: "Quantity",
  unit_price: "Unit price",
  line_total: "Line total",
  product_name: "Product",
};

/** Fields that are noise — never show in the diff. */
const HIDDEN_FIELDS = new Set([
  "id", "user_id", "created_at", "updated_at",
  "created_by", "updated_by",
  "created_by_email", "updated_by_email",
  "qr_code",
]);

/** Money-like fields */
const MONEY_FIELDS = new Set(["price", "total", "subtotal", "discount", "unit_price", "line_total"]);

function fieldLabel(key: string, lang: "ar" | "en") {
  const map = lang === "ar" ? FIELD_LABEL_AR : FIELD_LABEL_EN;
  return map[key] ?? key;
}

function entityLabel(t: string, lang: "ar" | "en") {
  const map = lang === "ar" ? ENTITY_LABEL_AR : ENTITY_LABEL_EN;
  return map[t] ?? t;
}

function actionLabel(a: string, lang: "ar" | "en") {
  const map = lang === "ar" ? ACTION_LABEL_AR : ACTION_LABEL_EN;
  return map[a] ?? a;
}

function formatVal(key: string, val: any, lang: "ar" | "en"): string {
  if (val === null || val === undefined || val === "") return lang === "ar" ? "—" : "—";
  if (typeof val === "boolean") return val ? (lang === "ar" ? "نعم" : "Yes") : (lang === "ar" ? "لا" : "No");
  if (MONEY_FIELDS.has(key) && typeof val === "number") return fmtMoney(val, "EGP", lang);
  if (key === "avatar_url" || key === "image_url" || key === "logo_url") {
    return lang === "ar" ? "ملف صورة" : "Image file";
  }
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

/** Build a one-line summary headline for a row. */
function summarize(row: Row, lang: "ar" | "en"): string {
  const action = actionLabel(row.action, lang);
  const entity = entityLabel(row.entity_type, lang);
  const d = row.details || {};
  const obj = d.after || d.before || d;

  // Pick a friendly identifier
  const idText =
    obj?.invoice_number ||
    obj?.name ||
    obj?.customer_name ||
    obj?.product_name ||
    obj?.display_name ||
    obj?.email ||
    "";

  if (lang === "ar") {
    return `${action} ${entity}${idText ? ` "${idText}"` : ""}`;
  }
  return `${action} ${entity.toLowerCase()}${idText ? ` "${idText}"` : ""}`;
}

type DiffLine = { key: string; before: any; after: any };

/** Compute changed fields between before/after. */
function diffFields(before: any, after: any): DiffLine[] {
  if (!before || !after) return [];
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const out: DiffLine[] = [];
  for (const k of keys) {
    if (HIDDEN_FIELDS.has(k)) continue;
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push({ key: k, before: a, after: b });
    }
  }
  return out;
}

/** Get the most relevant non-noise key/value pairs for a created/deleted snapshot. */
function snapshotFields(obj: any): DiffLine[] {
  if (!obj) return [];
  const out: DiffLine[] = [];
  for (const k of Object.keys(obj)) {
    if (HIDDEN_FIELDS.has(k)) continue;
    const v = obj[k];
    if (v === null || v === undefined || v === "") continue;
    out.push({ key: k, before: undefined, after: v });
  }
  return out;
}

function AuditLog() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [entity, setEntity] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const load = async () => {
    let q = supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(300);
    if (entity !== "all") q = q.eq("entity_type", entity);
    if (action !== "all") q = q.eq("action", action);
    const { data } = await q;
    setRows((data ?? []) as Row[]);
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user, entity, action]);
  useRealtimeTable("audit_log", () => { load(); }, [entity, action]);

  const toggleOpen = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const entities = ["all", "invoices", "products", "customers", "invoice_items"];
  const actions = ["all", "created", "updated", "deleted"];

  const ActionIcon = ({ a }: { a: string }) =>
    a === "created" ? <Plus className="h-3.5 w-3.5" /> :
    a === "updated" ? <Pencil className="h-3.5 w-3.5" /> :
    a === "deleted" ? <Trash2 className="h-3.5 w-3.5" /> :
    <ShieldCheck className="h-3.5 w-3.5" />;

  const actionClass = (a: string) =>
    a === "created" ? "bg-success/10 text-success" :
    a === "updated" ? "bg-primary/10 text-primary" :
    a === "deleted" ? "bg-destructive/10 text-destructive" :
    "bg-muted text-muted-foreground";

  const renderChanges = (r: Row) => {
    const d = r.details || {};
    let lines: DiffLine[] = [];
    let mode: "diff" | "snapshot" = "snapshot";

    if (r.action === "updated" && d.before && d.after) {
      lines = diffFields(d.before, d.after);
      mode = "diff";
    } else if (r.action === "created") {
      lines = snapshotFields(d.after || d);
    } else if (r.action === "deleted") {
      lines = snapshotFields(d.before || d);
    } else {
      lines = snapshotFields(d.after || d.before || d);
    }

    if (lines.length === 0) {
      return <div className="text-xs text-muted-foreground">{lang === "ar" ? "لا توجد تغييرات لعرضها." : "No fields to display."}</div>;
    }

    return (
      <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/30">
        <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[420px]">
          <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-semibold">{lang === "ar" ? "الحقل" : "Field"}</th>
              {mode === "diff" && <th className="px-3 py-2 text-start font-semibold">{lang === "ar" ? "قبل" : "Before"}</th>}
              <th className="px-3 py-2 text-start font-semibold">{mode === "diff" ? (lang === "ar" ? "بعد" : "After") : (lang === "ar" ? "القيمة" : "Value")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {lines.map((l) => (
              <tr key={l.key} className="align-top">
                <td className="px-3 py-2 font-medium">{fieldLabel(l.key, lang)}</td>
                {mode === "diff" && (
                  <td className="px-3 py-2 text-muted-foreground line-through decoration-destructive/40">
                    {formatVal(l.key, l.before, lang)}
                  </td>
                )}
                <td className="px-3 py-2">
                  <span className={mode === "diff" ? "font-medium text-success" : ""}>
                    {formatVal(l.key, l.after, lang)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t("audit_log")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("audit_log_desc")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={entity} onChange={(e) => setEntity(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
            {entities.map((e) => <option key={e} value={e}>{e === "all" ? t("all") : entityLabel(e, lang)}</option>)}
          </select>
          <select value={action} onChange={(e) => setAction(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
            {actions.map((a) => <option key={a} value={a}>{a === "all" ? t("all") : actionLabel(a, lang)}</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
        {rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">{t("no_data")}</div>
        ) : (
          <div className="divide-y divide-border/60">
            {rows.map((r) => {
              const isOpen = openIds.has(r.id);
              return (
                <div key={r.id} className="px-5 py-3">
                  <button
                    onClick={() => toggleOpen(r.id)}
                    className="flex w-full items-start justify-between gap-3 text-start"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${actionClass(r.action)}`}>
                        <ActionIcon a={r.action} />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{summarize(r, lang)}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {r.actor_email ?? "—"} · {fmtDateTime(r.created_at, lang)}
                        </div>
                      </div>
                    </div>
                    <ChevronDown
                      className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {isOpen && (
                    <div className="mt-3 ms-10">
                      {renderChanges(r)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
