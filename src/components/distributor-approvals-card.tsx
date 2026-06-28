import { useEffect, useState } from "react";
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
import { CheckCircle2, XCircle, Loader2, Clock, Eye, Percent, FileText, Trash2 } from "lucide-react";

type Pending = {
  id: string; invoice_number: string; created_at: string; subtotal: number;
  total: number; customer_name: string | null; customer_phone: string | null;
  distributor_id: string | null; notes: string | null;
  distributor?: { name: string; showroom_name: string | null; location: string | null } | null;
};

type Item = { id: string; product_name: string; serial_number: string | null; color: string | null; quantity: number; unit_price: number; line_total: number };

export function DistributorApprovalsCard() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    const { data } = await (supabase.from as any)("invoices")
      .select("id,invoice_number,created_at,subtotal,total,customer_name,customer_phone,distributor_id,notes, distributor:distributors(name,showroom_name,location)")
      .eq("source", "distributor").eq("approval_status", "pending")
      .order("created_at", { ascending: false });
    setRows((data as Pending[]) ?? []); setLoading(false);
  };
  useEffect(() => { load(); }, []);
  useRealtimeTable("invoices", () => load());

  if (loading) return null;
  if (rows.length === 0) {
    return (
      <div className="ios-card flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /></div>
        <div>
          <div className="text-sm font-semibold">{isAr ? "لا توجد فواتير موزّعين بانتظار الموافقة" : "No pending distributor invoices"}</div>
          <div className="text-[11px] text-muted-foreground">{isAr ? "أي فاتورة جديدة من موزّع هتظهر هنا فوراً" : "New requests appear here in realtime"}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="ios-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold">{isAr ? "فواتير الموزّعين — بانتظار الموافقة" : "Distributor invoices — pending"}</h3>
            <Badge variant="outline" className="border-amber-400/40 text-amber-600 dark:text-amber-400">{rows.length}</Badge>
          </div>
        </div>
        <div className="space-y-2">
          {rows.map((r) => (
            <button key={r.id} onClick={() => setOpenId(r.id)}
              className="flex w-full items-center gap-3 rounded-xl border bg-card/40 p-3 text-start transition hover:bg-muted/50">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400"><FileText className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 truncate text-sm font-semibold">
                  {r.invoice_number}
                  {r.distributor && <span className="text-xs font-normal text-muted-foreground">— {r.distributor.name}{r.distributor.showroom_name ? ` (${r.distributor.showroom_name})` : ""}</span>}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">{r.customer_name} {r.distributor?.location ? `• ${r.distributor.location}` : ""}</div>
              </div>
              <div className="text-end">
                <div className="text-sm font-bold tabular-nums">{fmtMoney(r.total, "EGP", lang)}</div>
                <div className="text-[10px] text-muted-foreground">{fmtDate(r.created_at, lang)}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <ApproveDialog id={openId} onClose={() => setOpenId(null)} onDone={load} />
    </>
  );
}

function ApproveDialog({ id, onClose, onDone }: { id: string | null; onClose: () => void; onDone: () => void }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [inv, setInv] = useState<any>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [discount, setDiscount] = useState("0");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState<string>("");
  const [eventId, setEventId] = useState<string>("");
  const [events, setEvents] = useState<Array<{ id: string; name: string; year: number | null }>>([]);
  const [working, setWorking] = useState<"approve" | "reject" | null>(null);

  useEffect(() => {
    if (!id) { setInv(null); setItems([]); return; }
    (async () => {
      const { data: i } = await (supabase.from as any)("invoices")
        .select("*, distributor:distributors(name,showroom_name,location,city,phone)")
        .eq("id", id).single();
      setInv(i);
      const { data: it } = await (supabase.from as any)("invoice_items").select("*").eq("invoice_id", id);
      setItems((it as Item[]) ?? []);
      const { data: ev } = await (supabase.from as any)("sales_events").select("id,name,year").order("year", { ascending: false }).order("name");
      setEvents((ev as any[]) ?? []);
      setDiscount("0"); setNotes("");
      setCategory((i as any)?.customer_category ?? "");
      setEventId((i as any)?.sales_event_id ?? "");
    })();
  }, [id]);

  if (!id) return null;

  const subtotal = Number(inv?.subtotal || 0);
  const pct = Number(discount) || 0;
  const finalTotal = Math.max(0, subtotal - (subtotal * pct) / 100);

  const approve = async () => {
    setWorking("approve");
    const { error } = await (supabase.rpc as any)("approve_distributor_invoice", {
      _invoice_id: id,
      _discount_pct: pct,
      _notes: notes || null,
      _customer_category: category || null,
      _sales_event_id: eventId || null,
    });
    setWorking(null);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تمت الموافقة" : "Approved"); onDone(); onClose();
  };
  const reject = async () => {
    setWorking("reject");
    const { error } = await (supabase.rpc as any)("reject_distributor_invoice", { _invoice_id: id, _notes: notes || null });
    setWorking(null);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم الرفض" : "Rejected"); onDone(); onClose();
  };

  return (
    <Dialog open={!!id} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{isAr ? "مراجعة فاتورة موزّع" : "Review distributor invoice"} — {inv?.invoice_number}</DialogTitle></DialogHeader>
        {!inv ? <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/30 p-3 text-sm">
              <div><div className="text-[10px] text-muted-foreground">{isAr ? "الموزّع" : "Distributor"}</div><div className="font-semibold">{inv.distributor?.name}</div></div>
              <div><div className="text-[10px] text-muted-foreground">{isAr ? "المعرض / المكان" : "Showroom / Location"}</div><div className="font-semibold">{[inv.distributor?.showroom_name, inv.distributor?.location].filter(Boolean).join(" — ")}</div></div>
              <div><div className="text-[10px] text-muted-foreground">{isAr ? "العميل" : "Customer"}</div><div className="font-semibold">{inv.customer_name}</div></div>
              <div><div className="text-[10px] text-muted-foreground">{isAr ? "تليفون" : "Phone"}</div><div className="font-semibold">{inv.customer_phone || "—"}</div></div>
            </div>

            <div className="max-h-60 overflow-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-[11px] uppercase text-muted-foreground">
                  <tr><th className="p-2 text-start">{isAr ? "المنتج" : "Product"}</th><th className="p-2 text-center">{isAr ? "كمية" : "Qty"}</th><th className="p-2 text-end">{isAr ? "السعر" : "Price"}</th><th className="p-2 text-end">{isAr ? "الإجمالي" : "Total"}</th></tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-t">
                      <td className="p-2"><div className="font-medium">{it.product_name}</div><div className="text-[10px] text-muted-foreground">{[it.serial_number, it.color].filter(Boolean).join(" • ")}</div></td>
                      <td className="p-2 text-center font-bold tabular-nums">{it.quantity}</td>
                      <td className="p-2 text-end tabular-nums">{fmtMoney(it.unit_price, "EGP", lang)}</td>
                      <td className="p-2 text-end font-bold tabular-nums">{fmtMoney(it.line_total, "EGP", lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-medium"><Percent className="h-3 w-3" /> {isAr ? "عمولة الموزّع %" : "Distributor commission %"}</label>
                <Input type="number" min="0" max="100" step="0.5" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {isAr ? "العميل بيدفع السعر الكامل — النسبة دي عمولة بتتجمعلك للموزّع كرصيد مستحق." : "Customer pays full price — this % accrues as commission owed to the distributor."}
                </p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="flex justify-between text-xs text-muted-foreground"><span>{isAr ? "الإجمالي للعميل" : "Customer total"}</span><span className="tabular-nums">{fmtMoney(subtotal, "EGP", lang)}</span></div>
                <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400"><span>{isAr ? "عمولة للموزّع" : "Distributor commission"}</span><span className="tabular-nums">+{fmtMoney(subtotal - finalTotal, "EGP", lang)}</span></div>
                <div className="mt-1 flex justify-between border-t pt-1 text-sm font-bold"><span>{isAr ? "صافي للشركة" : "Net to company"}</span><span className="tabular-nums">{fmtMoney(finalTotal, "EGP", lang)}</span></div>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">{isAr ? "ملاحظة (اختياري)" : "Note (optional)"}</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={async () => {
                if (!id) return;
                if (!confirm(isAr ? "حذف الفاتورة نهائياً وإشعار الموزّع؟" : "Delete invoice permanently and notify distributor?")) return;
                const { error } = await (supabase.rpc as any)("delete_distributor_invoice", { _invoice_id: id, _notes: notes || null });
                if (error) { toast.error(error.message); return; }
                toast.success(isAr ? "تم الحذف" : "Deleted"); onDone(); onClose();
              }} className="text-red-600 hover:bg-red-500/10">
                <Trash2 className="me-2 h-4 w-4" /> {isAr ? "حذف" : "Delete"}
              </Button>
              <Button variant="outline" onClick={reject} disabled={!!working} className="border-red-400/40 text-red-600 hover:bg-red-500/10">
                {working === "reject" ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <XCircle className="me-2 h-4 w-4" />}
                {isAr ? "رفض" : "Reject"}
              </Button>
              <Button onClick={approve} disabled={!!working} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {working === "approve" ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="me-2 h-4 w-4" />}
                {isAr ? "موافقة وإرسال" : "Approve"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
