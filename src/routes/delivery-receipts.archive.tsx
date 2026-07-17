import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Search, Eye, Archive as ArchiveIcon, RotateCcw } from "lucide-react";
import { fmtDate } from "@/lib/utils-money";
import { useRealtimeTable } from "@/lib/realtime";
import { TableSkeleton } from "@/components/skeletons";
import { StatusBadge, type DRStatus } from "@/components/delivery-receipt-tracker";
import { toast } from "sonner";

export const Route = createFileRoute("/delivery-receipts/archive")({
  component: () => <AppShell><Page /></AppShell>,
});

const ARCHIVED: DRStatus[] = ["paid", "returned", "cancelled"];

function Page() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState<DRStatus | "">("");
  const navigate = useNavigate();

  const load = async () => {
    if (!user) return;
    // Archive = receipts explicitly closed/paid/returned/cancelled, OR receipts
    // whose parent invoice is fully paid ("completed") or fully delivered.
    const { data: archivedByStatus } = await supabase
      .from("delivery_receipts" as any)
      .select("*")
      .in("status", ARCHIVED)
      .order("archived_at", { ascending: false, nullsFirst: false });
    const { data: closedInvoices } = await supabase
      .from("invoices")
      .select("id, invoice_number, customer_name, total, status, delivery_status")
      .or("status.eq.completed,delivery_status.eq.delivered");
    const closedIds = (closedInvoices ?? []).map((i: any) => i.id);
    let archivedByInvoice: any[] = [];
    if (closedIds.length > 0) {
      const { data } = await supabase
        .from("delivery_receipts" as any)
        .select("*")
        .in("invoice_id", closedIds)
        .not("status", "in", `(${ARCHIVED.map((s) => `"${s}"`).join(",")})`)
        .order("created_at", { ascending: false });
      archivedByInvoice = (data ?? []) as any[];
    }
    const merged = [...(archivedByStatus ?? []), ...archivedByInvoice] as any[];
    // Deduplicate
    const seen = new Set<string>();
    const list = merged.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    setRows(list);
    const ids = Array.from(new Set(list.map((r) => r.invoice_id)));
    if (ids.length > 0) {
      const { data: invs } = await supabase
        .from("invoices")
        .select("id, invoice_number, customer_name, total")
        .in("id", ids);
      const map: Record<string, any> = {};
      (invs ?? []).forEach((i: any) => (map[i.id] = i));
      setInvoices(map);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, [user]);
  useRealtimeTable("delivery_receipts" as any, () => load());

  const filtered = rows.filter((r) => {
    if (filterStatus && r.status !== filterStatus) return false;
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    const inv = invoices[r.invoice_id];
    return (
      r.receipt_number?.toLowerCase().includes(s) ||
      r.delivered_to_name?.toLowerCase().includes(s) ||
      inv?.invoice_number?.toLowerCase().includes(s) ||
      inv?.customer_name?.toLowerCase().includes(s)
    );
  });

  const reopen = async (id: string) => {
    const { error } = await supabase.rpc("change_delivery_receipt_status" as any, {
      _receipt_id: id, _new_status: "draft", _reason: isAr ? "إعادة فتح من الأرشيف" : "Reopened from archive",
    });
    if (error) toast.error(error.message); else { toast.success(isAr ? "تمت إعادة الفتح" : "Reopened"); load(); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/delivery-receipts"><Button variant="ghost" size="icon" className="rounded-full"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gradient-gold flex items-center gap-2">
              <ArchiveIcon className="h-6 w-6" />
              {isAr ? "أرشيف محاضر الاستلام" : "Delivery Receipts Archive"}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {isAr ? "المحاضر المغلقة، المدفوعة، الراجعة أو الملغية." : "Closed, paid, returned or cancelled receipts."}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-md flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={isAr ? "ابحث…" : "Search…"} className="ps-9" />
        </div>
        <div className="flex flex-wrap gap-1">
          {(["", "paid", "returned", "cancelled"] as const).map((s) => (
            <Button key={s || "all"} size="sm" variant={filterStatus === s ? "default" : "outline"} className="rounded-full" onClick={() => setFilterStatus(s as any)}>
              {s === "" ? (isAr ? "الكل" : "All") : <StatusBadge status={s} isAr={isAr} />}
            </Button>
          ))}
        </div>
      </div>

      <div className="surface-elevated overflow-hidden rounded-2xl border bg-card">
        {loading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <ArchiveIcon className="mx-auto mb-2 h-8 w-8 opacity-40" />
            {isAr ? "لا يوجد محاضر مؤرشفة" : "No archived receipts"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr>
                  <th className="px-3 py-3 text-start">{isAr ? "رقم المحضر" : "Receipt #"}</th>
                  <th className="px-3 py-3 text-start">{isAr ? "الفاتورة" : "Invoice"}</th>
                  <th className="px-3 py-3 text-start">{isAr ? "المستلم" : "Recipient"}</th>
                  <th className="px-3 py-3 text-start">{isAr ? "أُرشف في" : "Archived"}</th>
                  <th className="px-3 py-3 text-start">{isAr ? "الحالة" : "Status"}</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => {
                  const inv = invoices[r.invoice_id];
                  return (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-3 py-3 font-mono font-medium">{r.receipt_number}</td>
                      <td className="px-3 py-3">
                        {inv ? (
                          <Link to="/invoices/$id" params={{ id: r.invoice_id }} className="text-primary hover:underline">{inv.invoice_number}</Link>
                        ) : "—"}
                        <div className="text-[11px] text-muted-foreground">{inv?.customer_name}</div>
                      </td>
                      <td className="px-3 py-3">{r.delivered_to_name || "—"}</td>
                      <td className="px-3 py-3 text-muted-foreground">{fmtDate(r.archived_at || r.updated_at, lang)}</td>
                      <td className="px-3 py-3">
                        <StatusBadge status={r.status} isAr={isAr} />
                        {r.status_reason && <div className="mt-0.5 text-[10px] text-muted-foreground">{r.status_reason}</div>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title={isAr ? "عرض" : "View"} onClick={() => navigate({ to: "/delivery-receipts/$id", params: { id: r.id } })}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title={isAr ? "إعادة فتح" : "Reopen"} onClick={() => reopen(r.id)}>
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
