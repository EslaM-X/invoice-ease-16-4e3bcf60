import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { ColorSwatch } from "@/components/color-swatch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { History, AlertCircle, Package } from "lucide-react";
import { toast } from "sonner";

type POItem = {
  id: string;
  product_id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  image_url: string | null;
  quantity: number;
  received_qty: number;
};

/**
 * Backfill a historical receipt batch on an existing PO with a custom date.
 * Uses RPC `record_historical_po_receipt` (SECURITY DEFINER, admin/purchasing).
 *
 * `applyToInventory` defaults to false because historical batches are usually
 * already reflected in the current stock; toggle on only if the legacy paper
 * batch was never posted to the digital inventory.
 */
export function HistoricalReceiptDialog({
  poId,
  poNumber,
  items,
  open,
  onOpenChange,
  onSaved,
}: {
  poId: string;
  poNumber: string;
  items: POItem[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const openItems = useMemo(
    () => items.filter((i) => (i.quantity - (i.received_qty || 0)) > 0),
    [items],
  );
  const remainingMap = useMemo(
    () => Object.fromEntries(openItems.map((i) => [i.id, i.quantity - (i.received_qty || 0)] as const)),
    [openItems],
  );

  const [qty, setQty] = useState<Record<string, number>>({});
  const [localDt, setLocalDt] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [applyInv, setApplyInv] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQty(Object.fromEntries(openItems.map((i) => [i.id, 0])));
    setNotes("");
    setApplyInv(false);
    const d = new Date();
    d.setDate(d.getDate() - 7); // default to a week ago for historical entries
    const pad = (n: number) => String(n).padStart(2, "0");
    setLocalDt(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
  }, [open, openItems]);

  const totalRecv = openItems.reduce((s, i) => s + (qty[i.id] ?? 0), 0);

  const setItemQty = (id: string, n: number) => {
    const max = remainingMap[id] ?? 0;
    const clamped = Math.max(0, Math.min(max, Math.floor(isFinite(n) ? n : 0)));
    setQty((q) => ({ ...q, [id]: clamped }));
  };

  const submit = async () => {
    if (totalRecv <= 0) {
      toast.error(isAr ? "أدخل كمية لبند واحد على الأقل" : "Enter qty for at least one item");
      return;
    }
    if (!localDt) {
      toast.error(isAr ? "اختر تاريخ الاستلام التاريخي" : "Pick the historical receipt date");
      return;
    }
    const picked = new Date(localDt);
    if (isNaN(picked.getTime())) {
      toast.error(isAr ? "تاريخ غير صالح" : "Invalid date");
      return;
    }
    const now = new Date();
    if (picked.getTime() > now.getTime() + 60_000) {
      toast.error(
        isAr ? "لا يمكن إضافة دفعة بتاريخ مستقبلي" : "Future-dated batches are not allowed",
        { description: isAr ? "اختر تاريخاً سابقاً أو حالياً" : "Pick a past or current date" },
      );
      return;
    }
    // Guard: any per-item qty exceeds remaining (UI clamps, but double-check)
    const overflow = openItems.find((i) => (qty[i.id] ?? 0) > (remainingMap[i.id] ?? 0));
    if (overflow) {
      toast.error(
        isAr ? `الكمية تتجاوز المتبقي للبند: ${overflow.product_name}` : `Qty exceeds remaining: ${overflow.product_name}`,
      );
      return;
    }

    setBusy(true);
    try {
      const payload = openItems
        .map((i) => ({ item_id: i.id, received_qty: qty[i.id] ?? 0 }))
        .filter((x) => x.received_qty > 0);
      const { error } = await (supabase as any).rpc("record_historical_po_receipt", {
        _po_id: poId,
        _receipt_date: picked.toISOString(),
        _items: payload,
        _notes: notes.trim(),
        _apply_to_inventory: applyInv,
      });
      if (error) {
        // Friendlier server-side errors
        const msg = String(error.message || "");
        if (msg.includes("FUTURE_DATE_NOT_ALLOWED")) throw new Error(isAr ? "تاريخ مستقبلي غير مسموح" : "Future date not allowed");
        if (msg.includes("QTY_EXCEEDS_REMAINING")) throw new Error(isAr ? "الكمية تتجاوز المتبقي" : "Qty exceeds remaining");
        if (msg.includes("EMPTY_ITEMS")) throw new Error(isAr ? "لا توجد بنود" : "No items");
        if (msg.includes("forbidden") || msg.includes("42501")) throw new Error(isAr ? "غير مصرّح" : "Not authorized");
        throw error;
      }
      toast.success(
        isAr
          ? `تم تسجيل دفعة تاريخية · إجمالي ${totalRecv} · ${picked.toLocaleString("ar-EG")}`
          : `Historical batch recorded · qty ${totalRecv} · ${picked.toLocaleString()}`,
        {
          description: applyInv
            ? (isAr ? "تم تحديث المخزون فعلياً" : "Live inventory updated")
            : (isAr ? "بدون تأثير على المخزون" : "Inventory unchanged"),
        },
      );
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? (isAr ? "فشلت العملية" : "Failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <History className="h-5 w-5 text-violet-600" />
            {isAr ? "إضافة دفعة استلام تاريخية" : "Add Historical Receipt Batch"}
            <span className="font-mono text-sm text-muted-foreground">{poNumber}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-md bg-violet-500/10 border border-violet-500/30 p-3 text-xs flex gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-violet-600" />
          <span>
            {isAr
              ? "استخدم هذه الواجهة لتسجيل دفعات استلام قديمة من أوراق سابقة. اختر التاريخ الفعلي والكمية لكل بند."
              : "Use this to backfill old paper-receipt batches. Pick the actual past date and the qty per item."}
          </span>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs mb-1.5 block">{isAr ? "تاريخ ووقت الدفعة (محلي)" : "Batch date & time (local)"}</Label>
            <Input type="datetime-local" value={localDt} onChange={(e) => setLocalDt(e.target.value)} />
          </div>
          <div className="flex items-end">
            <label className="flex items-start gap-2 rounded-md border p-2.5 text-xs cursor-pointer hover:bg-muted/30 w-full">
              <Checkbox checked={applyInv} onCheckedChange={(v) => setApplyInv(!!v)} className="mt-0.5" />
              <span>
                <span className="font-semibold block">{isAr ? "تحديث المخزون فعلياً" : "Apply to live inventory"}</span>
                <span className="text-muted-foreground text-[11px]">
                  {isAr
                    ? "اتركه مغلقاً لو الكميات بالفعل في المخزون من الأوراق القديمة."
                    : "Leave off if those qtys are already in your current stock."}
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="space-y-2">
          {openItems.length === 0 ? (
            <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              {isAr ? "لا توجد بنود متبقية." : "No remaining items."}
            </div>
          ) : openItems.map((it) => {
            const remaining = remainingMap[it.id];
            const recv = qty[it.id] ?? 0;
            return (
              <div key={it.id} className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded border bg-muted">
                    {it.image_url ? <img src={it.image_url} alt={it.product_name} className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{it.product_name}</div>
                    <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                      {it.serial_number && <span className="font-mono">S/N: {it.serial_number}</span>}
                      {it.color && (
                        <span className="inline-flex items-center gap-1">
                          <ColorSwatch value={it.color} size="sm" />{it.color}
                        </span>
                      )}
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30 text-[10px]">
                        {isAr ? `متبقي ${remaining}` : `${remaining} left`}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">{isAr ? "كمية الدفعة:" : "Batch qty:"}</span>
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
                </div>
              </div>
            );
          })}
        </div>

        {openItems.length > 0 && (
          <Textarea
            placeholder={isAr ? "ملاحظة (اختياري) — رقم البوليصة القديمة، مرجع الورق..." : "Note (optional) — old waybill, paper ref…"}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        )}

        <div className="flex items-center justify-between rounded-md bg-muted/40 p-3 text-sm">
          <span>{isAr ? "إجمالي هذه الدفعة" : "Batch total"}</span>
          <span className="font-bold tabular-nums">{totalRecv}</span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={submit} disabled={busy || totalRecv <= 0} className="bg-violet-600 hover:bg-violet-700">
            <Package className="h-4 w-4 me-1.5" />
            {isAr ? "حفظ الدفعة التاريخية" : "Save historical batch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
