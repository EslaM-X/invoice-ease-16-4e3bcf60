import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtDateTime } from "@/lib/utils-money";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Truck, CheckCircle2, FileEdit, PackageX, Ban, CircleDollarSign,
  Clock, ArrowRight, History,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";

export type DRStatus = "draft" | "out_for_delivery" | "signed" | "paid" | "returned" | "cancelled";

export const STATUS_META: Record<DRStatus, { ar: string; en: string; icon: any; tone: string; ring: string }> = {
  draft:            { ar: "مسودة",         en: "Draft",            icon: FileEdit,        tone: "bg-muted text-muted-foreground border-border",              ring: "ring-muted-foreground/30" },
  out_for_delivery: { ar: "في الطريق",     en: "Out for delivery", icon: Truck,           tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",       ring: "ring-sky-500/50" },
  signed:           { ar: "موقَّع",          en: "Signed",           icon: CheckCircle2,    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", ring: "ring-emerald-500/50" },
  paid:             { ar: "مدفوع ومغلق",   en: "Paid & closed",    icon: CircleDollarSign, tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",     ring: "ring-violet-500/50" },
  returned:         { ar: "راجع",          en: "Returned",         icon: PackageX,        tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",         ring: "ring-amber-500/50" },
  cancelled:        { ar: "ملغي",          en: "Cancelled",        icon: Ban,             tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",             ring: "ring-rose-500/50" },
};

export function StatusBadge({ status, isAr, size = "sm" }: { status: DRStatus; isAr: boolean; size?: "sm" | "md" }) {
  const m = STATUS_META[status] ?? STATUS_META.draft;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold ${m.tone} ${size === "md" ? "text-xs px-3 py-1" : "text-[10px]"}`}>
      <Icon className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} />
      {isAr ? m.ar : m.en}
    </span>
  );
}

async function changeStatus(receiptId: string, next: DRStatus, reason?: string) {
  const { error } = await supabase.rpc("change_delivery_receipt_status" as any, {
    _receipt_id: receiptId,
    _new_status: next,
    _reason: reason ?? null,
  });
  if (error) throw error;
}

const STEPS: DRStatus[] = ["draft", "out_for_delivery", "signed", "paid"];

export function StatusStepper({ status, isAr }: { status: DRStatus; isAr: boolean }) {
  const isTerminalBad = status === "returned" || status === "cancelled";
  const currentIdx = isTerminalBad ? -1 : STEPS.indexOf(status);
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      {STEPS.map((s, i) => {
        const meta = STATUS_META[s];
        const Icon = meta.icon;
        const done = currentIdx >= i;
        const current = currentIdx === i;
        return (
          <div key={s} className="flex items-center gap-2 sm:gap-3">
            <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
              current ? `${meta.tone} ring-2 ${meta.ring}` : done ? meta.tone : "bg-muted text-muted-foreground/70 border-border"
            }`}>
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{isAr ? meta.ar : meta.en}</span>
            </div>
            {i < STEPS.length - 1 && <ArrowRight className={`h-3 w-3 ${isAr ? "rotate-180" : ""} ${done && currentIdx > i ? "text-emerald-500" : "text-muted-foreground/40"}`} />}
          </div>
        );
      })}
      {isTerminalBad && (
        <div className="ms-2">
          <StatusBadge status={status} isAr={isAr} size="md" />
        </div>
      )}
    </div>
  );
}

function ReasonDialog({ label, trigger, onConfirm }: { label: string; trigger: React.ReactNode; onConfirm: (reason: string) => void }) {
  const [r, setR] = useState("");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}</AlertDialogTitle>
          <AlertDialogDescription>اختياري — اكتب سبباً أو ملاحظة</AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea value={r} onChange={(e) => setR(e.target.value)} placeholder="السبب…" rows={3} />
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(r)}>تأكيد</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Compact actions used in a table row */
export function StatusActions({ receipt, isAr, onChanged }: { receipt: any; isAr: boolean; onChanged?: () => void }) {
  const status = receipt.status as DRStatus;
  const run = async (next: DRStatus, reason?: string) => {
    try {
      await changeStatus(receipt.id, next, reason);
      toast.success(isAr ? "تم التحديث" : "Updated");
      onChanged?.();
    } catch (e: any) { toast.error(e?.message || "Error"); }
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {status === "draft" && (
        <Button size="sm" variant="outline" className="gap-1 rounded-full" onClick={() => run("out_for_delivery")}>
          <Truck className="h-3.5 w-3.5" />{isAr ? "في الطريق" : "Ship"}
        </Button>
      )}
      {status === "out_for_delivery" && (
        <>
          <Button size="sm" variant="outline" className="gap-1 rounded-full" onClick={() => run("signed")}>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />{isAr ? "استلام" : "Sign"}
          </Button>
          <ReasonDialog
            label={isAr ? "تأكيد الإرجاع" : "Confirm return"}
            trigger={<Button size="sm" variant="outline" className="gap-1 rounded-full"><PackageX className="h-3.5 w-3.5 text-amber-600" />{isAr ? "راجع" : "Returned"}</Button>}
            onConfirm={(r) => run("returned", r)}
          />
        </>
      )}
      {(status === "draft" || status === "out_for_delivery") && (
        <ReasonDialog
          label={isAr ? "إلغاء المحضر" : "Cancel receipt"}
          trigger={<Button size="sm" variant="ghost" className="gap-1 rounded-full text-rose-600"><Ban className="h-3.5 w-3.5" />{isAr ? "إلغاء" : "Cancel"}</Button>}
          onConfirm={(r) => run("cancelled", r)}
        />
      )}
      {(status === "returned" || status === "cancelled") && (
        <Button size="sm" variant="ghost" className="gap-1 rounded-full" onClick={() => run("draft")}>
          <FileEdit className="h-3.5 w-3.5" />{isAr ? "إعادة فتح" : "Reopen"}
        </Button>
      )}
    </div>
  );
}

/** Full panel: stepper + actions + live timeline */
export function DeliveryReceiptTracker({ receipt, isAr, onChanged }: { receipt: any; isAr: boolean; onChanged?: () => void }) {
  const [audit, setAudit] = useState<any[]>([]);

  const loadAudit = async () => {
    const { data } = await supabase
      .from("delivery_receipt_audit_log" as any)
      .select("*")
      .eq("receipt_id", receipt.id)
      .order("created_at", { ascending: false });
    setAudit((data ?? []) as any[]);
  };
  useEffect(() => { loadAudit(); }, [receipt.id]);
  useRealtimeTable("delivery_receipt_audit_log" as any, () => loadAudit());
  useRealtimeTable("delivery_receipts" as any, () => onChanged?.());

  const status = receipt.status as DRStatus;
  const meta = STATUS_META[status] ?? STATUS_META.draft;

  return (
    <div className="no-print space-y-4 rounded-3xl border bg-card p-5 shadow-elegant">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full border ${meta.tone}`}>
            <meta.icon className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{isAr ? "حالة المحضر" : "Receipt status"}</div>
            <div className="text-base font-bold">{isAr ? meta.ar : meta.en}</div>
            {receipt.status_reason && (
              <div className="mt-0.5 text-[11px] text-muted-foreground">{receipt.status_reason}</div>
            )}
          </div>
        </div>
        <StatusActions receipt={receipt} isAr={isAr} onChanged={onChanged} />
      </div>

      <StatusStepper status={status} isAr={isAr} />

      <div className="border-t pt-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <History className="h-3.5 w-3.5" />
          {isAr ? "خط زمني لحظي" : "Live timeline"}
          <span className="ms-auto text-[10px] text-muted-foreground/60">{audit.length} {isAr ? "حدث" : "events"}</span>
        </div>
        {audit.length === 0 ? (
          <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">{isAr ? "لا توجد أحداث" : "No events"}</div>
        ) : (
          <ol className="relative space-y-3 ps-5">
            <span className="absolute inset-y-0 start-1.5 w-px bg-border" />
            {audit.map((a) => {
              const changed: string[] = a.changed_fields ?? [];
              const statusChanged = changed.includes("status");
              const before = a.before_data?.status as DRStatus | undefined;
              const after = a.after_data?.status as DRStatus | undefined;
              const m = after ? STATUS_META[after] : STATUS_META.draft;
              const Icon = a.action === "created" ? FileEdit : statusChanged ? m.icon : Clock;
              return (
                <li key={a.id} className="relative">
                  <span className={`absolute -start-[18px] top-1 flex h-3 w-3 items-center justify-center rounded-full border-2 border-background ${statusChanged ? m.tone.split(" ")[0] : "bg-muted"}`} />
                  <div className="rounded-xl border bg-background/50 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Icon className="h-3.5 w-3.5" />
                      <span className="font-semibold">
                        {a.action === "created"
                          ? (isAr ? "تم إنشاء المحضر" : "Receipt created")
                          : a.action === "deleted"
                          ? (isAr ? "حذف" : "Deleted")
                          : statusChanged
                          ? (isAr ? `تغيير الحالة: ${STATUS_META[before ?? "draft"].ar} → ${STATUS_META[after ?? "draft"].ar}` : `Status: ${STATUS_META[before ?? "draft"].en} → ${STATUS_META[after ?? "draft"].en}`)
                          : (isAr ? "تعديل" : "Updated")}
                      </span>
                      <span className="ms-auto text-[10px] text-muted-foreground">{fmtDateTime(a.created_at, isAr ? "ar" : "en")}</span>
                    </div>
                    {a.actor_email && <div className="mt-1 text-[11px] text-muted-foreground">{a.actor_email}</div>}
                    {!statusChanged && changed.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {changed.slice(0, 8).map((f) => (
                          <span key={f} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{f}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
