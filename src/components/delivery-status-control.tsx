import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Truck, Package, CheckCircle2, User as UserIcon, Info, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";

const OVERRIDE_ALLOWED_USER_IDS = new Set<string>([
  "45f5f827-561f-4a81-bc60-4dd2aba38e10", // f.hesham@steinheim-eg.com
]);

type Profile = { id: string; user_id: string; display_name: string | null; email: string | null };
type Status = "pending" | "in_transit" | "partial" | "delivered";

type Props = {
  invoiceId: string;
  status: string | null;
  assigneeId: string | null;
  assigneeLabel: string | null;
  isVoided: boolean;
  onChanged: () => void;
};

const COMPANY_LABEL_KEY = "__company__";

export function DeliveryStatusControl({
  invoiceId, status, assigneeId, assigneeLabel, isVoided, onChanged,
}: Props) {
  const { lang } = useI18n();
  const { user } = useAuth();
  const isAr = lang === "ar";
  const canOverride = !!user && OVERRIDE_ALLOWED_USER_IDS.has(user.id);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [saving, setSaving] = useState(false);
  const [override, setOverride] = useState<boolean>(false);
  const [customLabel, setCustomLabel] = useState(assigneeLabel && !assigneeId && assigneeLabel !== "Company account" ? assigneeLabel : "");

  const s: Status = (status as Status) ?? "pending";

  useEffect(() => {
    let alive = true;
    supabase.from("profiles").select("id, user_id, display_name, email").order("display_name").then(({ data }) => {
      if (alive) setProfiles((data ?? []) as Profile[]);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.from("invoices").select("delivery_status_override").eq("id", invoiceId).maybeSingle().then(({ data }) => {
      if (alive) setOverride(Boolean((data as any)?.delivery_status_override));
    });
  }, [invoiceId, status]);

  const setManualStatus = async (val: Status) => {
    if (!canOverride) return;
    setSaving(true);
    const { error } = await supabase
      .from("invoices")
      .update({ delivery_status: val, delivery_status_override: true } as any)
      .eq("id", invoiceId);
    setSaving(false);
    if (error) return toast.error(error.message);
    setOverride(true);
    toast.success(isAr ? "تم تحديث حالة التسليم يدوياً" : "Delivery status set manually");
    onChanged();
  };

  const clearOverride = async () => {
    if (!canOverride) return;
    setSaving(true);
    const { error } = await supabase
      .from("invoices")
      .update({ delivery_status_override: false } as any)
      .eq("id", invoiceId);
    if (!error) {
      await supabase.rpc("recompute_invoice_delivery_status" as any, { _invoice_id: invoiceId } as any);
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    setOverride(false);
    toast.success(isAr ? "رجعت الحالة للحساب التلقائي" : "Reverted to auto");
    onChanged();
  };

  const currentAssigneeKey = useMemo(() => {
    if (assigneeId) return assigneeId;
    if (assigneeLabel === "Company account") return COMPANY_LABEL_KEY;
    if (assigneeLabel) return "__custom__";
    return "__none__";
  }, [assigneeId, assigneeLabel]);

  const saveAssignee = async (key: string, freeText?: string) => {
    setSaving(true);
    const patch: { delivery_assignee_id: string | null; delivery_assignee_label: string | null } = {
      delivery_assignee_id: null,
      delivery_assignee_label: null,
    };
    if (key === COMPANY_LABEL_KEY) patch.delivery_assignee_label = "Company account";
    else if (key === "__custom__") patch.delivery_assignee_label = (freeText ?? customLabel).trim() || null;
    else if (key !== "__none__") patch.delivery_assignee_id = key;
    const { error } = await supabase.from("invoices").update(patch).eq("id", invoiceId);
    setSaving(false);
    if (error) return toast.error(error.message);
    onChanged();
  };

  const statusPillClass = (val: Status) => {
    const active = s === val || (val === "in_transit" && s === "partial");
    const interactive = canOverride && !isVoided;
    const base = `flex-1 gap-1.5 rounded-full ${interactive ? "cursor-pointer" : "cursor-default"}`;
    if (!active) return `${base} border bg-background ${interactive ? "hover:bg-muted" : "opacity-60"}`;
    if (val === "pending") return `${base} bg-slate-600 text-white`;
    if (val === "in_transit") return `${base} bg-amber-600 text-white`;
    return `${base} bg-emerald-600 text-white`;
  };

  const renderPill = (val: Status, Icon: typeof Package, label: string) => (
    <Button
      size="sm"
      variant="ghost"
      disabled={!canOverride || isVoided || saving}
      className={statusPillClass(val)}
      tabIndex={canOverride ? 0 : -1}
      onClick={canOverride ? () => setManualStatus(val) : undefined}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Button>
  );

  return (
    <div className="mx-auto max-w-3xl no-print">
      <div className="rounded-2xl border bg-card p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">{isAr ? "حالة التسليم" : "Delivery status"}</h3>
          </div>
          {canOverride && override && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-300">
              <Lock className="h-3 w-3" />
              {isAr ? "تحكم يدوي" : "Manual"}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {renderPill("pending", Package, isAr ? "قيد الانتظار" : "Pending")}
          {renderPill("in_transit", Truck, isAr ? "في الطريق" : "In Transit")}
          {renderPill("delivered", CheckCircle2, isAr ? "تم التسليم" : "Delivered")}
        </div>

        {canOverride && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-500/5 p-2.5 text-[11px] ring-1 ring-amber-500/20">
            <span className="text-muted-foreground">
              {isAr
                ? "لك صلاحية تعديل حالة التسليم يدوياً لأي فاتورة. التعديل بيوقف الحساب التلقائي على الفاتورة دي بس."
                : "You can manually change delivery status on any invoice. Doing so locks auto-recompute for that invoice only."}
            </span>
            {override && (
              <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" disabled={saving} onClick={clearOverride}>
                <Unlock className="h-3 w-3" />
                {isAr ? "رجّع للتلقائي" : "Revert to auto"}
              </Button>
            )}
          </div>
        )}

        <div className="mt-3 flex items-start gap-2 rounded-lg bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary" />
          <span>
            {isAr
              ? "تُحدَّث حالة التسليم تلقائياً من محاضر الاستلام المرتبطة بالفاتورة. لما مجموع الكميات المُسلَّمة في المحاضر يغطي كل بنود الفاتورة تتحول لـ «تم التسليم» تلقائياً."
              : "Delivery status updates automatically from the linked delivery receipts. When the total delivered quantity covers all invoice items it turns to Delivered."}
          </span>
        </div>


        {(s === "in_transit" || s === "partial" || assigneeId || assigneeLabel) && (
          <div className="mt-4 space-y-2 rounded-xl border border-dashed bg-muted/30 p-3">
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <UserIcon className="h-3.5 w-3.5" />
              {isAr ? "المسؤول عن التسليم" : "Responsible for delivery"}
            </label>
            <Select value={currentAssigneeKey} onValueChange={(v) => saveAssignee(v)} disabled={isVoided || saving}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder={isAr ? "اختر مسؤول" : "Pick responsible"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{isAr ? "— بدون —" : "— None —"}</SelectItem>
                <SelectItem value={COMPANY_LABEL_KEY}>{isAr ? "حساب الشركة" : "Company account"}</SelectItem>
                <SelectItem value="__custom__">{isAr ? "اسم مخصص" : "Custom name"}</SelectItem>
                {profiles.length > 0 && (
                  <div className="my-1 border-t" />
                )}
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.display_name || p.email || p.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentAssigneeKey === "__custom__" && (
              <div className="flex gap-2">
                <Input
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder={isAr ? "اكتب الاسم…" : "Enter name…"}
                  className="h-9 text-sm"
                />
                <Button size="sm" disabled={saving || !customLabel.trim()} onClick={() => saveAssignee("__custom__", customLabel)}>
                  {isAr ? "حفظ" : "Save"}
                </Button>
              </div>
            )}
            {(assigneeId || assigneeLabel) && (
              <p className="text-[11px] text-muted-foreground">
                {isAr ? "الحالي: " : "Current: "}
                <span className="font-medium text-foreground">
                  {assigneeId
                    ? (profiles.find((p) => p.id === assigneeId)?.display_name
                      || profiles.find((p) => p.id === assigneeId)?.email
                      || (isAr ? "عضو فريق" : "Team member"))
                    : assigneeLabel === "Company account"
                      ? (isAr ? "حساب الشركة" : "Company account")
                      : assigneeLabel}
                </span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
