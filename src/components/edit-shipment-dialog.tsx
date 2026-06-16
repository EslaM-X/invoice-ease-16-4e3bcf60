/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { SHIPMENT_TYPES, shipmentMeta, type ShipmentType } from "@/lib/shipment-types";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const CAIRO_TZ = "Africa/Cairo";

function cairoParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CAIRO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    h: get("hour"),
    min: get("minute"),
    s: get("second"),
  };
}

function isoToCairoInput(iso: string) {
  const p = cairoParts(new Date(iso));
  return `${p.y}-${p.m}-${p.d}T${p.h}:${p.min}`;
}

function cairoOffsetMs(date: Date) {
  const p = cairoParts(date);
  const cairoAsUtc = Date.UTC(
    Number(p.y),
    Number(p.m) - 1,
    Number(p.d),
    Number(p.h),
    Number(p.min),
    Number(p.s),
  );
  return cairoAsUtc - date.getTime();
}

function cairoInputToIso(localValue: string) {
  const [datePart, timePart = "00:00"] = localValue.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [h, min] = timePart.split(":").map(Number);
  const wallClockUtc = Date.UTC(y, m - 1, d, h || 0, min || 0, 0);
  let utc = new Date(wallClockUtc - cairoOffsetMs(new Date(wallClockUtc)));
  utc = new Date(wallClockUtc - cairoOffsetMs(utc));
  return utc.toISOString();
}

/**
 * Edit a PO's shipment type and/or shipment date.
 * On save: calls the SECURITY DEFINER RPC `update_po_shipment` which also
 * re-numbers G/A/D codes for the user according to Cairo-time ordering.
 */
export function EditShipmentDialog({
  poId,
  currentType,
  currentDate,
  currentCode,
  open,
  onOpenChange,
  onSaved,
}: {
  poId: string;
  currentType: ShipmentType | null;
  currentDate: string | null;
  currentCode: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: (next: {
    po_number?: string | null;
    shipment_code: string | null;
    shipment_type: string;
    shipment_date: string | null;
  }) => void;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [type, setType] = useState<ShipmentType>((currentType as ShipmentType) || "grounded");
  const [localDt, setLocalDt] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType((currentType as ShipmentType) || "grounded");
    setLocalDt(isoToCairoInput(currentDate ?? new Date().toISOString()));
  }, [open, currentType, currentDate]);

  const save = async () => {
    setBusy(true);
    try {
      const iso = localDt ? cairoInputToIso(localDt) : null;
      const { data, error } = await (supabase as any).rpc("update_po_shipment", {
        _po_id: poId,
        _new_type: type,
        _new_date: iso,
      });
      if (error) throw error;
      const next = (data ?? {}) as {
        po_number?: string | null;
        shipment_code: string | null;
        shipment_type: string;
        shipment_date: string | null;
      };
      toast.success(
        isAr
          ? `تم تحديث الشحنة · الكود الجديد: ${next.shipment_code ?? "—"}`
          : `Shipment updated · new code: ${next.shipment_code ?? "—"}`,
      );
      onSaved?.(next);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" />
            {isAr ? "تعديل الشحنة" : "Edit Shipment"}
            {currentCode && (
              <Badge variant="outline" className="font-mono">
                {currentCode}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs flex gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600" />
            <span>
              {isAr
                ? "تغيير النوع أو التاريخ سيُعيد ترقيم أكواد الشحنات (G/A/D) تلقائياً لكل الأوامر حسب التسلسل الزمني بتوقيت القاهرة."
                : "Changing the type or date will automatically re-number all G/A/D shipment codes by Cairo-time order."}
            </span>
          </div>

          <div>
            <Label className="text-xs mb-2 block">{isAr ? "نوع الشحنة" : "Shipment type"}</Label>
            <div className="grid grid-cols-3 gap-2">
              {SHIPMENT_TYPES.map((t) => {
                const meta = shipmentMeta(t);
                const Icon = meta.icon;
                const active = type === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`rounded-lg border p-3 text-start transition ${active ? `ring-2 ${meta.ringSelectedClass} ${meta.surfaceClass}` : "hover:bg-muted/40"}`}
                  >
                    <div
                      className={`flex items-center gap-1.5 text-sm font-bold ${meta.accentTextClass}`}
                    >
                      <Icon className="h-4 w-4" />
                      {meta.prefix}
                    </div>
                    <div className="text-[11px] mt-1 font-medium">{meta.shortLabel(isAr)}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">
              {isAr ? "تاريخ ووقت الشحنة (توقيت محلي)" : "Shipment date & time (local)"}
            </Label>
            <Input
              type="datetime-local"
              value={localDt}
              onChange={(e) => setLocalDt(e.target.value)}
            />
            <div className="mt-1 text-[10px] text-muted-foreground">
              {isAr
                ? "هذا التاريخ يُستخدم لترتيب الأكواد G1/G2/A1... حسب توقيت القاهرة."
                : "Used to sort G1/G2/A1… codes by Cairo time."}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={save} disabled={busy}>
            <RefreshCw className="h-4 w-4 me-1.5" />
            {isAr ? "حفظ وإعادة الترقيم" : "Save & renumber"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
