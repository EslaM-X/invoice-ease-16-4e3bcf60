import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtMoney, fmtDate } from "@/lib/utils-money";
import { toast } from "sonner";
import { Wallet, TrendingUp, Trash2, Plus, Loader2, Receipt, XCircle, Eye, Pencil, Truck } from "lucide-react";

type Balance = {
  distributor_id: string;
  distributor_name: string;
  approved_invoice_count: number;
  total_sales: number;
  commission_earned: number;
  payouts_total: number;
  balance_owed: number;
};

type Invoice = {
  id: string; invoice_number: string; created_at: string;
  subtotal: number; total: number; approval_status: string;
  approval_discount_pct: number; distributor_commission_amount: number;
  customer_name: string | null;
};

export function DistributorBalancesCard() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    const { data } = await (supabase.from as any)("distributor_balances").select("*");
    const sorted = ((data as Balance[]) ?? []).sort((a, b) => b.balance_owed - a.balance_owed);
    setRows(sorted); setLoading(false);
  };
  useEffect(() => { load(); }, []);
  useRealtimeTable("invoices", () => load());
  useRealtimeTable("distributor_payouts", () => load());

  if (loading) return null;
  const totalOwed = rows.reduce((s, r) => s + Number(r.balance_owed || 0), 0);
  const active = rows.filter((r) => r.approved_invoice_count > 0 || r.balance_owed !== 0);

  return (
    <>
      <div className="ios-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-emerald-500" />
            <h3 className="text-sm font-semibold">{isAr ? "حسابات الموزّعين (العمولات)" : "Distributor commissions"}</h3>
          </div>
          <Badge variant="outline" className="border-emerald-400/40 text-emerald-600 dark:text-emerald-400 tabular-nums">
            {isAr ? "إجمالي مستحق:" : "Total owed:"} {fmtMoney(totalOwed, "EGP", lang)}
          </Badge>
        </div>
        {active.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">{isAr ? "لا توجد عمولات بعد" : "No commissions yet"}</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {active.map((r) => (
              <button key={r.distributor_id} onClick={() => setOpenId(r.distributor_id)}
                className="flex items-center gap-3 rounded-xl border bg-card/40 p-3 text-start transition hover:bg-muted/50">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${r.balance_owed > 0 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"}`}>
                  <TrendingUp className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{r.distributor_name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.approved_invoice_count} {isAr ? "فاتورة" : "invoices"} • {isAr ? "مبيعات" : "sales"} {fmtMoney(r.total_sales, "EGP", lang)}
                  </div>
                </div>
                <div className="text-end">
                  <div className="text-[10px] text-muted-foreground">{isAr ? "المستحق" : "Owed"}</div>
                  <div className={`text-sm font-bold tabular-nums ${r.balance_owed > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
                    {fmtMoney(r.balance_owed, "EGP", lang)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <DistributorDetailsDialog id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function DistributorDetailsDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const navigate = useNavigate();
  const [bal, setBal] = useState<Balance | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [openPayout, setOpenPayout] = useState(false);

  const load = async () => {
    if (!id) return;
    const [b, inv, p] = await Promise.all([
      (supabase.from as any)("distributor_balances").select("*").eq("distributor_id", id).maybeSingle(),
      (supabase.from as any)("invoices").select("id,invoice_number,created_at,subtotal,total,approval_status,approval_discount_pct,distributor_commission_amount,customer_name")
        .eq("distributor_id", id).eq("source", "distributor").order("created_at", { ascending: false }).limit(200),
      (supabase.from as any)("distributor_payouts").select("*").eq("distributor_id", id).order("paid_at", { ascending: false }).limit(50),
    ]);
    setBal(b.data ?? null);
    setInvoices((inv.data as Invoice[]) ?? []);
    setPayouts(p.data ?? []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!id) return null;

  const deleteInvoice = async (invId: string, num: string) => {
    if (!confirm(isAr ? `حذف الفاتورة ${num}؟ هتترفع للموزع كإشعار` : `Delete invoice ${num}?`)) return;
    const { error } = await (supabase.rpc as any)("delete_distributor_invoice", { _invoice_id: invId, _notes: null });
    if (error) toast.error(error.message); else { toast.success(isAr ? "تم الحذف" : "Deleted"); load(); }
  };

  const rejectInvoice = async (invId: string) => {
    const notes = prompt(isAr ? "سبب الرفض؟" : "Reason?") || "";
    const { error } = await (supabase.rpc as any)("reject_distributor_invoice", { _invoice_id: invId, _notes: notes });
    if (error) toast.error(error.message); else { toast.success(isAr ? "تم الرفض" : "Rejected"); load(); }
  };

  return (
    <Dialog open={!!id} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{bal?.distributor_name ?? "—"} — {isAr ? "تفاصيل العمولات" : "Commission details"}</DialogTitle>
        </DialogHeader>
        {bal && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={isAr ? "عدد الفواتير" : "Invoices"} value={String(bal.approved_invoice_count)} />
            <Stat label={isAr ? "إجمالي المبيعات" : "Total sales"} value={fmtMoney(bal.total_sales, "EGP", lang)} />
            <Stat label={isAr ? "عمولات مكتسبة" : "Commissions earned"} value={fmtMoney(bal.commission_earned, "EGP", lang)} tone="emerald" />
            <Stat label={isAr ? "المستحق الآن" : "Currently owed"} value={fmtMoney(bal.balance_owed, "EGP", lang)} tone={bal.balance_owed > 0 ? "amber" : "default"} />
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <h4 className="text-sm font-semibold">{isAr ? "الفواتير" : "Invoices"}</h4>
        </div>
        <div className="max-h-72 overflow-auto rounded-xl border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/60 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="p-2 text-start">{isAr ? "رقم" : "#"}</th>
                <th className="p-2 text-start">{isAr ? "العميل" : "Customer"}</th>
                <th className="p-2 text-end">{isAr ? "الإجمالي" : "Total"}</th>
                <th className="p-2 text-end">%</th>
                <th className="p-2 text-end">{isAr ? "عمولة" : "Commission"}</th>
                <th className="p-2 text-center">{isAr ? "الحالة" : "Status"}</th>
                <th className="p-2 text-end"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((iv) => (
                <tr key={iv.id} className="border-t">
                  <td className="p-2 font-mono">{iv.invoice_number}</td>
                  <td className="p-2">{iv.customer_name || "—"}<div className="text-[10px] text-muted-foreground">{fmtDate(iv.created_at, lang)}</div></td>
                  <td className="p-2 text-end tabular-nums">{fmtMoney(iv.total, "EGP", lang)}</td>
                  <td className="p-2 text-end tabular-nums">{iv.approval_discount_pct}%</td>
                  <td className="p-2 text-end font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtMoney(iv.distributor_commission_amount, "EGP", lang)}</td>
                  <td className="p-2 text-center">
                    <Badge variant="outline" className={
                      iv.approval_status === "approved" ? "border-emerald-400/40 text-emerald-600" :
                      iv.approval_status === "rejected" ? "border-red-400/40 text-red-600" :
                      "border-amber-400/40 text-amber-600"
                    }>{iv.approval_status}</Badge>
                  </td>
                  <td className="p-2 text-end">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-6 w-6" title={isAr ? "فتح الفاتورة" : "Open invoice"}
                        onClick={() => { onClose(); navigate({ to: "/invoices/$id", params: { id: iv.id } }); }}>
                        <Eye className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" title={isAr ? "تعديل" : "Edit"}
                        onClick={() => { onClose(); navigate({ to: "/invoices_/$id/edit", params: { id: iv.id } }); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-sky-600" title={isAr ? "إضافة شحن" : "Add shipment"}
                        onClick={() => { onClose(); navigate({ to: "/delivery-receipts/new", search: { invoiceId: iv.id } }); }}>
                        <Truck className="h-3 w-3" />
                      </Button>
                      {iv.approval_status !== "rejected" && (
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" title={isAr ? "رفض" : "Reject"} onClick={() => rejectInvoice(iv.id)}>
                          <XCircle className="h-3 w-3" />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" title={isAr ? "حذف" : "Delete"} onClick={() => deleteInvoice(iv.id, iv.invoice_number)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">—</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between pt-2">
          <h4 className="text-sm font-semibold">{isAr ? "المدفوعات للموزّع" : "Payouts"}</h4>
          <Button size="sm" onClick={() => setOpenPayout(true)} className="gap-1"><Plus className="h-3 w-3" /> {isAr ? "تسجيل دفعة" : "Record payout"}</Button>
        </div>
        <div className="rounded-xl border">
          {payouts.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">{isAr ? "لا توجد دفعات" : "No payouts"}</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/60 text-[10px] uppercase text-muted-foreground">
                <tr><th className="p-2 text-start">{isAr ? "التاريخ" : "Date"}</th><th className="p-2 text-end">{isAr ? "المبلغ" : "Amount"}</th><th className="p-2 text-start">{isAr ? "ملاحظات" : "Notes"}</th><th className="p-2"></th></tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-2">{fmtDate(p.paid_at, lang)}</td>
                    <td className="p-2 text-end font-bold tabular-nums">{fmtMoney(p.amount, "EGP", lang)}</td>
                    <td className="p-2 text-muted-foreground">{p.notes || "—"}</td>
                    <td className="p-2 text-end">
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" title={isAr ? "حذف الدفعة" : "Delete payout"}
                        onClick={async () => {
                          if (!confirm(isAr ? "حذف هذه الدفعة؟ هيتم إشعار الموزّع وتحديث رصيده فوراً" : "Delete this payout?")) return;
                          const { error } = await (supabase.rpc as any)("delete_distributor_payout", { _payout_id: p.id });
                          if (error) toast.error(error.message); else { toast.success(isAr ? "تم الحذف" : "Deleted"); load(); }
                        }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <PayoutDialog open={openPayout} onClose={() => setOpenPayout(false)} distributorId={id} onSaved={load} />
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "emerald" | "amber" }) {
  const cls = tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" :
              tone === "amber" ? "text-amber-600 dark:text-amber-400" : "";
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function PayoutDialog({ open, onClose, distributorId, onSaved }: { open: boolean; onClose: () => void; distributorId: string; onSaved: () => void }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setAmount(""); setMethod(""); setNotes(""); } }, [open]);

  const submit = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { toast.error(isAr ? "ادخل مبلغ صحيح" : "Enter a valid amount"); return; }
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await (supabase.from as any)("distributor_payouts").insert({
      distributor_id: distributorId, amount: amt, payout_method: method || null,
      notes: notes || null, paid_by: u.user?.id ?? null, paid_by_email: u.user?.email ?? null,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success(isAr ? "تم تسجيل الدفعة" : "Recorded"); onClose(); onSaved(); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{isAr ? "تسجيل دفعة للموزّع" : "Record payout"}</DialogTitle></DialogHeader>
        <div className="grid gap-2">
          <Input type="number" placeholder={isAr ? "المبلغ" : "Amount"} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input placeholder={isAr ? "طريقة الدفع (اختياري)" : "Method (optional)"} value={method} onChange={(e) => setMethod(e.target.value)} />
          <Textarea rows={2} placeholder={isAr ? "ملاحظات" : "Notes"} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{isAr ? "إلغاء" : "Cancel"}</Button>
          <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{isAr ? "حفظ" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
