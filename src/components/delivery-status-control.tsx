import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Truck, Package, CheckCircle2, User as UserIcon } from "lucide-react";
import { toast } from "sonner";

type Profile = { id: string; user_id: string; display_name: string | null; email: string | null };
type Status = "pending" | "in_transit" | "partial" | "delivered";

type Props = {
  invoiceId: string;
  status: string | null;
  assigneeId: string | null;
  assigneeLabel: string | null;
  isVoided: boolean;
  onChanged: () => void;
  onMarkDelivered: () => void; // uses shortage guard from parent
};

const COMPANY_LABEL_KEY = "__company__";

export function DeliveryStatusControl({
  invoiceId, status, assigneeId, assigneeLabel, isVoided, onChanged, onMarkDelivered,
}: Props) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [saving, setSaving] = useState(false);
  const [customLabel, setCustomLabel] = useState(assigneeLabel && !assigneeId && assigneeLabel !== "Company account" ? assigneeLabel : "");

  const s: Status = (status as Status) ?? "pending";

  useEffect(() => {
    let alive = true;
    supabase.from("profiles").select("id, user_id, display_name, email").order("display_name").then(({ data }) => {
      if (alive) setProfiles((data ?? []) as Profile[]);
    });
    return () => { alive = false; };
  }, []);

  const currentAssigneeKey = useMemo(() => {
    if (assigneeId) return assigneeId;
    if (assigneeLabel === "Company account") return COMPANY_LABEL_KEY;
    if (assigneeLabel) return "__custom__";
    return "__none__";
  }, [assigneeId, assigneeLabel]);

  const saveStatus = async (_next: Status) => {
    toast.info(
      isAr
        ? "حالة التسليم تتحدث تلقائياً حسب محاضر الاستلام"
        : "Delivery status updates automatically from delivery receipts",
    );
  };


  const saveAssignee = async (key: string, freeText?: string) => {
    setSaving(true);
    let patch: any = { delivery_assignee_id: null, delivery_assignee_label: null };
    if (key === COMPANY_LABEL_KEY) patch.delivery_assignee_label = "Company account";
    else if (key === "__custom__") patch.delivery_assignee_label = (freeText ?? customLabel).trim() || null;
    else if (key !== "__none__") patch.delivery_assignee_id = key;
    // If we're picking an assignee while pending, promote status to in_transit
    if (s === "pending" && (patch.delivery_assignee_id || patch.delivery_assignee_label)) {
      patch.delivery_status = "in_transit";
    }
    const { error } = await supabase.from("invoices").update(patch).eq("id", invoiceId);
    setSaving(false);
    if (error) return toast.error(error.message);
    onChanged();
  };

  const statusPillClass = (val: Status) => {
    const active = s === val || (val === "in_transit" && s === "partial");
    const base = "flex-1 gap-1.5 rounded-full transition";
    if (!active) return `${base} border bg-background hover:bg-muted`;
    if (val === "pending") return `${base} bg-slate-600 text-white hover:bg-slate-700`;
    if (val === "in_transit") return `${base} bg-amber-600 text-white hover:bg-amber-700`;
    return `${base} bg-emerald-600 text-white hover:bg-emerald-700`;
  };

  return (
    <div className="mx-auto max-w-3xl no-print">
      <div className="rounded-2xl border bg-card p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <Truck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{isAr ? "حالة التسليم" : "Delivery status"}</h3>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={isVoided || saving} className={statusPillClass("pending")} onClick={() => saveStatus("pending")}>
            <Package className="h-3.5 w-3.5" />
            {isAr ? "قيد الانتظار" : "Pending"}
          </Button>
          <Button size="sm" variant="ghost" disabled={isVoided || saving} className={statusPillClass("in_transit")} onClick={() => saveStatus("in_transit")}>
            <Truck className="h-3.5 w-3.5" />
            {isAr ? "في الطريق" : "In Transit"}
          </Button>
          <Button size="sm" variant="ghost" disabled={isVoided || saving} className={statusPillClass("delivered")} onClick={() => saveStatus("delivered")}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            {isAr ? "تم التسليم" : "Delivered"}
          </Button>
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
