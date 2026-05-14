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
  "payment_pending",
  "paid",
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
  user_id: string;
  paid_at: string | null;
  shipped_at: string | null;
  expected_arrival_at: string | null;
  received_at: string | null;
  stock_applied_at: string | null;
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

  const nextStatus = useMemo(() => {
    if (!po) return null;
    if (po.status === "cancelled" || po.status === "received") return null;
    if (po.status === "in_warehouse") return null; // handled via receive flow
    const i = PO_FLOW.indexOf(po.status as any);
    if (i < 0) return null;
    return PO_FLOW[i + 1] ?? null;
  }, [po]);

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
      if (target === "paid") { updates.paid_at = new Date().toISOString(); updates.paid_by = user.id; updates.paid_by_email = user.email; }
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
                <Fact label={isAr ? "تاريخ الدفع" : "Paid at"} value={po.paid_at ? fmtDateTime(po.paid_at, lang) : "—"} />
                <Fact label={isAr ? "تاريخ الشحن" : "Shipped at"} value={po.shipped_at ? fmtDateTime(po.shipped_at, lang) : "—"} />
                <Fact label={isAr ? "تاريخ الاستلام" : "Received at"} value={po.received_at ? fmtDateTime(po.received_at, lang) : "—"} />
              </div>

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
                      <span className="inline-block h-2 w-2 rounded-full border" style={{ background: it.color }} />
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
