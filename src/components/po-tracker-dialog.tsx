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
import { POPdfReceiptDialog } from "@/components/po-pdf-receipt-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FileText } from "lucide-react";

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
  const [backDeductOpen, setBackDeductOpen] = useState(false);
  const [pdfReceiveOpen, setPdfReceiveOpen] = useState(false);

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
                    {canReceive && (
                      <Button onClick={() => setPdfReceiveOpen(true)} disabled={busy} variant="outline" className="gap-2 border-indigo-500/40 text-indigo-700 hover:bg-indigo-500/10">
                        <FileText className="h-4 w-4" />
                        {isAr ? "استلام من PDF" : "Receive from PDF"}
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
                                     return {
                                       code: r.receipt_code || `#${r.receipt_number}`,
                                       qty,
                                       at: r.created_at,
                                       actor: r.actor_email || "",
                                       total: r.total_qty || 0,
                                     };
                                   })
                                   .filter((b) => b.qty > 0);
                                 const received = perBatch.reduce((s, b) => s + b.qty, 0);
                                 const remaining = Math.max(0, ordered - received);
                                 // Color palette per batch index (1-based)
                                 const batchPalette = [
                                   "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
                                   "border-sky-500/40 bg-sky-500/10 text-sky-700",
                                   "border-violet-500/40 bg-violet-500/10 text-violet-700",
                                   "border-amber-500/40 bg-amber-500/10 text-amber-700",
                                   "border-rose-500/40 bg-rose-500/10 text-rose-700",
                                   "border-teal-500/40 bg-teal-500/10 text-teal-700",
                                 ];
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
                                             <Popover key={idx}>
                                               <PopoverTrigger asChild>
                                                 <button
                                                   className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer hover:scale-105 transition-transform ${batchPalette[idx % batchPalette.length]}`}
                                                 >
                                                   <span className="font-mono">{b.code}</span>
                                                   <span className="tabular-nums">+{b.qty}</span>
                                                 </button>
                                               </PopoverTrigger>
                                               <PopoverContent className="w-72 text-xs p-3" align="start">
                                                 <div className="font-mono text-sm font-bold mb-1.5">{b.code}</div>
                                                 <div className="space-y-1 text-muted-foreground">
                                                   <div className="flex justify-between gap-2">
                                                     <span>{isAr ? "التاريخ:" : "Date:"}</span>
                                                     <span className="font-medium text-foreground">{fmtDateTime(b.at, lang)}</span>
                                                   </div>
                                                   <div className="flex justify-between gap-2">
                                                     <span>{isAr ? "كمية هذا المنتج:" : "Qty (this item):"}</span>
                                                     <span className="font-bold text-emerald-700 tabular-nums">+{b.qty}</span>
                                                   </div>
                                                   <div className="flex justify-between gap-2">
                                                     <span>{isAr ? "إجمالي الدفعة:" : "Batch total:"}</span>
                                                     <span className="font-medium text-foreground tabular-nums">{b.total}</span>
                                                   </div>
                                                   {b.actor && (
                                                     <div className="flex justify-between gap-2">
                                                       <span>{isAr ? "بواسطة:" : "By:"}</span>
                                                       <span className="font-medium text-foreground truncate" title={b.actor}>{b.actor}</span>
                                                     </div>
                                                   )}
                                                 </div>
                                               </PopoverContent>
                                             </Popover>
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
          onDone={async () => {
            setReceiveOpen(false);
            // Back-deductions are now applied automatically inside the receipt RPC.
            load();
          }}
        />
      )}

      {backDeductOpen && po && (
        <BackDeductReviewDialog
          poId={po.id}
          poNumber={po.shipment_code || po.po_number}
          open={backDeductOpen}
          onOpenChange={setBackDeductOpen}
          onDone={() => { setBackDeductOpen(false); load(); }}
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

      {pdfReceiveOpen && po && (
        <POPdfReceiptDialog
          open={pdfReceiveOpen}
          onOpenChange={setPdfReceiveOpen}
          poId={po.id}
          poNumber={po.shipment_code || po.po_number}
          items={items as any}
          onDone={() => { setPdfReceiveOpen(false); load(); }}
        />
      )}

      {detailReceipt && (
        <BatchDetailsDialog
          receipt={detailReceipt}
          poItems={items}
          poNumber={po?.shipment_code || po?.po_number || ""}
          open={!!detailReceipt}
          onOpenChange={(v: boolean) => !v && setDetailReceipt(null)}
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

  // Default: all zero — user explicitly sets quantities
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(openItems.map((i) => [i.id, 0])),
  );
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState<number>(0);
  const [stockNow, setStockNow] = useState<Record<string, number>>({});
  const [productMeta, setProductMeta] = useState<Record<string, { collection: string | null }>>({});
  const [busy, setBusy] = useState(false);
  const [colorFilter, setColorFilter] = useState<string>("all");
  const [collectionFilter, setCollectionFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [uniformQty, setUniformQty] = useState<string>("");

  // Live current stock + collection per product (the "before" the user verifies against)
  useEffect(() => {
    if (!open) return;
    const ids = Array.from(new Set(openItems.map((i) => i.product_id)));
    if (ids.length === 0) { setStockNow({}); setProductMeta({}); return; }
    (async () => {
      const { data } = await supabase.from("products").select("id,stock_quantity,collection").in("id", ids);
      const m: Record<string, number> = {};
      const meta: Record<string, { collection: string | null }> = {};
      (data ?? []).forEach((p: any) => { m[p.id] = p.stock_quantity; meta[p.id] = { collection: p.collection ?? null }; });
      setStockNow(m);
      setProductMeta(meta);
    })();
  }, [open, openItems]);

  const availableColors = useMemo(() => {
    const s = new Set<string>();
    openItems.forEach((i) => { if (i.color) s.add(i.color); });
    return Array.from(s).sort();
  }, [openItems]);
  const availableCollections = useMemo(() => {
    const s = new Set<string>();
    openItems.forEach((i) => { const c = productMeta[i.product_id]?.collection; if (c) s.add(c); });
    return Array.from(s).sort();
  }, [openItems, productMeta]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return openItems.filter((i) => {
      if (colorFilter !== "all" && (i.color ?? "") !== colorFilter) return false;
      if (collectionFilter !== "all" && (productMeta[i.product_id]?.collection ?? "") !== collectionFilter) return false;
      if (q) {
        const hay = `${i.product_name} ${i.serial_number ?? ""} ${i.color ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [openItems, colorFilter, collectionFilter, productMeta, search]);

  const fillAllRemaining = () => {
    setQty((prev) => {
      const next = { ...prev };
      visibleItems.forEach((i) => { next[i.id] = remainingMap[i.id] ?? 0; });
      return next;
    });
  };
  const applyUniform = () => {
    const n = Math.max(0, Math.floor(parseFloat(uniformQty) || 0));
    setQty((prev) => {
      const next = { ...prev };
      visibleItems.forEach((i) => {
        next[i.id] = Math.min(n, remainingMap[i.id] ?? 0);
      });
      return next;
    });
  };
  const zeroAll = () => {
    setQty((prev) => {
      const next = { ...prev };
      visibleItems.forEach((i) => { next[i.id] = 0; });
      return next;
    });
  };

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
      const { data, error } = await (supabase as any).rpc("apply_po_receipt_with_back_deduct", {
        p_po_id: po.id,
        items_in: payload,
        p_notes: notes.trim(),
        p_actor_email: user.email ?? "",
      });
      if (error) throw error;
      const receipt = data?.receipt ?? data;
      const fully = receipt?.fully_received;
      const bdCount = data?.back_deduct?.items ?? 0;
      if (bdCount > 0) {
        toast.success(isAr
          ? `تم خصم ${bdCount} محضر استلام تاريخي من المخزون تلقائيًا`
          : `Auto-deducted ${bdCount} historical receipt items from stock`);
      }
      const batch = receipt?.receipt_number;
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

        {/* Search + Bulk actions (always visible) */}
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isAr ? "بحث بالاسم / السيريال / اللون..." : "Search name / serial / color..."}
                className="ps-8 h-8 text-xs"
              />
            </div>
            <Input
              type="number" min={0}
              value={uniformQty}
              onChange={(e) => setUniformQty(e.target.value)}
              placeholder={isAr ? "كمية موحدة" : "Uniform qty"}
              className="w-28 h-8 text-xs text-center"
            />
            <Button type="button" size="sm" variant="outline" className="h-8 text-[11px]" onClick={applyUniform}>
              {isAr ? "تطبيق" : "Apply"}
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-8 text-[11px] gap-1 border-emerald-500/40 text-emerald-700 hover:bg-emerald-50" onClick={fillAllRemaining}>
              <CheckCheck className="h-3.5 w-3.5" />
              {isAr ? "ملء بالكامل" : "Fill remaining"}
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-8 text-[11px]" onClick={zeroAll}>
              {isAr ? "تصفير" : "Zero"}
            </Button>
          </div>
        </div>

        {(availableColors.length > 0 || availableCollections.length > 0) && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {isAr ? "تصفية البنود" : "Filter items"}
            </div>
            {availableCollections.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground me-1">{isAr ? "كولكشن:" : "Collection:"}</span>
                <button
                  onClick={() => setCollectionFilter("all")}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${collectionFilter === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"}`}
                >{isAr ? "الكل" : "All"}</button>
                {availableCollections.map((c) => (
                  <button key={c}
                    onClick={() => setCollectionFilter(c)}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${collectionFilter === c ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"}`}
                  >{c}</button>
                ))}
              </div>
            )}
            {availableColors.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground me-1">{isAr ? "لون:" : "Color:"}</span>
                <button
                  onClick={() => setColorFilter("all")}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${colorFilter === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"}`}
                >{isAr ? "الكل" : "All"}</button>
                {availableColors.map((c) => (
                  <button key={c}
                    onClick={() => setColorFilter(c)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${colorFilter === c ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"}`}
                    title={c}
                  >
                    <ColorSwatch value={c} size="xs" />
                    {c}
                  </button>
                ))}
              </div>
            )}
            {(colorFilter !== "all" || collectionFilter !== "all" || search) && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  {visibleItems.length} / {openItems.length} {isAr ? "بند ظاهر" : "items visible"}
                </span>
                <Button variant="ghost" size="sm" className="h-6 text-[11px]"
                  onClick={() => { setColorFilter("all"); setCollectionFilter("all"); setSearch(""); }}>
                  {isAr ? "مسح الفلاتر" : "Clear filters"}
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          {openItems.length === 0 ? (
            <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              {isAr ? "لا توجد بنود متبقية للاستلام." : "No items left to receive."}
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              {isAr ? "لا بنود مطابقة للفلاتر." : "No items match the filters."}
            </div>
          ) : visibleItems.map((it) => {
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

function BatchDetailsDialog({
  receipt,
  poItems,
  poNumber,
  open,
  onOpenChange,
}: {
  receipt: ReceiptRow;
  poItems: POItem[];
  poNumber: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { lang } = useI18n();
  const { user } = useAuth();
  const role = useRole();
  const canEdit = role.isAdmin || role.isPurchasing;
  const isAr = lang === "ar";
  const [editMode, setEditMode] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editDate, setEditDate] = useState<string>(() => {
    const d = new Date((receipt as any).receipt_date || receipt.created_at);
    // datetime-local format: YYYY-MM-DDTHH:mm
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 16);
  });
  const [editQty, setEditQty] = useState<Record<string, number>>({});
  const lines = receipt.po_receipt_items ?? [];

  // Build per-product summary with serial / color / before-after, comparing to PO ordered qty
  const perProduct = useMemo(() => {
    type Row = {
      key: string;
      product_id: string | null;
      product_name: string;
      serial_number: string | null;
      color: string | null;
      received_in_batch: number;
      ordered: number;
      stock_before: number | null;
      stock_after: number | null;
      delta: number;
    };
    const map = new Map<string, Row>();
    lines.forEach((ri) => {
      const key = ri.po_item_id || ri.product_id || ri.product_name;
      const poItem = poItems.find(
        (p) => p.id === ri.po_item_id || (ri.product_id && p.product_id === ri.product_id),
      );
      const existing = map.get(key);
      const delta = (ri.stock_after ?? 0) - (ri.stock_before ?? 0);
      if (existing) {
        existing.received_in_batch += ri.quantity || 0;
        existing.stock_after = ri.stock_after ?? existing.stock_after;
        existing.delta += delta;
      } else {
        map.set(key, {
          key,
          product_id: ri.product_id,
          product_name: ri.product_name,
          serial_number: ri.serial_number ?? poItem?.serial_number ?? null,
          color: ri.color ?? poItem?.color ?? null,
          received_in_batch: ri.quantity || 0,
          ordered: poItem?.quantity ?? 0,
          stock_before: ri.stock_before,
          stock_after: ri.stock_after,
          delta,
        });
      }
    });
    return Array.from(map.values());
  }, [lines, poItems]);

  const totalDelta = perProduct.reduce((s, r) => s + r.delta, 0);
  const isHistorical = (receipt.notes ?? "").toLowerCase().includes("historical") ||
    (receipt.notes ?? "").includes("تاريخية");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Package className="h-5 w-5 text-emerald-600" />
            {isAr ? "تفاصيل دفعة الاستلام" : "Receipt batch details"}
            <span className="rounded-md bg-emerald-600 px-2 py-0.5 font-mono text-xs font-bold text-white">
              {receipt.receipt_code || `#${receipt.receipt_number}`}
            </span>
            {poNumber && (
              <span className="text-xs font-normal text-muted-foreground">
                · {isAr ? "أمر شراء" : "PO"} {poNumber}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Meta panel */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fact
              label={isAr ? "نوع التحديث" : "Update type"}
              value={isHistorical ? (isAr ? "دفعة تاريخية" : "Historical receipt") : (isAr ? "استلام عادي" : "Regular receipt")}
            />
            {editMode ? (
              <div className="rounded-md border bg-amber-50 dark:bg-amber-500/10 border-amber-500/40 p-2">
                <div className="text-[10px] uppercase tracking-wider text-amber-700">{isAr ? "تاريخ الاستلام" : "Receipt date"}</div>
                <Input type="datetime-local" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="h-7 text-xs mt-1" />
              </div>
            ) : (
              <Fact
                label={isAr ? "التاريخ والوقت" : "Date & time"}
                value={fmtDateTime((receipt as any).receipt_date || receipt.created_at, lang)}
              />
            )}
            <Fact
              label={isAr ? "نفّذها" : "Performed by"}
              value={receipt.actor_email || "—"}
            />
            <Fact
              label={isAr ? "إجمالي الكميات" : "Total qty"}
              value={`+${receipt.total_qty}`}
            />
          </div>

          {/* Inventory impact */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-md border bg-background px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {isAr ? "بنود الدفعة" : "Batch lines"}
              </div>
              <div className="text-lg font-bold tabular-nums">{lines.length}</div>
            </div>
            <div className="rounded-md border bg-background px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {isAr ? "منتجات مختلفة" : "Distinct products"}
              </div>
              <div className="text-lg font-bold tabular-nums">{perProduct.length}</div>
            </div>
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-emerald-700">
                {isAr ? "إجمالي تغيير المخزون" : "Total stock change"}
              </div>
              <div className={`text-lg font-bold tabular-nums ${totalDelta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {totalDelta >= 0 ? "+" : ""}{totalDelta}
              </div>
            </div>
          </div>

          {/* Notes / reason */}
          {receipt.notes && (
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {isAr ? "سبب / ملاحظات" : "Reason / notes"}
              </div>
              <div className="whitespace-pre-wrap text-sm">{receipt.notes}</div>
            </div>
          )}

          {/* Per-product breakdown */}
          <div className="rounded-md border bg-background">
            <div className="border-b bg-muted/40 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {isAr ? "تفاصيل المنتجات: قبل وبعد" : "Per-product breakdown: before & after"}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-2 text-start">{isAr ? "المنتج" : "Product"}</th>
                    <th className="p-2 text-start">{isAr ? "السيريال" : "Serial #"}</th>
                    <th className="p-2 text-start">{isAr ? "اللون" : "Color"}</th>
                    <th className="p-2 text-center">{isAr ? "في الدفعة" : "In batch"}</th>
                    <th className="p-2 text-center">{isAr ? "إجمالي مطلوب" : "Ordered"}</th>
                    <th className="p-2 text-center">{isAr ? "مخزون قبل" : "Stock before"}</th>
                    <th className="p-2 text-center">{isAr ? "مخزون بعد" : "Stock after"}</th>
                    <th className="p-2 text-center">{isAr ? "الفرق" : "Δ"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {perProduct.map((r) => {
                    const draft = editQty[r.key];
                    const currentQty = draft ?? r.received_in_batch;
                    return (
                    <tr key={r.key}>
                      <td className="p-2 font-medium">{r.product_name}</td>
                      <td className="p-2 font-mono text-[10px] text-muted-foreground">
                        {r.serial_number || "—"}
                      </td>
                      <td className="p-2">
                        {r.color ? (
                          <span className="inline-flex items-center gap-1">
                            <ColorSwatch value={r.color} size="sm" />
                            <span className="text-[10px]">{r.color}</span>
                          </span>
                        ) : "—"}
                      </td>
                      <td className="p-2 text-center font-bold tabular-nums text-emerald-700">
                        {editMode ? (
                          <Input type="number" min={0} value={currentQty}
                            onChange={(e) => setEditQty((q) => ({ ...q, [r.key]: Math.max(0, parseInt(e.target.value) || 0) }))}
                            className="h-7 w-16 text-center text-xs mx-auto" />
                        ) : (
                          <>+{r.received_in_batch}</>
                        )}
                      </td>
                      <td className="p-2 text-center tabular-nums text-muted-foreground">{r.ordered || "—"}</td>
                      <td className="p-2 text-center tabular-nums text-muted-foreground">{r.stock_before ?? "—"}</td>
                      <td className="p-2 text-center font-semibold tabular-nums">{r.stock_after ?? "—"}</td>
                      <td className={`p-2 text-center font-bold tabular-nums ${r.delta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {r.delta >= 0 ? "+" : ""}{r.delta}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 flex-wrap">
          {canEdit && !editMode && (
            <>
              <Button
                variant="outline"
                className="border-rose-500/40 text-rose-700 hover:bg-rose-50"
                onClick={async () => {
                  if (!confirm(isAr
                    ? `حذف الدفعة ${receipt.receipt_code || "#" + receipt.receipt_number} وإرجاع المخزون؟`
                    : `Delete batch ${receipt.receipt_code || "#" + receipt.receipt_number} and roll back inventory?`)) return;
                  const { error } = await (supabase as any).rpc("delete_po_receipt_batch", {
                    p_receipt_id: receipt.id,
                    p_actor_email: user?.email ?? "",
                  });
                  if (error) return toast.error(error.message);
                  toast.success(isAr ? "تم الحذف وإرجاع المخزون" : "Deleted & rolled back");
                  onOpenChange(false);
                }}
              >
                {isAr ? "حذف الدفعة" : "Delete batch"}
              </Button>
              <Button variant="outline" onClick={() => setEditMode(true)} className="gap-1">
                <RefreshCwIcon className="h-3.5 w-3.5" />
                {isAr ? "تعديل" : "Edit"}
              </Button>
            </>
          )}
          {editMode && (
            <>
              <Button variant="outline" onClick={() => { setEditMode(false); setEditQty({}); }} disabled={savingEdit}>
                {isAr ? "إلغاء" : "Cancel"}
              </Button>
              <Button
                onClick={async () => {
                  setSavingEdit(true);
                  try {
                    const items = perProduct
                      .map((r) => {
                        const ri = lines.find((l) => (l.po_item_id && r.key === l.po_item_id) || (l.product_id && l.product_id === r.product_id));
                        const poItemId = ri?.po_item_id;
                        if (!poItemId) return null;
                        return { po_item_id: poItemId, new_qty: editQty[r.key] ?? r.received_in_batch };
                      })
                      .filter(Boolean);
                    const { error } = await (supabase as any).rpc("update_po_receipt_batch", {
                      p_receipt_id: receipt.id,
                      p_receipt_date: new Date(editDate).toISOString(),
                      p_items: items,
                      p_actor_email: user?.email ?? "",
                    });
                    if (error) throw error;
                    toast.success(isAr ? "تم الحفظ" : "Saved");
                    setEditMode(false);
                    onOpenChange(false);
                  } catch (e: any) {
                    toast.error(e?.message ?? "Failed");
                  } finally {
                    setSavingEdit(false);
                  }
                }}
                disabled={savingEdit}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {isAr ? "حفظ التعديلات" : "Save changes"}
              </Button>
            </>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isAr ? "إغلاق" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PendingBackDeductRow = {
  dri_id: string;
  receipt_id: string;
  receipt_delivered_at: string;
  invoice_id: string | null;
  invoice_number: string | null;
  customer_name: string | null;
  product_id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  quantity: number;
  current_stock: number;
};

function BackDeductReviewDialog({
  poId,
  poNumber,
  open,
  onOpenChange,
  onDone,
}: {
  poId: string;
  poNumber: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<PendingBackDeductRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      const { data, error } = await (supabase as any).rpc("list_pending_back_deductions", { p_po_id: poId });
      if (error) {
        toast.error(error.message);
        setRows([]);
      } else {
        const list = (data as PendingBackDeductRow[]) ?? [];
        setRows(list);
        setSelected(Object.fromEntries(list.map((r) => [r.dri_id, true])));
      }
      setLoading(false);
    })();
  }, [open, poId]);

  const totalSelectedQty = useMemo(
    () => rows.filter((r) => selected[r.dri_id]).reduce((s, r) => s + (r.quantity || 0), 0),
    [rows, selected],
  );
  const selectedCount = useMemo(
    () => rows.filter((r) => selected[r.dri_id]).length,
    [rows, selected],
  );
  const allSelected = rows.length > 0 && rows.every((r) => selected[r.dri_id]);

  const toggleAll = () => {
    const next = !allSelected;
    setSelected(Object.fromEntries(rows.map((r) => [r.dri_id, next])));
  };

  const confirm = async () => {
    if (!user) return;
    const ids = rows.filter((r) => selected[r.dri_id]).map((r) => r.dri_id);
    if (ids.length === 0) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("apply_back_deductions", {
        p_dri_ids: ids,
        p_from_po: poId,
        p_actor_email: user.email ?? "",
      });
      if (error) throw error;
      const items = (data as any)?.items ?? 0;
      const qty = (data as any)?.total_qty ?? 0;
      toast.success(isAr
        ? `تم خصم ${qty} قطعة من ${items} محضر استلام تاريخي`
        : `Deducted ${qty} units across ${items} historical receipts`);
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
            <AlertCircle className="h-5 w-5 text-amber-600" />
            {isAr ? "خصم محاضر استلام تاريخية" : "Back-deduct historical delivery receipts"}
            <span className="font-mono text-sm text-muted-foreground">{poNumber}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs">
          {isAr
            ? "تم العثور على بيع/تسليم سابق لمنتجات هذه الشحنة لم يُخصم بعد من المخزون. اختر اللي تأكدت من تسليمه فعلاً، وسيُخصم من رصيد المخزون مع تسجيل سجل تدقيق كامل."
            : "We found earlier deliveries/sales for products in this PO that haven't been deducted from stock yet. Tick the rows that were actually delivered — they will be deducted from stock and recorded in the audit log."}
        </div>

        {loading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">{isAr ? "جارٍ التحميل..." : "Loading..."}</div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            {isAr ? "لا توجد محاضر استلام تاريخية مطلوب خصمها." : "No historical receipts to deduct."}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 text-xs">
              <Button type="button" variant="outline" size="sm" onClick={toggleAll}>
                {allSelected ? (isAr ? "إلغاء تحديد الكل" : "Unselect all") : (isAr ? "تحديد الكل" : "Select all")}
              </Button>
              <div className="text-muted-foreground">
                {selectedCount} / {rows.length} {isAr ? "محضر" : "receipts"} · {isAr ? "إجمالي" : "Total"}: <b className="text-foreground tabular-nums">{totalSelectedQty}</b>
              </div>
            </div>
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="p-2 w-8"></th>
                    <th className="p-2 text-start">{isAr ? "التاريخ" : "Date"}</th>
                    <th className="p-2 text-start">{isAr ? "الفاتورة / العميل" : "Invoice / Customer"}</th>
                    <th className="p-2 text-start">{isAr ? "المنتج" : "Product"}</th>
                    <th className="p-2 text-center">{isAr ? "الكمية" : "Qty"}</th>
                    <th className="p-2 text-center">{isAr ? "المخزون الحالي" : "Stock now"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => {
                    const after = (r.current_stock || 0) - r.quantity;
                    const willGoNegative = after < 0;
                    return (
                      <tr key={r.dri_id} className={selected[r.dri_id] ? "bg-amber-50/40 dark:bg-amber-500/5" : ""}>
                        <td className="p-2 text-center">
                          <input
                            type="checkbox"
                            checked={!!selected[r.dri_id]}
                            onChange={(e) => setSelected((s) => ({ ...s, [r.dri_id]: e.target.checked }))}
                            className="h-4 w-4 cursor-pointer"
                          />
                        </td>
                        <td className="p-2 whitespace-nowrap text-[11px]">
                          {fmtDateTime(r.receipt_delivered_at, lang)}
                        </td>
                        <td className="p-2 text-[11px]">
                          <div className="font-mono">{r.invoice_number ?? "—"}</div>
                          <div className="text-muted-foreground truncate max-w-[180px]">{r.customer_name ?? "—"}</div>
                        </td>
                        <td className="p-2 text-[11px]">
                          <div className="font-semibold truncate max-w-[220px]">{r.product_name}</div>
                          <div className="text-muted-foreground flex flex-wrap items-center gap-2">
                            {r.serial_number && <span className="font-mono">{r.serial_number}</span>}
                            {r.color && (
                              <span className="inline-flex items-center gap-1">
                                <ColorSwatch value={r.color} size="xs" />
                                {r.color}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-2 text-center font-bold tabular-nums text-rose-700">−{r.quantity}</td>
                        <td className={`p-2 text-center tabular-nums ${willGoNegative && selected[r.dri_id] ? "text-rose-700 font-bold" : "text-muted-foreground"}`}>
                          {r.current_stock} → {after}
                          {willGoNegative && selected[r.dri_id] && (
                            <div className="text-[10px] text-rose-700">{isAr ? "سيصبح سالب!" : "Will go negative!"}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {isAr ? "تخطّي" : "Skip"}
          </Button>
          <Button onClick={confirm} disabled={busy || loading || selectedCount === 0} className="bg-amber-600 hover:bg-amber-700">
            {isAr ? `خصم ${selectedCount} محضر (${totalSelectedQty} قطعة)` : `Deduct ${selectedCount} receipts (${totalSelectedQty} units)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
