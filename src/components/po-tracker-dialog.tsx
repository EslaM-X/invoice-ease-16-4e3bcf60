import { swatchStyle } from "@/lib/color-swatch";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRole } from "@/lib/use-role";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtDateTime } from "@/lib/utils-money";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { CheckCircle2, Circle, Truck, Package, DollarSign, Wallet, ShoppingBag, Warehouse, XCircle, Activity, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export const PO_FLOW = [
  "pending_cfo",
  "priced",
  "ordered",
  "shipped",
  "in_warehouse",
  "received",
] as const;

export type POStatus = typeof PO_FLOW[number] | "cancelled" | string;

export function statusLabel(s: string, isAr: boolean) {
  switch (s) {
    case "pending_cfo": return isAr ? "بانتظار التسعير" : "Awaiting Pricing";
    case "priced": return isAr ? "تم التسعير" : "Priced";
    case "payment_pending": return isAr ? "بانتظار الدفع" : "Payment Pending";
    case "paid": return isAr ? "تم الدفع" : "Paid";
    case "ordered": return isAr ? "تم الطلب" : "Ordered";
    case "shipped": return isAr ? "تم الشحن" : "Shipped";
    case "in_warehouse": return isAr ? "في المخزن" : "In Warehouse";
    case "received": return isAr ? "تم الاستلام" : "Received";
    case "cancelled": return isAr ? "ملغى" : "Cancelled";
    default: return s;
  }
}

export function statusIcon(s: string, className = "h-4 w-4") {
  switch (s) {
    case "pending_cfo": return <Circle className={className} />;
    case "priced": return <DollarSign className={className} />;
    case "payment_pending": return <Wallet className={className} />;
    case "paid": return <CheckCircle2 className={className} />;
    case "ordered": return <ShoppingBag className={className} />;
    case "shipped": return <Truck className={className} />;
    case "in_warehouse": return <Warehouse className={className} />;
    case "received": return <Package className={className} />;
    case "cancelled": return <XCircle className={className} />;
    default: return <Activity className={className} />;
  }
}

export function statusBadge(s: string, isAr: boolean) {
  const cls: Record<string, string> = {
    pending_cfo: "bg-amber-500/15 text-amber-700 border-amber-500/30",
    priced: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
    payment_pending: "bg-orange-500/15 text-orange-700 border-orange-500/30",
    paid: "bg-cyan-500/15 text-cyan-700 border-cyan-500/30",
    ordered: "bg-indigo-500/15 text-indigo-700 border-indigo-500/30",
    shipped: "bg-violet-500/15 text-violet-700 border-violet-500/30",
    in_warehouse: "bg-blue-500/15 text-blue-700 border-blue-500/30",
    received: "bg-green-600/20 text-green-700 border-green-600/40",
    cancelled: "bg-destructive/15 text-destructive border-destructive/40",
  };
  return (
    <Badge variant="outline" className={`gap-1 ${cls[s] ?? ""}`}>
      {statusIcon(s, "h-3 w-3")}
      {statusLabel(s, isAr)}
    </Badge>
  );
}

type PO = {
  id: string;
  po_number: string;
  status: string;
  supplier_name: string | null;
  total_qty: number;
  total_usd: number;
  total_egp: number | null;
  user_id: string;
  paid_at: string | null;
  shipped_at: string | null;
  expected_arrival_at: string | null;
  received_at: string | null;
  stock_applied_at: string | null;
  payment_installment_1_at: string | null;
  payment_installment_1_amount: number | null;
  payment_installment_1_by_email: string | null;
  payment_installment_2_at: string | null;
  payment_installment_2_amount: number | null;
  payment_installment_2_by_email: string | null;
};

type POItem = {
  id: string;
  product_id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  image_url: string | null;
  quantity: number;
  unit_cost_usd: number;
};

type HistoryRow = {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  actor_email: string | null;
  created_at: string;
};

export function POTrackerDialog({
  poId,
  open,
  onOpenChange,
}: {
  poId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const { isAdmin, isPurchasing, isCFO } = useRole();
  const isAr = lang === "ar";

  const [po, setPo] = useState<PO | null>(null);
  const [items, setItems] = useState<POItem[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

  const load = async () => {
    const [{ data: p }, { data: it }, { data: h }] = await Promise.all([
      supabase.from("purchase_orders").select("*").eq("id", poId).maybeSingle(),
      supabase.from("purchase_order_items").select("*").eq("po_id", poId).order("created_at"),
      supabase.from("po_status_history").select("*").eq("po_id", poId).order("created_at", { ascending: true }),
    ]);
    setPo((p as any) ?? null);
    setItems((it as any) ?? []);
    setHistory((h as any) ?? []);
  };

  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, poId]);
  useRealtimeTable("po_status_history", () => { if (open) load(); }, [open, poId]);
  useRealtimeTable("purchase_orders", () => { if (open) load(); }, [open, poId]);

  const canTransition = isAdmin || isPurchasing || isCFO;
  const canCancel = isAdmin;

  const currentIdx = po ? PO_FLOW.indexOf(po.status as any) : -1;

  const installment1Paid = !!po?.payment_installment_1_at;
  const installment2Paid = !!po?.payment_installment_2_at;
  const bothInstallmentsPaid = installment1Paid && installment2Paid;

  const nextStatus = useMemo(() => {
    if (!po) return null;
    if (po.status === "cancelled" || po.status === "received") return null;
    if (po.status === "in_warehouse") return null; // handled via receive flow
    if (po.status === "priced" && !installment1Paid) return null; // gate on installment 1
    const i = PO_FLOW.indexOf(po.status as any);
    if (i < 0) return null;
    return PO_FLOW[i + 1] ?? null;
  }, [po, installment1Paid]);

  const allowedNext = (target: string) => {
    if (!canTransition || !po) return false;
    if (target === "priced") return isAdmin || isCFO;
    return isAdmin || isPurchasing;
  };

  const transitionTo = async (target: string) => {
    if (!po || !user) return;
    setBusy(true);
    try {
      const updates: any = { status: target, updated_at: new Date().toISOString() };
      if (target === "shipped") { updates.shipped_at = new Date().toISOString(); }
      const { error: upErr } = await supabase.from("purchase_orders").update(updates).eq("id", po.id);
      if (upErr) throw upErr;
      const { error: hErr } = await supabase.from("po_status_history").insert({
        po_id: po.id, from_status: po.status, to_status: target,
        note: note.trim() || null, actor_id: user.id, actor_email: user.email,
      });
      if (hErr) throw hErr;
      setNote("");
      toast.success(isAr ? `تم التحديث إلى: ${statusLabel(target, true)}` : `Updated to: ${statusLabel(target, false)}`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  const togglePayment = async (n: 1 | 2, paid: boolean, amount?: number) => {
    if (!po || !user) return;
    setBusy(true);
    try {
      const ts = paid ? new Date().toISOString() : null;
      const upd: any =
        n === 1
          ? { payment_installment_1_at: ts, payment_installment_1_by_email: paid ? user.email : null, payment_installment_1_amount: paid ? (amount ?? po.payment_installment_1_amount ?? null) : null }
          : { payment_installment_2_at: ts, payment_installment_2_by_email: paid ? user.email : null, payment_installment_2_amount: paid ? (amount ?? po.payment_installment_2_amount ?? null) : null };
      const { error } = await supabase.from("purchase_orders").update(upd).eq("id", po.id);
      if (error) throw error;
      await supabase.from("po_status_history").insert({
        po_id: po.id, from_status: po.status, to_status: po.status,
        note: paid ? (isAr ? `تم سداد الدفعة ${n}` : `Installment ${n} paid`) : (isAr ? `إلغاء الدفعة ${n}` : `Installment ${n} unmarked`),
        actor_id: user.id, actor_email: user.email,
      });
      toast.success(isAr ? "تم التحديث" : "Updated");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally { setBusy(false); }
  };

  const updateExpectedArrival = async (iso: string | null) => {
    if (!po) return;
    const { error } = await supabase.from("purchase_orders").update({ expected_arrival_at: iso }).eq("id", po.id);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم تحديث الوصول المتوقع" : "Expected arrival updated");
    await load();
  };

  const cancelPO = async () => {
    if (!po || !user) return;
    if (!confirm(isAr ? "تأكيد إلغاء أمر الشراء؟" : "Cancel this PO?")) return;
    await transitionTo("cancelled");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <Activity className="h-5 w-5 text-primary" />
              {isAr ? "تتبع أمر الشراء" : "PO Tracking"}
              <span className="font-mono text-sm text-muted-foreground">{po?.po_number}</span>
              {po && statusBadge(po.status, isAr)}
            </DialogTitle>
          </DialogHeader>

          {!po ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{isAr ? "جارٍ التحميل..." : "Loading..."}</div>
          ) : (
            <div className="space-y-5">
              {/* Stepper */}
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="flex flex-wrap items-stretch gap-2 sm:flex-nowrap sm:overflow-x-auto">
                  {PO_FLOW.map((s, i) => {
                    const done = po.status !== "cancelled" && i < currentIdx;
                    const active = po.status === s;
                    return (
                      <div key={s} className="flex min-w-[110px] flex-1 flex-col items-center gap-1 rounded-md border bg-background p-2 text-center"
                           style={{
                             borderColor: active ? "hsl(var(--primary))" : done ? "hsl(var(--success, 142 70% 45%))" : undefined,
                             background: active ? "hsl(var(--primary)/0.08)" : done ? "hsl(var(--success, 142 70% 45%)/0.08)" : undefined,
                           }}>
                        <div className={`grid h-7 w-7 place-items-center rounded-full ${active ? "bg-primary text-primary-foreground" : done ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"}`}>
                          {done ? <CheckCircle2 className="h-4 w-4" /> : statusIcon(s, "h-3.5 w-3.5")}
                        </div>
                        <div className="text-[10px] font-medium leading-tight">{statusLabel(s, isAr)}</div>
                      </div>
                    );
                  })}
                </div>
                {po.status === "cancelled" && (
                  <div className="mt-3 flex items-center gap-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                    <XCircle className="h-4 w-4" /> {isAr ? "تم إلغاء هذا الأمر" : "This PO is cancelled"}
                  </div>
                )}
              </div>

              {/* Quick facts */}
              <div className="grid gap-2 text-xs sm:grid-cols-3">
                <Fact label={isAr ? "تاريخ الشحن" : "Shipped at"} value={po.shipped_at ? fmtDateTime(po.shipped_at, lang) : "—"} />
                <Fact label={isAr ? "الوصول المتوقع" : "Expected arrival"} value={po.expected_arrival_at ? fmtDateTime(po.expected_arrival_at, lang) : "—"} />
                <Fact label={isAr ? "تاريخ الاستلام" : "Received at"} value={po.received_at ? fmtDateTime(po.received_at, lang) : "—"} />
              </div>

              {/* Payments — installment 1 after Priced, installment 2 after Received */}
              {(po.status === "priced" || po.status === "ordered" || po.status === "shipped" || po.status === "in_warehouse" || po.status === "received") && (
                <div className="rounded-lg border bg-card p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Wallet className="h-4 w-4 text-primary" />
                    {isAr ? "الدفعات (دفعتان)" : "Payments (2 installments)"}
                    {bothInstallmentsPaid && (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30 text-[10px]">
                        {isAr ? "مكتمل" : "Complete"}
                      </Badge>
                    )}
                  </div>

                  <div className="text-[11px] text-muted-foreground">
                    {isAr
                      ? "الدفعة الأولى بعد التسعير وقبل الطلب · الدفعة الثانية بعد الاستلام."
                      : "Installment 1 after Priced (before Ordered) · Installment 2 after Received."}
                  </div>

                  <InstallmentRow
                    n={1}
                    isAr={isAr}
                    paidAt={po.payment_installment_1_at}
                    amount={po.payment_installment_1_amount}
                    byEmail={po.payment_installment_1_by_email}
                    canEdit={canTransition}
                    onToggle={(paid, amt) => togglePayment(1, paid, amt)}
                    busy={busy}
                  />

                  {po.status === "received" ? (
                    <InstallmentRow
                      n={2}
                      isAr={isAr}
                      paidAt={po.payment_installment_2_at}
                      amount={po.payment_installment_2_amount}
                      byEmail={po.payment_installment_2_by_email}
                      canEdit={canTransition}
                      onToggle={(paid, amt) => togglePayment(2, paid, amt)}
                      busy={busy}
                    />
                  ) : (
                    <div className="rounded-md border border-dashed bg-muted/20 p-2.5 text-[11px] text-muted-foreground">
                      {isAr
                        ? "الدفعة الثانية ستُفعَّل بعد تأكيد الاستلام."
                        : "Installment 2 unlocks after the PO is Received."}
                    </div>
                  )}

                  {po.status === "priced" && !installment1Paid && (
                    <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 p-2 text-xs text-amber-800">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                      {isAr
                        ? "لا يمكن الانتقال إلى «تم الطلب» قبل تأكيد الدفعة الأولى."
                        : "Cannot move to Ordered until Installment 1 is paid."}
                    </div>
                  )}
                </div>
              )}

              {/* Expected arrival — visible from shipped onwards */}
              {(po.status === "shipped" || po.status === "in_warehouse") && (
                <div className="rounded-lg border bg-card p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Truck className="h-4 w-4 text-violet-600" />
                    {isAr ? "الوصول المتوقع" : "Expected arrival"}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="date"
                      value={po.expected_arrival_at ? new Date(po.expected_arrival_at).toISOString().slice(0, 10) : ""}
                      onChange={(e) => updateExpectedArrival(e.target.value ? new Date(e.target.value).toISOString() : null)}
                      disabled={busy || !canTransition}
                      className="w-44"
                    />
                    {po.expected_arrival_at && (
                      <span className="text-xs text-muted-foreground">
                        {fmtDateTime(po.expected_arrival_at, lang)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              {po.status !== "cancelled" && po.status !== "received" && canTransition && (
                <div className="rounded-lg border bg-card p-4 space-y-3">
                  <div className="text-sm font-semibold">{isAr ? "الإجراء التالي" : "Next Action"}</div>
                  <Textarea
                    placeholder={isAr ? "ملاحظة (اختياري)" : "Note (optional)"}
                    value={note} onChange={(e) => setNote(e.target.value)}
                    rows={2}
                  />
                  <div className="flex flex-wrap gap-2">
                    {nextStatus && allowedNext(nextStatus) && (
                      <Button onClick={() => transitionTo(nextStatus)} disabled={busy} className="gap-2">
                        {statusIcon(nextStatus)}
                        {isAr ? `تحديث إلى: ${statusLabel(nextStatus, true)}` : `Move to: ${statusLabel(nextStatus, false)}`}
                      </Button>
                    )}
                    {po.status === "in_warehouse" && (isAdmin || isPurchasing) && (
                      <Button onClick={() => setReceiveOpen(true)} disabled={busy} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                        <Package className="h-4 w-4" />
                        {isAr ? "تأكيد الاستلام وإضافة للمخزون" : "Confirm Receive → Inventory"}
                      </Button>
                    )}
                    {canCancel && (
                      <Button variant="outline" onClick={cancelPO} disabled={busy} className="gap-2 text-destructive hover:text-destructive">
                        <XCircle className="h-4 w-4" /> {isAr ? "إلغاء الأمر" : "Cancel PO"}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Timeline */}
              <div className="rounded-lg border bg-card p-4">
                <div className="mb-3 text-sm font-semibold">{isAr ? "السجل الزمني" : "Timeline"}</div>
                {history.length === 0 ? (
                  <div className="text-xs text-muted-foreground">{isAr ? "لا توجد تحركات بعد." : "No movements yet."}</div>
                ) : (
                  <ol className="relative space-y-3 ps-5 before:absolute before:inset-y-1 before:start-[7px] before:w-px before:bg-border">
                    {[...history].reverse().map((h) => (
                      <li key={h.id} className="relative">
                        <span className="absolute -start-[18px] top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-primary ring-4 ring-background" />
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          {statusBadge(h.to_status, isAr)}
                          <span className="text-xs text-muted-foreground">{fmtDateTime(h.created_at, lang)}</span>
                        </div>
                        {h.actor_email && <div className="text-[11px] text-muted-foreground">{h.actor_email}</div>}
                        {h.note && <div className="mt-1 text-xs">{h.note}</div>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {receiveOpen && po && (
        <ReceiveDialog
          po={po}
          items={items}
          open={receiveOpen}
          onOpenChange={setReceiveOpen}
          onDone={() => { setReceiveOpen(false); load(); }}
        />
      )}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function ReceiveDialog({
  po, items, open, onOpenChange, onDone,
}: {
  po: PO;
  items: POItem[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((i) => [i.id, i.quantity]))
  );
  const [busy, setBusy] = useState(false);

  const total = items.reduce((s, i) => s + i.quantity, 0);
  const totalRecv = items.reduce((s, i) => s + (qty[i.id] ?? 0), 0);

  const submit = async () => {
    if (!user) return;
    if (totalRecv <= 0) {
      toast.error(isAr ? "أدخل كمية مستلمة على الأقل لبند واحد" : "Enter received qty for at least one item");
      return;
    }
    setBusy(true);
    try {
      const payload = items.map((i) => ({ item_id: i.id, received_qty: Math.max(0, Math.min(i.quantity, Math.floor(qty[i.id] ?? 0))) }));
      const { data, error } = await (supabase as any).rpc("apply_po_to_inventory", {
        p_po_id: po.id,
        items_in: payload,
        p_actor_email: user.email ?? "",
      });
      if (error) throw error;
      const fully = data?.fully_received;
      toast.success(isAr
        ? (fully ? "تم الاستلام وإضافته للمخزون بالكامل" : "تم استلام جزء وإضافته للمخزون")
        : (fully ? "Received & inventory updated" : "Partial receipt applied to inventory"));
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-emerald-600" />
            {isAr ? "تأكيد الاستلام" : "Confirm Receive"}
            <span className="font-mono text-sm text-muted-foreground">{po.po_number}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs flex gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-600" />
          <span>{isAr
            ? "سيتم إضافة الكميات المستلمة لمخزون كل منتج بدقة. هذه العملية لا يمكن تكرارها لنفس الأمر."
            : "Received quantities will be added to each product's stock. This operation cannot be repeated for the same PO."}</span>
        </div>

        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-3 rounded-lg border bg-card p-2">
              <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded border bg-muted">
                {it.image_url ? <img src={it.image_url} alt={it.product_name} className="h-full w-full object-cover" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{it.product_name}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  {it.serial_number && <span className="font-mono">S/N: {it.serial_number}</span>}
                  {it.color && (
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-full border" style={swatchStyle(it.color)} />
                      {it.color}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-end text-xs text-muted-foreground">
                  <div>{isAr ? "المطلوب" : "Ordered"}</div>
                  <div className="text-base font-bold tabular-nums text-foreground">{it.quantity}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">{isAr ? "مستلم" : "Received"}</div>
                  <Input
                    type="number" min={0} max={it.quantity}
                    value={qty[it.id] ?? 0}
                    onChange={(e) => setQty((q) => ({ ...q, [it.id]: parseInt(e.target.value) || 0 }))}
                    className="w-20 text-center tabular-nums"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between rounded-md bg-muted/40 p-3 text-sm">
          <span>{isAr ? "الإجمالي" : "Total"}</span>
          <span className="font-bold tabular-nums">{totalRecv} / {total}</span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
            <Package className="me-2 h-4 w-4" />
            {isAr ? "تأكيد وإضافة للمخزون" : "Confirm & Add to Inventory"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InstallmentRow({
  n, isAr, paidAt, amount, byEmail, canEdit, onToggle, busy,
}: {
  n: 1 | 2;
  isAr: boolean;
  paidAt: string | null;
  amount: number | null;
  byEmail: string | null;
  canEdit: boolean;
  onToggle: (paid: boolean, amount?: number) => void;
  busy: boolean;
}) {
  const [amt, setAmt] = useState<string>(amount != null ? String(amount) : "");
  useEffect(() => { setAmt(amount != null ? String(amount) : ""); }, [amount]);
  const paid = !!paidAt;
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-md border p-2.5 ${paid ? "bg-emerald-500/5 border-emerald-500/30" : "bg-muted/30"}`}>
      <div className={`grid h-8 w-8 place-items-center rounded-full ${paid ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"}`}>
        {paid ? <CheckCircle2 className="h-4 w-4" /> : <Wallet className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-[120px]">
        <div className="text-sm font-medium">
          {isAr ? `الدفعة ${n}` : `Installment ${n}`}
        </div>
        {paid && (
          <div className="text-[11px] text-muted-foreground">
            {paidAt ? new Date(paidAt).toLocaleString() : ""}
            {byEmail ? ` · ${byEmail}` : ""}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground">USD</span>
        <Input
          type="number" min={0} step="0.01"
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          disabled={!canEdit || busy}
          className="w-24 text-end tabular-nums"
          placeholder="0.00"
        />
      </div>
      {canEdit && (
        paid ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onToggle(false)}>
            {isAr ? "تراجع" : "Unmark"}
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => onToggle(true, amt ? parseFloat(amt) : undefined)} className="bg-emerald-600 hover:bg-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5 me-1" />
            {isAr ? "تأكيد الدفع" : "Mark Paid"}
          </Button>
        )
      )}
    </div>
  );
}
