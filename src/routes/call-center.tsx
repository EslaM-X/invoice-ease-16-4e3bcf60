import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth";
import { useRole } from "@/lib/use-role";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/lib/realtime";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Phone, Plus, Star, Loader2, PhoneIncoming, PhoneOutgoing, Pencil, Check, ChevronsUpDown, Trash2 } from "lucide-react";

export const Route = createFileRoute("/call-center")({
  component: CallCenterPage,
});

type CallLog = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  call_type: "incoming" | "outgoing";
  duration_seconds: number;
  outcome: string | null;
  summary: string | null;
  agent_email: string | null;
  called_at: string;
};

const OUTCOMES = [
  { v: "resolved", label: "تم الحل" },
  { v: "follow_up", label: "متابعة" },
  { v: "no_answer", label: "لم يرد" },
  { v: "complaint", label: "شكوى" },
  { v: "sale", label: "بيع" },
  { v: "other", label: "أخرى" },
];

function CallCenterPage() {
  const { user } = useAuth();
  const { isCallCenter, isManager, loading: roleLoading } = useRole();
  const navigate = useNavigate();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ratingFor, setRatingFor] = useState<CallLog | null>(null);

  useEffect(() => {
    if (!roleLoading && !isCallCenter) {
      toast.error("غير مصرح");
      navigate({ to: "/dashboard" });
    }
  }, [isCallCenter, roleLoading, navigate]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("call_logs")
      .select("*")
      .order("called_at", { ascending: false })
      .limit(100);
    setCalls((data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (isCallCenter) load();
  }, [isCallCenter]);
  useRealtimeTable("call_logs", () => isCallCenter && load());

  if (roleLoading || !isCallCenter) {
    return (
      <AppShell>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  const todayCount = calls.filter(
    (c) => new Date(c.called_at).toDateString() === new Date().toDateString()
  ).length;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-purple-500/10 p-2.5">
              <Phone className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">مركز الاتصال</h1>
              <p className="text-sm text-muted-foreground">
                {todayCount} مكالمة اليوم · {calls.length} إجمالي
              </p>
            </div>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> تسجيل مكالمة
              </Button>
            </DialogTrigger>
            <NewCallDialog
              userId={user!.id}
              userEmail={user!.email ?? null}
              onDone={() => {
                setDialogOpen(false);
                load();
              }}
            />
          </Dialog>
        </div>

        <Card className="p-5">
          <h2 className="mb-4 text-lg font-semibold">سجل المكالمات</h2>
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : calls.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              لا توجد مكالمات بعد — اضغط "تسجيل مكالمة"
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {calls.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div
                    className={`rounded-lg p-2 ${
                      c.call_type === "incoming"
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-blue-500/10 text-blue-600"
                    }`}
                  >
                    {c.call_type === "incoming" ? (
                      <PhoneIncoming className="h-4 w-4" />
                    ) : (
                      <PhoneOutgoing className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{c.customer_name || c.customer_phone || "—"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {c.customer_phone} · {c.agent_email} ·{" "}
                      {new Date(c.called_at).toLocaleString("ar-EG")}
                    </div>
                    {c.summary && (
                      <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                        {c.summary}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {c.outcome && (
                      <Badge variant="outline" className="text-xs">
                        {OUTCOMES.find((o) => o.v === c.outcome)?.label ?? c.outcome}
                      </Badge>
                    )}
                    {c.duration_seconds > 0 && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {Math.floor(c.duration_seconds / 60)}:
                        {String(c.duration_seconds % 60).padStart(2, "0")}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRatingFor(c)}
                      className="gap-1"
                    >
                      <Star className="h-3.5 w-3.5" /> تقييم
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {isManager && (
          <Card className="p-5">
            <h2 className="mb-2 text-lg font-semibold">📊 إحصائيات سريعة</h2>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="المكالمات" value={calls.length} />
              <Stat label="اليوم" value={todayCount} />
              <Stat label="واردة" value={calls.filter((c) => c.call_type === "incoming").length} />
              <Stat label="صادرة" value={calls.filter((c) => c.call_type === "outgoing").length} />
            </div>
          </Card>
        )}
      </div>

      {ratingFor && (
        <RatingDialog
          call={ratingFor}
          userId={user!.id}
          userEmail={user!.email ?? null}
          onClose={() => setRatingFor(null)}
        />
      )}
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function NewCallDialog({
  userId,
  userEmail,
  onDone,
}: {
  userId: string;
  userEmail: string | null;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState<"incoming" | "outgoing">("incoming");
  const [duration, setDuration] = useState(0);
  const [outcome, setOutcome] = useState("resolved");
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!phone.trim() && !name.trim()) {
      toast.error("أدخل اسم العميل أو رقمه");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("call_logs").insert({
      customer_name: name.trim() || null,
      customer_phone: phone.trim() || null,
      call_type: type,
      duration_seconds: duration,
      outcome,
      summary: summary.trim() || null,
      agent_id: userId,
      agent_email: userEmail,
    });
    setSaving(false);
    if (error) {
      toast.error("فشل الحفظ: " + error.message);
      return;
    }
    toast.success("تم تسجيل المكالمة");
    onDone();
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>تسجيل مكالمة جديدة</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>اسم العميل</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>رقم الهاتف</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>النوع</Label>
            <Select value={type} onValueChange={(v) => setType(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="incoming">واردة</SelectItem>
                <SelectItem value="outgoing">صادرة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>المدة (ثواني)</Label>
            <Input
              type="number"
              min={0}
              value={duration}
              onChange={(e) => setDuration(Math.max(0, parseInt(e.target.value) || 0))}
            />
          </div>
          <div>
            <Label>النتيجة</Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {OUTCOMES.map((o) => (
                  <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>ملخص المكالمة</Label>
          <Textarea
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="ما الذي تمت مناقشته؟"
          />
        </div>
        <Button onClick={save} disabled={saving} className="w-full">
          {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
          حفظ المكالمة
        </Button>
      </div>
    </DialogContent>
  );
}

function RatingDialog({
  call,
  userId,
  userEmail,
  onClose,
}: {
  call: CallLog;
  userId: string;
  userEmail: string | null;
  onClose: () => void;
}) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("customer_ratings").insert({
      customer_name: call.customer_name,
      call_log_id: call.id,
      rating,
      comment: comment.trim() || null,
      rated_by: userId,
      rated_by_email: userEmail,
    });
    setSaving(false);
    if (error) {
      toast.error("فشل: " + error.message);
      return;
    }
    toast.success("تم حفظ التقييم");
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تقييم خدمة العميل</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            {call.customer_name || call.customer_phone}
          </div>
          <div>
            <Label>التقييم</Label>
            <div className="mt-2 flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  className="rounded p-1 transition hover:scale-110"
                >
                  <Star
                    className={`h-8 w-8 ${
                      n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>تعليق (اختياري)</Label>
            <Textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <Button onClick={save} disabled={saving} className="w-full">
            {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
            حفظ التقييم
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
