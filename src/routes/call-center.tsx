import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth";
import { useRole } from "@/lib/use-role";
import { useI18n } from "@/lib/i18n";
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
import { Phone, Plus, Star, Loader2, PhoneIncoming, PhoneOutgoing, Pencil, Check, ChevronsUpDown, Trash2, FileText, ExternalLink, Search } from "lucide-react";

export const Route = createFileRoute("/call-center")({
  component: CallCenterPage,
});

type CallLog = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  call_type: "incoming" | "outgoing";
  duration_seconds: number;
  outcome: string | null;
  summary: string | null;
  notes: string | null;
  agent_id: string;
  agent_email: string | null;
  called_at: string;
  invoice_id: string | null;
  invoice_number: string | null;
};

type CustomerOpt = { id: string; name: string; phone: string | null };
type InvoiceOpt = { id: string; invoice_number: string; customer_name: string | null; customer_phone: string | null; total: number; status: string };

const OUTCOMES_AR = [
  { v: "resolved", label: "تم الحل" },
  { v: "follow_up", label: "متابعة" },
  { v: "no_answer", label: "لم يرد" },
  { v: "complaint", label: "شكوى" },
  { v: "sale", label: "بيع" },
  { v: "other", label: "أخرى" },
];
const OUTCOMES_EN = [
  { v: "resolved", label: "Resolved" },
  { v: "follow_up", label: "Follow up" },
  { v: "no_answer", label: "No answer" },
  { v: "complaint", label: "Complaint" },
  { v: "sale", label: "Sale" },
  { v: "other", label: "Other" },
];


function CallCenterPage() {
  const { user } = useAuth();
  const { isCallCenter, isManager, loading: roleLoading } = useRole();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const OUTCOMES = isAr ? OUTCOMES_AR : OUTCOMES_EN;
  const navigate = useNavigate();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CallLog | null>(null);
  const [ratingFor, setRatingFor] = useState<CallLog | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "incoming" | "outgoing">("all");

  useEffect(() => {
    if (!roleLoading && !isCallCenter) {
      toast.error(isAr ? "غير مصرح" : "Unauthorized");
      navigate({ to: "/dashboard" });
    }
  }, [isCallCenter, roleLoading, navigate, isAr]);

  const load = async () => {
    if (calls.length === 0 && customers.length === 0) setLoading(true);

    const [{ data }, { data: cs }, { data: inv }] = await Promise.all([
      supabase.from("call_logs").select("*").order("called_at", { ascending: false }).limit(200),
      supabase.from("customers").select("id, name, phone").order("name"),
      supabase.from("invoices")
        .select("id, invoice_number, customer_name, customer_phone, total, status")
        .order("created_at", { ascending: false })
        .limit(300),
    ]);
    setCalls((data as any) ?? []);
    setCustomers((cs as any) ?? []);
    setInvoices((inv as any) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (isCallCenter) load();
  }, [isCallCenter]);
  useRealtimeTable("call_logs", () => isCallCenter && load());
  useRealtimeTable("customers", () => isCallCenter && load());
  useRealtimeTable("invoices", () => isCallCenter && load());

  const deleteCall = async (id: string) => {
    const { error } = await supabase.from("call_logs").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(isAr ? "تم الحذف" : "Deleted");
    load();
  };

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

  // Normalize phone digits for tolerant matching (strips spaces, dashes, +).
  const normPhone = (s: string) => s.replace(/[^\d]/g, "");

  const filteredCalls = calls.filter((c) => {
    if (typeFilter !== "all" && c.call_type !== typeFilter) return false;
    const s = search.trim().toLowerCase();
    if (!s) return true;
    const phoneDigits = normPhone(s);
    return (
      (c.customer_name ?? "").toLowerCase().includes(s) ||
      (c.customer_phone ?? "").toLowerCase().includes(s) ||
      (phoneDigits.length >= 3 && normPhone(c.customer_phone ?? "").includes(phoneDigits)) ||
      (c.summary ?? "").toLowerCase().includes(s) ||
      (c.agent_email ?? "").toLowerCase().includes(s) ||
      (c.invoice_number ?? "").toLowerCase().includes(s)
    );
  });


  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-purple-500/10 p-2.5">
              <Phone className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{isAr ? "مركز الاتصال" : "Call Center"}</h1>
              <p className="text-sm text-muted-foreground">
                {isAr ? `${todayCount} مكالمة اليوم · ${calls.length} إجمالي` : `${todayCount} calls today · ${calls.length} total`}
              </p>
            </div>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> {isAr ? "تسجيل مكالمة" : "Log call"}
              </Button>
            </DialogTrigger>
            {dialogOpen && (
              <CallDialog
                userId={user!.id}
                userEmail={user!.email ?? null}
                customers={customers}
                isAr={isAr}
                outcomes={OUTCOMES}
                onDone={() => {
                  setDialogOpen(false);
                  load();
                }}
              />
            )}
          </Dialog>
        </div>

        <Card className="p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold flex-1">{isAr ? "سجل المكالمات" : "Call log"}</h2>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isAr ? "ابحث بالاسم، رقم، ملخص…" : "Search by name, phone, summary…"}
              className="w-full sm:w-64"
            />
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isAr ? "الكل" : "All"}</SelectItem>
                <SelectItem value="incoming">{isAr ? "واردة" : "Incoming"}</SelectItem>
                <SelectItem value="outgoing">{isAr ? "صادرة" : "Outgoing"}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredCalls.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {isAr ? "لا توجد مكالمات مطابقة" : "No matching calls"}
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {filteredCalls.map((c) => {
                const canEdit = isManager || c.agent_id === user!.id;
                return (
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
                      {new Date(c.called_at).toLocaleString(isAr ? "ar-EG" : "en-US")}
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
                    <Button size="sm" variant="ghost" onClick={() => setRatingFor(c)} className="gap-1">
                      <Star className="h-3.5 w-3.5" /> {isAr ? "تقييم" : "Rate"}
                    </Button>
                    {canEdit && (
                      <Button size="icon" variant="ghost" onClick={() => setEditing(c)} title={isAr ? "تعديل" : "Edit"}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {isManager && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" title={isAr ? "حذف" : "Delete"}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{isAr ? "حذف المكالمة" : "Delete call"}</AlertDialogTitle>
                            <AlertDialogDescription>{isAr ? "سيتم حذف سجل المكالمة نهائياً." : "The call log will be permanently deleted."}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{isAr ? "إلغاء" : "Cancel"}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteCall(c.id)}>{isAr ? "تأكيد" : "Confirm"}</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </Card>

        {isManager && (
          <Card className="p-5">
            <h2 className="mb-2 text-lg font-semibold">📊 {isAr ? "إحصائيات سريعة" : "Quick stats"}</h2>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label={isAr ? "المكالمات" : "Calls"} value={calls.length} />
              <Stat label={isAr ? "اليوم" : "Today"} value={todayCount} />
              <Stat label={isAr ? "واردة" : "Incoming"} value={calls.filter((c) => c.call_type === "incoming").length} />
              <Stat label={isAr ? "صادرة" : "Outgoing"} value={calls.filter((c) => c.call_type === "outgoing").length} />
            </div>
          </Card>
        )}
      </div>

      {ratingFor && (
        <RatingDialog
          call={ratingFor}
          userId={user!.id}
          userEmail={user!.email ?? null}
          isAr={isAr}
          onClose={() => setRatingFor(null)}
        />
      )}

      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <CallDialog
            userId={user!.id}
            userEmail={user!.email ?? null}
            customers={customers}
            existing={editing}
            isAr={isAr}
            outcomes={OUTCOMES}
            onDone={() => { setEditing(null); load(); }}
          />
        </Dialog>
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

function CallDialog({
  userId,
  userEmail,
  customers,
  existing,
  isAr,
  outcomes,
  onDone,
}: {
  userId: string;
  userEmail: string | null;
  customers: CustomerOpt[];
  existing?: CallLog;
  isAr: boolean;
  outcomes: { v: string; label: string }[];
  onDone: () => void;
}) {
  const [customerId, setCustomerId] = useState<string | null>(existing?.customer_id ?? null);
  const [name, setName] = useState(existing?.customer_name ?? "");
  const [phone, setPhone] = useState(existing?.customer_phone ?? "");
  const [type, setType] = useState<"incoming" | "outgoing">(existing?.call_type ?? "incoming");
  const [duration, setDuration] = useState(existing?.duration_seconds ?? 0);
  const [outcome, setOutcome] = useState(existing?.outcome ?? "resolved");
  const [summary, setSummary] = useState(existing?.summary ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [calledAt, setCalledAt] = useState(
    existing?.called_at
      ? new Date(existing.called_at).toISOString().slice(0, 16)
      : new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  );
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const pickCustomer = (c: CustomerOpt) => {
    setCustomerId(c.id);
    setName(c.name);
    if (c.phone) setPhone(c.phone);
    setPickerOpen(false);
  };

  const save = async () => {
    if (!phone.trim() && !name.trim()) {
      toast.error(isAr ? "اختر عميلاً أو أدخل اسم/رقم" : "Select a customer or enter a name/phone");
      return;
    }
    setSaving(true);
    const payload = {
      customer_id: customerId,
      customer_name: name.trim() || null,
      customer_phone: phone.trim() || null,
      call_type: type,
      duration_seconds: duration,
      outcome,
      summary: summary.trim() || null,
      notes: notes.trim() || null,
      called_at: new Date(calledAt).toISOString(),
    };
    const { error } = existing
      ? await supabase.from("call_logs").update(payload).eq("id", existing.id)
      : await supabase.from("call_logs").insert({ ...payload, agent_id: userId, agent_email: userEmail });
    setSaving(false);
    if (error) {
      toast.error((isAr ? "فشل الحفظ: " : "Save failed: ") + error.message);
      return;
    }
    toast.success(existing ? (isAr ? "تم تحديث المكالمة" : "Call updated") : (isAr ? "تم تسجيل المكالمة" : "Call logged"));
    onDone();
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{existing ? (isAr ? "تعديل مكالمة" : "Edit call") : (isAr ? "تسجيل مكالمة جديدة" : "Log new call")}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>{isAr ? "اختيار عميل من القاعدة" : "Pick customer from database"}</Label>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                {customerId ? (customers.find((c) => c.id === customerId)?.name ?? "—") : (isAr ? "ابحث عن عميل…" : "Search customer…")}
                <ChevronsUpDown className="ms-2 h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
              <Command>
                <CommandInput placeholder={isAr ? "ابحث بالاسم أو الرقم…" : "Search by name or phone…"} />
                <CommandList>
                  <CommandEmpty>{isAr ? "لا توجد نتائج" : "No results"}</CommandEmpty>
                  <CommandGroup>
                    {customers.slice(0, 200).map((c) => (
                      <CommandItem
                        key={c.id}
                        value={`${c.name} ${c.phone ?? ""}`}
                        onSelect={() => pickCustomer(c)}
                      >
                        <Check className={`me-2 h-4 w-4 ${customerId === c.id ? "opacity-100" : "opacity-0"}`} />
                        <div className="flex flex-col">
                          <span>{c.name}</span>
                          {c.phone && <span className="text-xs text-muted-foreground" dir="ltr">{c.phone}</span>}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {customerId && (
            <button
              className="mt-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => { setCustomerId(null); }}
            >
              {isAr ? "إلغاء الربط بالعميل" : "Unlink customer"}
            </button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>{isAr ? "اسم العميل" : "Customer name"}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>{isAr ? "رقم الهاتف" : "Phone"}</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>{isAr ? "النوع" : "Type"}</Label>
            <Select value={type} onValueChange={(v) => setType(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="incoming">{isAr ? "واردة" : "Incoming"}</SelectItem>
                <SelectItem value="outgoing">{isAr ? "صادرة" : "Outgoing"}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{isAr ? "المدة (ثواني)" : "Duration (sec)"}</Label>
            <Input
              type="number"
              min={0}
              value={duration}
              onChange={(e) => setDuration(Math.max(0, parseInt(e.target.value) || 0))}
            />
          </div>
          <div>
            <Label>{isAr ? "النتيجة" : "Outcome"}</Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {outcomes.map((o) => (
                  <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>{isAr ? "تاريخ ووقت المكالمة" : "Call date & time"}</Label>
          <Input type="datetime-local" value={calledAt} onChange={(e) => setCalledAt(e.target.value)} />
        </div>
        <div>
          <Label>{isAr ? "ملخص المكالمة" : "Call summary"}</Label>
          <Textarea
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder={isAr ? "ما الذي تمت مناقشته؟" : "What was discussed?"}
          />
        </div>
        <div>
          <Label>{isAr ? "ملاحظات داخلية" : "Internal notes"}</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={isAr ? "ملاحظات للفريق…" : "Notes for the team…"}
          />
        </div>
        <Button onClick={save} disabled={saving} className="w-full">
          {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
          {existing ? (isAr ? "حفظ التعديلات" : "Save changes") : (isAr ? "حفظ المكالمة" : "Save call")}
        </Button>
      </div>
    </DialogContent>
  );
}

function RatingDialog({
  call,
  userId,
  userEmail,
  isAr,
  onClose,
}: {
  call: CallLog;
  userId: string;
  userEmail: string | null;
  isAr: boolean;
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
      toast.error((isAr ? "فشل: " : "Failed: ") + error.message);
      return;
    }
    toast.success(isAr ? "تم حفظ التقييم" : "Rating saved");
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isAr ? "تقييم خدمة العميل" : "Customer service rating"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            {call.customer_name || call.customer_phone}
          </div>
          <div>
            <Label>{isAr ? "التقييم" : "Rating"}</Label>
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
            <Label>{isAr ? "تعليق (اختياري)" : "Comment (optional)"}</Label>
            <Textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <Button onClick={save} disabled={saving} className="w-full">
            {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
            {isAr ? "حفظ التقييم" : "Save rating"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
