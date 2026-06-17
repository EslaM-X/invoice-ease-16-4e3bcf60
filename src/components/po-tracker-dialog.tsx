import { swatchStyle } from "@/lib/color-swatch";
import { ColorSwatch } from "@/components/color-swatch";
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
import { CheckCircle2, Circle, Truck, Package, DollarSign, Wallet, ShoppingBag, Warehouse, XCircle, Activity, AlertCircle, History, RefreshCw as RefreshCwIcon, Search, Eye, EyeOff, BellDot, CheckCheck, Filter } from "lucide-react";
import { toast } from "sonner";
import { HistoricalReceiptDialog } from "@/components/historical-receipt-dialog";

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
  shipment_type: string | null;
  shipment_code: string | null;
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
  received_without_payment?: boolean | null;
};

type POItem = {
  id: string;
  product_id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  image_url: string | null;
  quantity: number;
  received_qty: number;
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

type ReceiptRow = {
  id: string;
  receipt_number: number;
  receipt_code: string | null;
  total_qty: number;
  notes: string | null;
  actor_email: string | null;
  created_at: string;
  discount_amount?: number | null;
  po_receipt_items: {
    id: string;
    po_item_id: string | null;
    product_id: string | null;
    product_name: string;
    serial_number: string | null;
    color: string | null;
    quantity: number;
    stock_before: number | null;
    stock_after: number | null;
  }[];
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
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [historicalOpen, setHistoricalOpen] = useState(false);
  const [detailReceipt, setDetailReceipt] = useState<ReceiptRow | null>(null);

  // Timeline filters
  const [tlType, setTlType] = useState<"all" | "status" | "shipment" | "historical">("all");
  const [tlActor, setTlActor] = useState("");
  const [tlFrom, setTlFrom] = useState("");
  const [tlTo, setTlTo] = useState("");

  // Batch list filters
  const [batchSearch, setBatchSearch] = useState("");
  const [batchActor, setBatchActor] = useState("");
  const [batchFrom, setBatchFrom] = useState("");
  const [batchTo, setBatchTo] = useState("");

  // Per-user / per-PO read state for timeline events (localStorage)
  const readKey = useMemo(
    () => (user?.id && poId ? `po-tl-read:${user.id}:${poId}` : ""),
    [user?.id, poId],
  );
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!readKey) return;
    try {
      const raw = localStorage.getItem(readKey);
      setReadIds(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    } catch { setReadIds(new Set()); }
  }, [readKey]);
  const persistRead = (next: Set<string>) => {
    setReadIds(new Set(next));
    if (readKey) {
      try { localStorage.setItem(readKey, JSON.stringify([...next])); } catch {}
    }
  };
  const toggleRead = (id: string) => {
    const next = new Set(readIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    persistRead(next);
  };
  const markAllRead = () => persistRead(new Set(history.map((h) => h.id)));
  const markAllUnread = () => persistRead(new Set());

  const classifyEvent = (h: HistoryRow): "shipment" | "historical" | "status" => {
    const n = h.note ?? "";
    if (n.startsWith("[SHIPMENT_EDIT]")) return "shipment";
    if (n.startsWith("[HISTORICAL_RECEIPT]")) return "historical";
    return "status";
  };

  const filteredHistory = useMemo(() => {
    const actor = tlActor.trim().toLowerCase();
    const from = tlFrom ? new Date(tlFrom).getTime() : null;
    const to = tlTo ? new Date(tlTo).getTime() + 24 * 3600 * 1000 - 1 : null;
    return history.filter((h) => {
      if (tlType !== "all" && classifyEvent(h) !== tlType) return false;
      if (actor && !(h.actor_email ?? "").toLowerCase().includes(actor)) return false;
      const t = new Date(h.created_at).getTime();
      if (from !== null && t < from) return false;
      if (to !== null && t > to) return false;
      return true;
    });
  }, [history, tlType, tlActor, tlFrom, tlTo]);

  const unreadCounts = useMemo(() => {
    const c = { all: 0, status: 0, shipment: 0, historical: 0 };
    history.forEach((h) => {
      if (readIds.has(h.id)) return;
      c.all++;
      c[classifyEvent(h)]++;
    });
    return c;
  }, [history, readIds]);

  const load = async () => {
    const [{ data: p }, { data: it }, { data: h }, { data: rc }] = await Promise.all([
      supabase.from("purchase_orders").select("*").eq("id", poId).maybeSingle(),
      supabase.from("purchase_order_items").select("*").eq("po_id", poId).order("created_at"),
      supabase.from("po_status_history").select("*").eq("po_id", poId).order("created_at", { ascending: true }),
      (supabase as any)
        .from("po_receipts")
        .select("id,receipt_number,receipt_code,total_qty,notes,discount_amount,actor_email,created_at,po_receipt_items(id,po_item_id,product_id,product_name,serial_number,color,quantity,stock_before,stock_after)")
        .eq("po_id", poId)
        .order("receipt_number", { ascending: false }),
    ]);
    setPo((p as any) ?? null);
    setItems((it as any) ?? []);
    setHistory((h as any) ?? []);
    setReceipts((rc as any) ?? []);
  };

  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, poId]);
  useRealtimeTable("po_status_history", () => { if (open) load(); }, [open, poId]);
  useRealtimeTable("purchase_orders", () => { if (open) load(); }, [open, poId]);
  useRealtimeTable("purchase_order_items", () => { if (open) load(); }, [open, poId]);
  useRealtimeTable("po_receipts" as any, () => { if (open) load(); }, [open, poId]);
  useRealtimeTable("po_receipt_items" as any, () => { if (open) load(); }, [open, poId]);

  const totalOrdered = items.reduce((s, i) => s + i.quantity, 0);
  const totalReceived = items.reduce((s, i) => s + (i.received_qty || 0), 0);
  const totalRemaining = Math.max(0, totalOrdered - totalReceived);
  const isPartial = totalReceived > 0 && totalRemaining > 0;
  const canReceive = (po?.status === "shipped" || po?.status === "in_warehouse") && totalRemaining > 0 && (isAdmin || isPurchasing);

  const batchActors = useMemo(
    () => Array.from(new Set(receipts.map((r) => r.actor_email).filter(Boolean) as string[])).sort(),
    [receipts],
  );
  const filteredReceipts = useMemo(() => {
    const q = batchSearch.trim().toLowerCase();
    const from = batchFrom ? new Date(batchFrom).getTime() : null;
    const to = batchTo ? new Date(batchTo).getTime() + 24 * 3600 * 1000 - 1 : null;
    return receipts.filter((r) => {
      if (batchActor && (r.actor_email ?? "") !== batchActor) return false;
      const t = new Date(r.created_at).getTime();
      if (from !== null && t < from) return false;
      if (to !== null && t > to) return false;
      if (!q) return true;
      const code = (r.receipt_code || `#${r.receipt_number}`).toLowerCase();
      return (
        code.includes(q) ||
        String(r.receipt_number).includes(q) ||
        (r.actor_email ?? "").toLowerCase().includes(q) ||
        (r.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [receipts, batchSearch, batchActor, batchFrom, batchTo]);
  const batchFiltersActive = !!(batchSearch || batchActor || batchFrom || batchTo);

  const canTransition = isAdmin || isPurchasing || isCFO;
  const canCancel = isAdmin;

  const currentIdx = po ? PO_FLOW.indexOf(po.status as any) : -1;

  const installment1Paid = !!po?.payment_installment_1_at;
  const installment2Paid = !!po?.payment_installment_2_at;
  const bothInstallmentsPaid = installment1Paid && installment2Paid;

  const receivedUnpaid = !!po?.received_without_payment;

  const nextStatus = useMemo(() => {
    if (!po) return null;
    if (po.status === "cancelled" || po.status === "received") return null;
    if (po.status === "in_warehouse") return null; // handled via receive flow
    if (po.status === "priced" && !installment1Paid && !receivedUnpaid) return null; // gate on installment 1 unless receive-without-payment
    const i = PO_FLOW.indexOf(po.status as any);
    if (i < 0) return null;
    return PO_FLOW[i + 1] ?? null;
  }, [po, installment1Paid, receivedUnpaid]);

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

  const toggleReceivedWithoutPayment = async (val: boolean) => {
    if (!po || !user) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("purchase_orders")
        .update({ received_without_payment: val } as any)
        .eq("id", po.id);
      if (error) throw error;
      await supabase.from("po_status_history").insert({
        po_id: po.id, from_status: po.status, to_status: po.status,
        note: val
          ? (isAr ? "تم تعليم: مستلم بدون دفع للمورد" : "Marked: received without supplier payment")
          : (isAr ? "إلغاء: مستلم بدون دفع" : "Unmarked: received without payment"),
        actor_id: user.id, actor_email: user.email,
      });
      toast.success(isAr ? "تم التحديث" : "Updated");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally { setBusy(false); }
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
              {po && isPartial && (
                <Badge variant="outline" className="gap-1 bg-amber-500/15 text-amber-700 border-amber-500/40">
                  <Package className="h-3 w-3" />
                  {isAr ? `تسليم جزئي · متبقي ${totalRemaining}` : `Partial · ${totalRemaining} remaining`}
                </Badge>
              )}
              {po && receivedUnpaid && !installment1Paid && (
                <Badge variant="outline" className="gap-1 bg-rose-500/15 text-rose-700 border-rose-500/40">
                  <AlertCircle className="h-3 w-3" />
                  {isAr ? "غير مدفوع للمورد" : "Unpaid to supplier"}
                </Badge>
              )}
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

                  {/* Receive-without-payment toggle */}
                  {canTransition && !bothInstallmentsPaid && (
                    <label className="flex items-start gap-2 rounded-md border border-dashed border-rose-500/40 bg-rose-500/5 p-2.5 text-xs cursor-pointer hover:bg-rose-500/10 transition">
                      <input
                        type="checkbox"
                        checked={receivedUnpaid}
                        disabled={busy}
                        onChange={(e) => toggleReceivedWithoutPayment(e.target.checked)}
                        className="mt-0.5 accent-rose-600"
                      />
                      <div className="flex-1">
                        <div className="font-semibold text-rose-700">
                          {isAr ? "مستلم بدون دفع للمورد" : "Received without supplier payment"}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {isAr
                            ? "فعّل هذا الخيار لتسجيل الاستلام والمتابعة في المراحل قبل تأكيد دفع المورد. سيظهر شارة «غير مدفوع» في كل مكان."
                            : "Enable to advance through stages and receive stock before confirming supplier payment. An «Unpaid» badge will show everywhere."}
                        </div>
                      </div>
                    </label>
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
                    {canReceive && (
                      <Button onClick={() => setReceiveOpen(true)} disabled={busy} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                        <Package className="h-4 w-4" />
                        {isAr
                          ? (isPartial ? `استلام دفعة جديدة (متبقي ${totalRemaining})` : "تأكيد الاستلام وإضافة للمخزون")
                          : (isPartial ? `Receive next batch (${totalRemaining} left)` : "Confirm Receive → Inventory")}
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

              {/* Timeline + Change Log */}
              <div className="rounded-lg border bg-card p-4">
                <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {isAr ? "السجل الزمني وسجل التغييرات" : "Timeline & Change Log"}
                    {unreadCounts.all > 0 && (
                      <Badge className="gap-1 bg-rose-500 text-white hover:bg-rose-600">
                        <BellDot className="h-3 w-3" />
                        {unreadCounts.all} {isAr ? "جديد" : "new"}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground">
                      {filteredHistory.length}/{history.length} {isAr ? "حدث" : "events"}
                    </span>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={markAllRead} disabled={unreadCounts.all === 0}>
                      <CheckCheck className="h-3 w-3" />
                      {isAr ? "تعليم الكل مقروء" : "Mark all read"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={markAllUnread} disabled={readIds.size === 0}>
                      <EyeOff className="h-3 w-3" />
                      {isAr ? "ارجاع غير مقروء" : "Mark all unread"}
                    </Button>
                  </div>
                </div>

                {/* Filters */}
                <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/30 p-2">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                  {(["all", "status", "shipment", "historical"] as const).map((t) => {
                    const active = tlType === t;
                    const label = t === "all" ? (isAr ? "الكل" : "All")
                      : t === "status" ? (isAr ? "حالات" : "Status")
                      : t === "shipment" ? (isAr ? "تعديل شحنة" : "Shipment")
                      : (isAr ? "تاريخية" : "Historical");
                    const cnt = unreadCounts[t];
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTlType(t)}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                          active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
                        }`}
                      >
                        {label}
                        {cnt > 0 && (
                          <span className={`rounded-full px-1.5 text-[10px] font-bold ${active ? "bg-primary-foreground/20" : "bg-rose-500/15 text-rose-600"}`}>
                            {cnt}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  <div className="relative">
                    <Search className="pointer-events-none absolute start-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={tlActor}
                      onChange={(e) => setTlActor(e.target.value)}
                      placeholder={isAr ? "بحث بالمنفّذ…" : "Search actor…"}
                      className="h-7 w-44 ps-7 text-[11px]"
                    />
                  </div>
                  <Input type="date" value={tlFrom} onChange={(e) => setTlFrom(e.target.value)} className="h-7 w-36 text-[11px]" />
                  <span className="text-[11px] text-muted-foreground">→</span>
                  <Input type="date" value={tlTo} onChange={(e) => setTlTo(e.target.value)} className="h-7 w-36 text-[11px]" />
                  {(tlType !== "all" || tlActor || tlFrom || tlTo) && (
                    <button
                      type="button"
                      onClick={() => { setTlType("all"); setTlActor(""); setTlFrom(""); setTlTo(""); }}
                      className="ms-auto text-[11px] text-muted-foreground underline hover:text-foreground"
                    >
                      {isAr ? "مسح المرشّحات" : "Clear filters"}
                    </button>
                  )}
                </div>

                {filteredHistory.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    {history.length === 0
                      ? (isAr ? "لا توجد تحركات بعد." : "No movements yet.")
                      : (isAr ? "لا توجد نتائج مطابقة للمرشّحات." : "No events match the filters.")}
                  </div>
                ) : (
                  <ol className="relative space-y-3 ps-5 before:absolute before:inset-y-1 before:start-[7px] before:w-px before:bg-border">
                    {[...filteredHistory].reverse().map((h) => {
                      const kind = classifyEvent(h);
                      const isShipEdit = kind === "shipment";
                      const isHistRec = kind === "historical";
                      const isRead = readIds.has(h.id);
                      const dotCls = isShipEdit ? "bg-blue-500" : isHistRec ? "bg-violet-500" : "bg-primary";
                      const cleanNote = (h.note ?? "").replace(/^\[(SHIPMENT_EDIT|HISTORICAL_RECEIPT)\]\s*/, "");
                      return (
                        <li key={h.id} className={`relative rounded-md transition ${!isRead ? "bg-rose-500/5 ring-1 ring-rose-500/20 p-2 -ms-2" : ""}`}>
                          <span className={`absolute -start-[18px] top-2 grid h-3.5 w-3.5 place-items-center rounded-full ring-4 ring-background ${dotCls} ${!isRead ? "animate-pulse" : ""}`} />
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            {isShipEdit ? (
                              <Badge variant="outline" className="gap-1 bg-blue-500/15 text-blue-700 border-blue-500/30">
                                <RefreshCwIcon className="h-3 w-3" />
                                {isAr ? "تعديل تصنيف الشحنة" : "Shipment reclassified"}
                              </Badge>
                            ) : isHistRec ? (
                              <Badge variant="outline" className="gap-1 bg-violet-500/15 text-violet-700 border-violet-500/30">
                                <History className="h-3 w-3" />
                                {isAr ? "دفعة استلام تاريخية" : "Historical receipt"}
                              </Badge>
                            ) : (
                              statusBadge(h.to_status, isAr)
                            )}
                            <span className="text-xs text-muted-foreground">{fmtDateTime(h.created_at, lang)}</span>
                            {!isRead && (
                              <Badge className="h-4 gap-0.5 bg-rose-500 px-1.5 text-[9px] text-white hover:bg-rose-600">
                                {isAr ? "جديد" : "NEW"}
                              </Badge>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleRead(h.id)}
                              className="ms-auto inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent"
                              title={isRead ? (isAr ? "ارجاع غير مقروء" : "Mark unread") : (isAr ? "تعليم مقروء" : "Mark read")}
                            >
                              {isRead ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                              {isRead ? (isAr ? "غير مقروء" : "Unread") : (isAr ? "مقروء" : "Read")}
                            </button>
                          </div>
                          {h.actor_email && <div className="text-[11px] text-muted-foreground">{h.actor_email}</div>}
                          {cleanNote && (
                            <div className={`mt-1 text-xs ${isShipEdit || isHistRec ? "rounded-md border bg-muted/30 px-2 py-1 font-mono" : ""}`}>
                              {cleanNote}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>


              {/* Receipts (batches) */}
              {(receipts.length > 0 || isPartial || (isAdmin || isPurchasing)) && (
                <div className="rounded-lg border bg-card p-4">
                  <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Package className="h-4 w-4 text-emerald-600" />
                      {isAr ? "دفعات الاستلام" : "Receipt Batches"}
                    </div>
                    <div className="flex items-center gap-2">
                      {(isAdmin || isPurchasing) && totalRemaining > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 border-violet-500/40 text-violet-700 hover:bg-violet-500/10"
                          onClick={() => setHistoricalOpen(true)}
                        >
                          <History className="h-3.5 w-3.5" />
                          {isAr ? "إضافة دفعة تاريخية" : "Add historical batch"}
                        </Button>
                      )}
                      <div className="text-[11px] tabular-nums text-muted-foreground">
                        {isAr
                          ? `إجمالي مستلم: ${totalReceived} / ${totalOrdered} · متبقي ${totalRemaining}`
                          : `Received: ${totalReceived} / ${totalOrdered} · ${totalRemaining} left`}
                      </div>
                    </div>
                  </div>
                  {receipts.length === 0 ? (
                    <div className="text-xs text-muted-foreground">{isAr ? "لا توجد دفعات بعد." : "No batches yet."}</div>
                  ) : (
                    <div className="space-y-4">
                      {/* Per-item breakdown: ordered vs received per batch, with remaining */}
                      <div className="rounded-md border bg-background">
                        <div className="border-b bg-muted/40 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                          {isAr ? "ملخص الكميات لكل منتج" : "Per-item summary"}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[520px] text-xs">
                            <thead className="bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground">
                              <tr>
                                <th className="p-2 text-start">{isAr ? "المنتج" : "Item"}</th>
                                <th className="p-2 text-center">{isAr ? "مطلوب" : "Ordered"}</th>
                                <th className="p-2 text-center">{isAr ? "مستلم" : "Received"}</th>
                                <th className="p-2 text-center">{isAr ? "متبقي" : "Remaining"}</th>
                                <th className="p-2 text-start">{isAr ? "تفاصيل الدفعات" : "Batches"}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {items.map((it) => {
                                const ordered = it.quantity;
                                const perBatch = receipts
                                  .map((r) => {
                                    const qty = (r.po_receipt_items ?? [])
                                      .filter((ri) => ri.po_item_id === it.id || (ri.product_id && ri.product_id === (it as any).product_id))
                                      .reduce((s, ri) => s + (ri.quantity || 0), 0);
                                    return { code: r.receipt_code || `#${r.receipt_number}`, qty, at: r.created_at };
                                  })
                                  .filter((b) => b.qty > 0);
                                const received = perBatch.reduce((s, b) => s + b.qty, 0);
                                const remaining = Math.max(0, ordered - received);
                                return (
                                  <tr key={it.id} className={remaining === 0 ? "bg-emerald-500/5" : ""}>
                                    <td className="p-2">
                                      <div className="flex items-center gap-2">
                                        <span className="truncate font-medium">{it.product_name}</span>
                                        {it.color && (
                                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                            <ColorSwatch value={it.color} size="sm" />
                                            {it.color}
                                          </span>
                                        )}
                                      </div>
                                      {it.serial_number && (
                                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{it.serial_number}</div>
                                      )}
                                    </td>
                                    <td className="p-2 text-center tabular-nums font-semibold">{ordered}</td>
                                    <td className="p-2 text-center tabular-nums font-semibold text-emerald-700">{received}</td>
                                    <td className={`p-2 text-center tabular-nums font-bold ${remaining === 0 ? "text-emerald-700" : "text-amber-700"}`}>{remaining}</td>
                                    <td className="p-2">
                                      {perBatch.length === 0 ? (
                                        <span className="text-[10px] text-muted-foreground">{isAr ? "لم يُستلم بعد" : "Not received yet"}</span>
                                      ) : (
                                        <div className="flex flex-wrap gap-1">
                                          {perBatch.map((b, idx) => (
                                            <span
                                              key={idx}
                                              title={fmtDateTime(b.at, lang)}
                                              className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                                            >
                                              <span className="font-mono">{b.code}</span>
                                              <span className="tabular-nums">+{b.qty}</span>
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      {/* Batch list toolbar: search / actor / date range */}
                      {receipts.length > 1 && (
                        <div className="rounded-md border bg-background p-2 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="relative flex-1 min-w-[180px]">
                              <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                              <Input
                                value={batchSearch}
                                onChange={(e) => setBatchSearch(e.target.value)}
                                placeholder={isAr ? "ابحث برقم / كود الدفعة / ملاحظة / مستخدم" : "Search by # / code / note / user"}
                                className="h-7 ps-7 text-xs"
                              />
                            </div>
                            <select
                              value={batchActor}
                              onChange={(e) => setBatchActor(e.target.value)}
                              className="h-7 rounded-md border bg-background px-2 text-xs"
                            >
                              <option value="">{isAr ? "كل المستخدمين" : "All users"}</option>
                              {batchActors.map((a) => (
                                <option key={a} value={a}>{a}</option>
                              ))}
                            </select>
                            <Input
                              type="date"
                              value={batchFrom}
                              onChange={(e) => setBatchFrom(e.target.value)}
                              className="h-7 w-[140px] text-xs"
                              title={isAr ? "من تاريخ" : "From date"}
                            />
                            <Input
                              type="date"
                              value={batchTo}
                              onChange={(e) => setBatchTo(e.target.value)}
                              className="h-7 w-[140px] text-xs"
                              title={isAr ? "إلى تاريخ" : "To date"}
                            />
                            {batchFiltersActive && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => { setBatchSearch(""); setBatchActor(""); setBatchFrom(""); setBatchTo(""); }}
                              >
                                {isAr ? "مسح الفلاتر" : "Clear"}
                              </Button>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {filteredReceipts.length} / {receipts.length} {isAr ? "دفعة ظاهرة" : "batches visible"}
                          </div>
                        </div>
                      )}
                      <div className="space-y-2">
                      {filteredReceipts.length === 0 && batchFiltersActive && (
                        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                          {isAr ? "لا توجد دفعات مطابقة للفلاتر." : "No batches match the filters."}
                        </div>
                      )}
                      {filteredReceipts.map((r) => {
                        const lines = r.po_receipt_items ?? [];
                        const distinctProducts = new Set(lines.map((ri) => ri.product_id ?? ri.product_name)).size;
                        const stockDelta = lines.reduce((s, ri) => s + ((ri.stock_after ?? 0) - (ri.stock_before ?? 0)), 0);
                        return (
                        <div key={r.id} className="rounded-md border bg-muted/20 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-sm font-semibold">
                              <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-extrabold text-white tracking-wide">{r.receipt_code || `#${r.receipt_number}`}</span>
                              {isAr ? "دفعة" : "Batch"}
                              <span className="tabular-nums text-emerald-700">+{r.total_qty}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 text-xs"
                                onClick={() => setDetailReceipt(r)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                                {isAr ? "تفاصيل كاملة" : "Full details"}
                              </Button>
                              <div className="text-[11px] text-muted-foreground">
                                {fmtDateTime(r.created_at, lang)}
                                {r.actor_email ? ` · ${r.actor_email}` : ""}
                              </div>
                            </div>
                          </div>
                          {/* Per-batch inventory impact summary */}
                          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <div className="rounded border bg-background px-2 py-1.5">
                              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{isAr ? "بنود" : "Lines"}</div>
                              <div className="text-sm font-bold tabular-nums">{lines.length}</div>
                            </div>
                            <div className="rounded border bg-background px-2 py-1.5">
                              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{isAr ? "منتجات متميزة" : "Products"}</div>
                              <div className="text-sm font-bold tabular-nums">{distinctProducts}</div>
                            </div>
                            <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5">
                              <div className="text-[9px] uppercase tracking-wider text-emerald-700">{isAr ? "إضافة للمخزون" : "Stock added"}</div>
                              <div className="text-sm font-bold tabular-nums text-emerald-700">+{stockDelta}</div>
                            </div>
                            <div className="rounded border bg-background px-2 py-1.5">
                              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{isAr ? "متبقي بعد الدفعة" : "Remaining after"}</div>
                              <div className="text-sm font-bold tabular-nums text-amber-700">
                                {Math.max(0, totalOrdered - receipts.filter((x) => x.receipt_number <= r.receipt_number).reduce((s, x) => s + (x.total_qty || 0), 0))}
                              </div>
                            </div>
                          </div>
                          {r.notes && <div className="mt-2 text-xs italic text-muted-foreground">{r.notes}</div>}
                          {Number(r.discount_amount ?? 0) > 0 && (
                            <div className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                              {isAr ? "خصم داخلي" : "Internal discount"}: {Number(r.discount_amount).toFixed(2)}
                              <span className="text-[9px] opacity-70">({isAr ? "لا يُطبع" : "not printed"})</span>
                            </div>
                          )}
                          <div className="mt-2 space-y-1">
                            {lines.map((ri) => {
                              const delta = (ri.stock_after ?? 0) - (ri.stock_before ?? 0);
                              return (
                              <div key={ri.id} className="flex flex-wrap items-center gap-2 rounded border bg-background px-2 py-1 text-xs">
                                <span className="flex-1 truncate font-medium">{ri.product_name}</span>
                                {ri.color && (
                                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                                    <ColorSwatch value={ri.color} size="sm" />
                                    {ri.color}
                                  </span>
                                )}
                                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-bold tabular-nums text-emerald-700">+{ri.quantity}</span>
                                <span className="tabular-nums text-muted-foreground">
                                  {ri.stock_before ?? 0} → <span className="font-semibold text-foreground">{ri.stock_after ?? 0}</span>
                                  <span className={`ms-1 font-bold ${delta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                                    ({delta >= 0 ? "+" : ""}{delta})
                                  </span>
                                </span>
                              </div>
                              );
                            })}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                    </div>
                  )}
                </div>
              )}
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

      {historicalOpen && po && (
        <HistoricalReceiptDialog
          poId={po.id}
          poNumber={po.shipment_code || po.po_number}
          items={items}
          open={historicalOpen}
          onOpenChange={setHistoricalOpen}
          onSaved={() => { setHistoricalOpen(false); load(); }}
        />
      )}

      {detailReceipt && (
        <BatchDetailsDialog
          receipt={detailReceipt}
          poItems={items}
          poNumber={po?.shipment_code || po?.po_number || ""}
          open={!!detailReceipt}
          onOpenChange={(v) => !v && setDetailReceipt(null)}
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

  // Only items that still have remaining qty
  const openItems = useMemo(
    () => items.filter((i) => (i.quantity - (i.received_qty || 0)) > 0),
    [items],
  );
  const remainingMap = useMemo(
    () => Object.fromEntries(openItems.map((i) => [i.id, i.quantity - (i.received_qty || 0)] as const)),
    [openItems],
  );

  // Default: receive all remaining
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(openItems.map((i) => [i.id, i.quantity - (i.received_qty || 0)])),
  );
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState<number>(0);
  const [stockNow, setStockNow] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  // Live current stock per product (the "before" the user verifies against)
  useEffect(() => {
    if (!open) return;
    const ids = Array.from(new Set(openItems.map((i) => i.product_id)));
    if (ids.length === 0) { setStockNow({}); return; }
    (async () => {
      const { data } = await supabase.from("products").select("id,stock_quantity").in("id", ids);
      const m: Record<string, number> = {};
      (data ?? []).forEach((p: any) => { m[p.id] = p.stock_quantity; });
      setStockNow(m);
    })();
  }, [open, openItems]);

  const totalRemaining = openItems.reduce((s, i) => s + remainingMap[i.id], 0);
  const totalRecv = openItems.reduce((s, i) => s + (qty[i.id] ?? 0), 0);
  const wouldFinish = openItems.every((i) => (qty[i.id] ?? 0) >= remainingMap[i.id]);

  const setItemQty = (id: string, n: number) => {
    const max = remainingMap[id] ?? 0;
    const clamped = Math.max(0, Math.min(max, Math.floor(isFinite(n) ? n : 0)));
    setQty((q) => ({ ...q, [id]: clamped }));
  };

  const submit = async () => {
    if (!user) return;
    if (totalRecv <= 0) {
      toast.error(isAr ? "أدخل كمية مستلمة على الأقل لبند واحد" : "Enter received qty for at least one item");
      return;
    }
    setBusy(true);
    try {
      const payload = openItems
        .map((i) => ({ item_id: i.id, received_qty: qty[i.id] ?? 0 }))
        .filter((x) => x.received_qty > 0);
      const { data, error } = await (supabase as any).rpc("apply_po_receipt", {
        p_po_id: po.id,
        items_in: payload,
        p_notes: notes.trim(),
        p_actor_email: user.email ?? "",
      });
      if (error) throw error;
      const fully = data?.fully_received;
      const batch = data?.receipt_number;
      // Persist UI-only discount on the just-created receipt row (latest for this PO).
      if (discount > 0) {
        const { data: latest } = await supabase
          .from("po_receipts")
          .select("id")
          .eq("po_id", po.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latest?.id) {
          await supabase.from("po_receipts").update({ discount_amount: discount } as any).eq("id", latest.id);
        }
      }
      toast.success(isAr
        ? (fully ? `تم استلام الدفعة #${batch} وإغلاق الشحنة بالكامل` : `تم تسجيل الدفعة #${batch} · لا يزال هناك متبقي`)
        : (fully ? `Batch #${batch} received · PO closed` : `Batch #${batch} saved · partial`));
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Package className="h-5 w-5 text-emerald-600" />
            {isAr ? "تسجيل دفعة استلام" : "Record Receipt Batch"}
            <span className="font-mono text-sm text-muted-foreground">{po.po_number}</span>
            <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30 text-[10px]">
              {isAr ? `متبقي ${totalRemaining}` : `${totalRemaining} remaining`}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-md bg-sky-500/10 border border-sky-500/30 p-3 text-xs flex gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-sky-600" />
          <span>{isAr
            ? "راجع المخزون الحالي لكل منتج (المخزون قبل) وتأكد من الكمية المستلمة قبل التأكيد. يمكنك استلام الباقي على دفعات لاحقة."
            : "Review each product's current stock (before) and confirm the received quantity. Remaining items can be received in later batches."}</span>
        </div>

        <div className="space-y-2">
          {openItems.length === 0 ? (
            <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              {isAr ? "لا توجد بنود متبقية للاستلام." : "No items left to receive."}
            </div>
          ) : openItems.map((it) => {
            const remaining = remainingMap[it.id];
            const recv = qty[it.id] ?? 0;
            const before = stockNow[it.product_id];
            const after = before != null ? before + recv : null;
            const alreadyReceived = it.received_qty || 0;
            return (
              <div key={it.id} className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded border bg-muted">
                    {it.image_url ? <img src={it.image_url} alt={it.product_name} className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{it.product_name}</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      {it.serial_number && <span className="font-mono">S/N: {it.serial_number}</span>}
                      {it.color && (
                        <span className="inline-flex items-center gap-1">
                          <ColorSwatch value={it.color} size="sm" />
                          {it.color}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                  <Mini label={isAr ? "المطلوب" : "Ordered"} value={it.quantity} />
                  <Mini label={isAr ? "سبق استلامه" : "Already received"} value={alreadyReceived} tone={alreadyReceived > 0 ? "text-emerald-700" : ""} />
                  <Mini label={isAr ? "المتبقي" : "Remaining"} value={remaining} tone="text-amber-700" />
                  <Mini label={isAr ? "المخزون قبل" : "Stock before"} value={before ?? "—"} tone="text-muted-foreground" />
                  <Mini label={isAr ? "المخزون بعد" : "Stock after"} value={after ?? "—"} tone={recv > 0 ? "text-sky-700 font-bold" : "text-muted-foreground"} />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">{isAr ? "هذه الدفعة:" : "This batch:"}</span>
                  <Button type="button" size="sm" variant="outline" className="h-7 px-2"
                    onClick={() => setItemQty(it.id, recv - 1)} disabled={recv <= 0}>−</Button>
                  <Input
                    type="number" min={0} max={remaining}
                    value={recv}
                    onChange={(e) => setItemQty(it.id, parseInt(e.target.value))}
                    className="w-20 text-center tabular-nums h-8"
                  />
                  <Button type="button" size="sm" variant="outline" className="h-7 px-2"
                    onClick={() => setItemQty(it.id, recv + 1)} disabled={recv >= remaining}>+</Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px]"
                    onClick={() => setItemQty(it.id, remaining)}>
                    {isAr ? "كل المتبقي" : "All remaining"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px]"
                    onClick={() => setItemQty(it.id, 0)}>
                    {isAr ? "صفر" : "Zero"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {openItems.length > 0 && (
          <>
            <div className="rounded-md border bg-amber-50/40 dark:bg-amber-500/5 border-amber-500/30 p-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="text-xs font-medium">{isAr ? "خصم على هذه الدفعة (للعرض فقط — لا يُطبع)" : "Discount on this batch (UI only — not printed)"}</label>
                <span className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400">{isAr ? "داخلي" : "Internal"}</span>
              </div>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
                placeholder="0.00"
                className="h-8"
              />
            </div>
            <Textarea
              placeholder={isAr ? "ملاحظة على هذه الدفعة (اختياري) — رقم البوليصة، اسم الشاحنة..." : "Note on this batch (optional) — waybill, truck..."}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </>
        )}

        <div className="flex items-center justify-between rounded-md bg-muted/40 p-3 text-sm">
          <span>{isAr ? "إجمالي هذه الدفعة" : "Batch total"}</span>
          <div className="flex items-center gap-3">
            <span className="font-bold tabular-nums">{totalRecv} / {totalRemaining}</span>
            <Badge variant="outline" className={wouldFinish && totalRecv > 0
              ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30"
              : "bg-amber-500/15 text-amber-700 border-amber-500/30"}>
              {wouldFinish && totalRecv > 0
                ? (isAr ? "ستكتمل الشحنة" : "Will close PO")
                : (isAr ? "سيظل متبقي" : "Will stay partial")}
            </Badge>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={submit} disabled={busy || totalRecv <= 0} className="bg-emerald-600 hover:bg-emerald-700">
            <Package className="me-2 h-4 w-4" />
            {isAr ? "تأكيد الدفعة وإضافتها للمخزون" : "Confirm Batch → Add to Inventory"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Mini({ label, value, tone = "" }: { label: string; value: any; tone?: string }) {
  return (
    <div className="rounded border bg-muted/30 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
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
