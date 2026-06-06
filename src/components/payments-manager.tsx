import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Wallet, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { fmtMoney, fmtDateTime } from "@/lib/utils-money";
import { toast } from "sonner";
import { useRealtimeTable } from "@/lib/realtime";

interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  method: string;
  reference: string | null;
  notes: string | null;
  paid_at: string;
  created_by_email: string | null;
}

const METHODS = [
  { value: "cash", ar: "نقدي", en: "Cash" },
  { value: "transfer", ar: "تحويل بنكي", en: "Bank transfer" },
  { value: "instapay", ar: "إنستاباي", en: "Instapay" },
  { value: "visa", ar: "فيزا", en: "Visa" },
  { value: "other", ar: "أخرى", en: "Other" },
];

export function PaymentsManager({ invoiceId, invoiceTotal, paidAmount, onChange }: {
  invoiceId: string;
  invoiceTotal: number;
  paidAmount: number;
  onChange?: () => void;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [open, setOpen] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 16));

  const remaining = Math.max(0, +(invoiceTotal - paidAmount).toFixed(2));

  const load = async () => {
    const { data } = await supabase
      .from("payments" as any)
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("paid_at", { ascending: false });
    setPayments((data as any) ?? []);
  };

  useEffect(() => { if (open) load(); }, [open, invoiceId]);
  useRealtimeTable("payments" as any, (p: any) => {
    if (p.new?.invoice_id === invoiceId || p.old?.invoice_id === invoiceId) {
      load();
      onChange?.();
    }
  }, [invoiceId]);

  const add = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error(isAr ? "أدخل مبلغًا صحيحًا" : "Enter a valid amount");
    if (amt > remaining + 0.001) return toast.error(isAr ? `المبلغ يتجاوز المتبقي (${remaining.toFixed(2)})` : `Exceeds remaining (${remaining.toFixed(2)})`);
    setLoading(true);
    const { error } = await supabase.rpc("add_payment" as any, {
      _invoice_id: invoiceId,
      _amount: amt,
      _method: method,
      _reference: reference || null,
      _notes: notes || null,
      _paid_at: new Date(paidAt).toISOString(),
    } as any);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success(isAr ? "تم تسجيل الدفعة" : "Payment recorded");
    setAmount(""); setReference(""); setNotes("");
    load();
    onChange?.();
  };

  const remove = async (id: string) => {
    if (!confirm(isAr ? "حذف هذه الدفعة؟" : "Delete this payment?")) return;
    const { error } = await supabase.from("payments" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(isAr ? "تم الحذف" : "Deleted");
    load();
    onChange?.();
  };

  const fillRemaining = () => setAmount(remaining.toFixed(2));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="gap-2 rounded-full border-blue-500/40 text-blue-700 dark:text-blue-400 hover:bg-blue-500/10"
        >
          <Wallet className="h-4 w-4" />
          {isAr ? `إدارة الدفعات (متبقي ${remaining.toFixed(2)})` : `Payments (remaining ${remaining.toFixed(2)})`}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isAr ? "دفعات الفاتورة" : "Invoice payments"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{isAr ? "الإجمالي" : "Total"}</div><div className="text-base font-semibold">{fmtMoney(invoiceTotal, "EGP", lang)}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{isAr ? "المحصّل" : "Paid"}</div><div className="text-base font-semibold text-emerald-600">{fmtMoney(paidAmount, "EGP", lang)}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{isAr ? "المتبقي" : "Remaining"}</div><div className="text-base font-semibold text-rose-600">{fmtMoney(remaining, "EGP", lang)}</div></div>
        </div>

        {remaining > 0 && (
          <div className="rounded-xl border bg-muted/30 p-3 space-y-3">
            <div className="text-sm font-semibold flex items-center gap-2"><Plus className="h-4 w-4" />{isAr ? "تسجيل دفعة" : "Add payment"}</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{isAr ? "المبلغ" : "Amount"}</Label>
                <div className="flex gap-1">
                  <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                  <Button type="button" variant="ghost" size="sm" onClick={fillRemaining} className="text-xs">{isAr ? "كامل" : "All"}</Button>
                </div>
              </div>
              <div>
                <Label className="text-xs">{isAr ? "طريقة الدفع" : "Method"}</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {METHODS.map(m => <SelectItem key={m.value} value={m.value}>{isAr ? m.ar : m.en}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{isAr ? "التاريخ" : "Date"}</Label>
                <Input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">{isAr ? "مرجع/رقم" : "Reference"}</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={isAr ? "اختياري" : "Optional"} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">{isAr ? "ملاحظات" : "Notes"}</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            </div>
            <Button onClick={add} disabled={loading} className="w-full">{isAr ? "حفظ الدفعة" : "Save payment"}</Button>
          </div>
        )}

        <div className="space-y-2 max-h-72 overflow-auto">
          <div className="text-sm font-semibold">{isAr ? "سجل الدفعات" : "Payment history"} ({payments.length})</div>
          {payments.length === 0 && <div className="text-xs text-muted-foreground py-4 text-center">{isAr ? "لا توجد دفعات" : "No payments yet"}</div>}
          {payments.map(p => (
            <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-semibold tabular-nums">{fmtMoney(Number(p.amount), "EGP", lang)}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {(METHODS.find(m => m.value === p.method)?.[isAr ? "ar" : "en"]) ?? p.method}
                  {p.reference ? ` · ${p.reference}` : ""}
                  {" · "}{fmtDateTime(p.paid_at, lang)}
                </div>
                {p.notes && <div className="text-xs text-muted-foreground italic truncate">{p.notes}</div>}
              </div>
              <Button variant="ghost" size="icon" onClick={() => remove(p.id)} className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{isAr ? "إغلاق" : "Close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
