import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDateTime } from "@/lib/utils-money";
import { ArrowLeft, ClipboardList, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import { reasonLabel, type ReasonCode } from "@/lib/fulfillment-engine";

export const Route = createFileRoute("/fulfillment-audit")({
  component: () => (
    <AppShell>
      <FulfillmentAuditPage />
    </AppShell>
  ),
});

type AuditRow = {
  id: string;
  invoice_id: string;
  invoice_number: string;
  action: string;
  tier: string;
  mode: string;
  confidence: number;
  total_needed: number;
  total_from_stock: number;
  total_from_incoming: number;
  total_shortfall: number;
  manual_count: number;
  reasons: { code: ReasonCode; detail: string }[];
  needs: any[];
  note: string | null;
  created_at: string;
};

function FulfillmentAuditPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("fulfillment_audit_log" as any)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) toast.error(error.message);
    setRows(((data ?? []) as unknown) as AuditRow[]);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);
  useRealtimeTable("fulfillment_audit_log", load, [user?.id]);

  async function remove(id: string) {
    const { error } = await supabase.from("fulfillment_audit_log" as any).delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم الحذف" : "Deleted");
  }

  const filtered = rows.filter((r) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      r.invoice_number.toLowerCase().includes(s) ||
      r.action.toLowerCase().includes(s) ||
      r.tier.toLowerCase().includes(s) ||
      (r.note || "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-4" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="h-6 w-6 text-primary" />
            {isAr ? "سجل تدقيق الإقفال" : "Fulfillment Audit Log"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAr
              ? "كل عمليات تسجيل الإقفال مع أسبابها وأرقامها — يُحدَّث تلقائياً."
              : "Every recorded closure with reasons & numbers — auto-refreshing."}
          </p>
        </div>
        <Link to="/fulfillment">
          <Button variant="outline" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            {isAr ? "رجوع" : "Back"}
          </Button>
        </Link>
      </div>

      <div className="relative max-w-md">
        <Search className={`absolute top-1/2 -translate-y-1/2 ${isAr ? "right-3" : "left-3"} h-4 w-4 text-muted-foreground`} />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={isAr ? "ابحث برقم الفاتورة أو الإجراء…" : "Search by invoice / action…"}
          className={isAr ? "pr-9" : "pl-9"}
        />
      </div>

      {loading && <div className="rounded-lg border border-border bg-card p-10 text-center text-muted-foreground">{isAr ? "جارٍ التحميل…" : "Loading…"}</div>}
      {!loading && filtered.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-muted-foreground">
          {isAr ? "لا توجد سجلات." : "No entries yet."}
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((r) => (
          <Card key={r.id} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to="/invoices/$id" params={{ id: r.invoice_id }}>
                    <span className="font-mono text-sm font-semibold hover:underline">{r.invoice_number}</span>
                  </Link>
                  <Badge variant="outline" className="text-[10px]">{r.action}</Badge>
                  <Badge variant="outline" className="text-[10px]">tier={r.tier}</Badge>
                  <Badge variant="outline" className="text-[10px]">mode={r.mode}</Badge>
                  <Badge variant="outline" className="text-[10px]">{r.confidence}%</Badge>
                  <span className="text-xs text-muted-foreground">· {fmtDateTime(r.created_at, isAr ? "ar" : "en")}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-md bg-muted px-2 py-0.5">{isAr ? "مطلوب" : "Needed"}: <b>{r.total_needed}</b></span>
                  {r.total_from_stock > 0 && <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">{isAr ? "من المخزون" : "From stock"}: <b>{r.total_from_stock}</b></span>}
                  {r.total_from_incoming > 0 && <span className="rounded-md bg-violet-500/15 px-2 py-0.5 text-violet-700 dark:text-violet-400">{isAr ? "من الشحنات" : "From incoming"}: <b>{r.total_from_incoming}</b></span>}
                  {r.total_shortfall > 0 && <span className="rounded-md bg-rose-500/15 px-2 py-0.5 text-rose-700 dark:text-rose-400">{isAr ? "ناقص" : "Short"}: <b>{r.total_shortfall}</b></span>}
                  {r.manual_count > 0 && <span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-sky-700 dark:text-sky-400">{isAr ? "بنود يدوية" : "Manual"}: <b>{r.manual_count}</b></span>}
                </div>
                {Array.isArray(r.reasons) && r.reasons.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {r.reasons.map((x, i) => (
                      <Badge key={i} variant="outline" className="text-[10px] font-normal">
                        {reasonLabel(x.code, isAr)}{x.detail ? ` · ${x.detail}` : ""}
                      </Badge>
                    ))}
                  </div>
                )}
                {r.note && <div className="mt-2 text-xs text-muted-foreground">{r.note}</div>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => remove(r.id)} title={isAr ? "حذف" : "Delete"}>
                <Trash2 className="h-4 w-4 text-rose-600" />
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
