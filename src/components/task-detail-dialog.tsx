import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTeamProfiles } from "@/lib/team-profiles";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtDateTime } from "@/lib/utils-money";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CheckCircle2, XCircle, Play, Flag, MessageSquare, Send, Trash2,
  Circle, CircleDot, FileText, Truck, Phone, ExternalLink, Pencil, Save, X,
} from "lucide-react";
import { toast } from "sonner";
import { TaskInvoiceChip } from "@/components/task-invoice-chip";

const MANAGER_EMAILS = [
  "k.elsharbatly@steinheim-eg.com",
  "e.hesham@steinheim-eg.com",
] as const;

type TaskStatus = "pending" | "in_progress" | "done" | "cancelled";
type TaskPriority = "low" | "normal" | "high" | "urgent";
type Task = {
  id: string;
  title: string;
  description: string | null;
  assignee_id: string;
  assigned_by: string;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  invoice_id: string | null;
  delivery_receipt_ids: string[] | null;
  contact_phone: string | null;
};
type Comment = { id: string; task_id: string; author_id: string; body: string; created_at: string };

const PRIO_META: Record<TaskPriority, { ar: string; en: string; dot: string; text: string; ring: string }> = {
  urgent: { ar: "عاجلة",  en: "Urgent", dot: "bg-red-500",    text: "text-red-600",    ring: "ring-red-500/30" },
  high:   { ar: "عالية",  en: "High",   dot: "bg-orange-500", text: "text-orange-600", ring: "ring-orange-500/30" },
  normal: { ar: "عادية",  en: "Normal", dot: "bg-blue-500",   text: "text-blue-600",   ring: "ring-blue-500/30" },
  low:    { ar: "منخفضة", en: "Low",    dot: "bg-slate-400",  text: "text-slate-500",  ring: "ring-slate-500/30" },
};

const STATUS_META: Record<TaskStatus, { ar: string; en: string; icon: any; tone: string }> = {
  pending:     { ar: "قيد الانتظار", en: "Todo",        icon: Circle,      tone: "text-slate-500" },
  in_progress: { ar: "قيد التنفيذ",   en: "In progress", icon: CircleDot,   tone: "text-amber-500" },
  done:        { ar: "منجزة",         en: "Done",        icon: CheckCircle2, tone: "text-emerald-500" },
  cancelled:   { ar: "ملغاة",         en: "Cancelled",   icon: XCircle,     tone: "text-slate-400" },
};

function PriorityBadge({ p, isAr }: { p: TaskPriority; isAr: boolean }) {
  const m = PRIO_META[p];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold shrink-0 ${m.text} ${m.ring} ring-1`}>
      <Flag className="h-3 w-3" />
      {isAr ? m.ar : m.en}
    </span>
  );
}
function StatusBadge({ s, isAr }: { s: TaskStatus; isAr: boolean }) {
  const m = STATUS_META[s];
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${m.tone}`}>
      <Icon className="h-3 w-3" />
      {isAr ? m.ar : m.en}
    </span>
  );
}
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold truncate">{value}</div>
    </div>
  );
}

export function TaskDetailDialog({
  taskId,
  onClose,
  showOpenInPage = false,
}: {
  taskId: string | null;
  onClose: () => void;
  /** Show a "Open in Tasks page" secondary link (useful when opened from the dashboard). */
  showOpenInPage?: boolean;
}) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const profiles = useTeamProfiles();
  const isManager = MANAGER_EMAILS.includes((user?.email || "").toLowerCase() as typeof MANAGER_EMAILS[number]);

  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    title: string;
    description: string;
    priority: TaskPriority;
    due_date: string;
    contact_phone: string;
  }>({ title: "", description: "", priority: "normal", due_date: "", contact_phone: "" });

  const canEdit = !!task && (isManager || task.assigned_by === user?.id);

  const loadTask = async () => {
    if (!taskId) { setTask(null); return; }
    const { data } = await supabase.from("tasks" as any).select("*").eq("id", taskId).maybeSingle();
    setTask((data as any) ?? null);
  };
  const loadComments = async () => {
    if (!taskId) { setComments([]); return; }
    const { data } = await supabase.from("task_comments" as any).select("*").eq("task_id", taskId).order("created_at", { ascending: true });
    setComments(((data as any) ?? []) as Comment[]);
  };

  useEffect(() => { loadTask(); loadComments(); setNewComment(""); setEditing(false); }, [taskId]);
  useRealtimeTable("tasks" as any, () => { if (taskId) loadTask(); });
  useRealtimeTable("task_comments" as any, () => { if (taskId) loadComments(); });

  // Sync edit form from latest task whenever we're not actively editing.
  useEffect(() => {
    if (!task || editing) return;
    setForm({
      title: task.title ?? "",
      description: task.description ?? "",
      priority: task.priority,
      due_date: task.due_date ? task.due_date.slice(0, 10) : "",
      contact_phone: task.contact_phone ?? "",
    });
  }, [task, editing]);

  const saveEdits = async () => {
    if (!task) return;
    const title = form.title.trim();
    if (!title) { toast.error(isAr ? "العنوان مطلوب" : "Title is required"); return; }
    setSaving(true);
    const patch: any = {
      title,
      description: form.description.trim() || null,
      priority: form.priority,
      due_date: form.due_date || null,
      contact_phone: form.contact_phone.trim() || null,
    };
    const { error } = await supabase.from("tasks" as any).update(patch).eq("id", task.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم حفظ التعديلات" : "Changes saved");
    setEditing(false);
  };

  const updateStatus = async (status: TaskStatus) => {
    if (!task) return;
    const patch: any = { status };
    if (status === "in_progress" && !task.started_at) patch.started_at = new Date().toISOString();
    if (status === "done") patch.completed_at = new Date().toISOString();
    const { error } = await supabase.from("tasks" as any).update(patch).eq("id", task.id);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم تحديث الحالة" : "Status updated");
  };
  const deleteTask = async () => {
    if (!task) return;
    if (!confirm(isAr ? "حذف المهمة نهائياً؟" : "Delete task?")) return;
    const { error } = await supabase.from("tasks" as any).delete().eq("id", task.id);
    if (error) { toast.error(error.message); return; }
    onClose();
  };
  const addComment = async () => {
    if (!taskId || !newComment.trim() || !user) return;
    const { error } = await supabase.from("task_comments" as any).insert({
      task_id: taskId, author_id: user.id, body: newComment.trim(),
    });
    if (error) { toast.error(error.message); return; }
    setNewComment("");
  };

  return (
    <Dialog open={!!taskId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {task && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${PRIO_META[task.priority].dot}`} />
                <span className="min-w-0 truncate">{task.title}</span>
                <PriorityBadge p={task.priority} isAr={isAr} />
                <StatusBadge s={task.status} isAr={isAr} />
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {editing ? (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <div>
                    <label className="text-[11px] font-semibold uppercase text-muted-foreground">{isAr ? "العنوان" : "Title"}</label>
                    <Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase text-muted-foreground">{isAr ? "الوصف" : "Description"}</label>
                    <Textarea rows={3} value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="text-[11px] font-semibold uppercase text-muted-foreground">{isAr ? "الأولوية" : "Priority"}</label>
                      <Select value={form.priority} onValueChange={(v) => setForm(f => ({ ...f, priority: v as TaskPriority }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(["urgent","high","normal","low"] as TaskPriority[]).map(p => (
                            <SelectItem key={p} value={p}>{isAr ? PRIO_META[p].ar : PRIO_META[p].en}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold uppercase text-muted-foreground">{isAr ? "الاستحقاق" : "Due date"}</label>
                      <Input type="date" value={form.due_date} onChange={(e) => setForm(f => ({ ...f, due_date: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold uppercase text-muted-foreground">{isAr ? "رقم التواصل" : "Contact phone"}</label>
                      <Input value={form.contact_phone} onChange={(e) => setForm(f => ({ ...f, contact_phone: e.target.value }))} dir="ltr" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={saveEdits} disabled={saving}>
                      <Save className="h-4 w-4 me-1" />{isAr ? "حفظ" : "Save"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                      <X className="h-4 w-4 me-1" />{isAr ? "إلغاء" : "Cancel"}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {task.description && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap">{task.description}</div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <Meta label={isAr ? "أسندها" : "Assigned by"} value={profiles.byId(task.assigned_by)?.display_name || "—"} />
                    <Meta label={isAr ? "المكلَّف" : "Assignee"} value={profiles.byId(task.assignee_id)?.display_name || "—"} />
                    <Meta label={isAr ? "الإسناد" : "Created"} value={fmtDateTime(task.created_at, lang)} />
                    {task.due_date && <Meta label={isAr ? "الاستحقاق" : "Due"} value={fmtDateTime(task.due_date, lang)} />}
                    {task.started_at && <Meta label={isAr ? "بدأت" : "Started"} value={fmtDateTime(task.started_at, lang)} />}
                    {task.completed_at && <Meta label={isAr ? "انتهت" : "Completed"} value={fmtDateTime(task.completed_at, lang)} />}
                  </div>
                </>
              )}

              {task.contact_phone && (
                <a
                  href={`tel:${task.contact_phone}`}
                  className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-3 py-1.5 text-xs font-semibold ring-1 ring-primary/20 hover:bg-primary/20 transition-colors tabular-nums"
                  dir="ltr"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {task.contact_phone}
                </a>
              )}

              {task.invoice_id && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    {isAr ? "الفاتورة المرتبطة" : "Linked invoice"}
                  </div>
                  <TaskInvoiceChip
                    invoiceId={task.invoice_id}
                    drCount={task.delivery_receipt_ids?.length ?? 0}
                    isAr={isAr}
                    size="sm"
                  />
                  {task.delivery_receipt_ids && task.delivery_receipt_ids.length > 0 && (
                    <div className="pt-1">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5 mb-1">
                        <Truck className="h-3.5 w-3.5" />
                        {isAr ? "محاضر الاستلام" : "Delivery receipts"}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {task.delivery_receipt_ids.map((drId) => (
                          <Link
                            key={drId}
                            to="/delivery-receipts/$id"
                            params={{ id: drId }}
                            className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium ring-1 ring-primary/20 hover:bg-primary/20 transition-colors tabular-nums"
                          >
                            <Truck className="h-3 w-3" />
                            {drId.slice(0, 6)}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {canEdit && !editing && (
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    <Pencil className="h-4 w-4 me-1" />{isAr ? "تعديل" : "Edit"}
                  </Button>
                )}
                {task.assignee_id === user?.id && task.status === "pending" && (
                  <Button size="sm" onClick={() => updateStatus("in_progress")}>
                    <Play className="h-4 w-4 me-1" />{isAr ? "بدء التنفيذ" : "Start"}
                  </Button>
                )}
                {task.assignee_id === user?.id && task.status === "in_progress" && (
                  <Button size="sm" onClick={() => updateStatus("done")}>
                    <CheckCircle2 className="h-4 w-4 me-1" />{isAr ? "تم الإنجاز" : "Mark done"}
                  </Button>
                )}
                {task.assignee_id === user?.id && task.status !== "done" && task.status !== "cancelled" && (
                  <Button size="sm" variant="outline" onClick={() => updateStatus("pending")}>
                    {isAr ? "إعادة إلى الانتظار" : "Reset"}
                  </Button>
                )}
                {isManager && (task.status === "done" || task.status === "cancelled") && (
                  <Button size="sm" variant="outline" onClick={() => updateStatus("pending")}>
                    {isAr ? "إعادة فتح" : "Reopen"}
                  </Button>
                )}
                {isManager && task.status !== "cancelled" && (
                  <Button size="sm" variant="outline" onClick={() => updateStatus("cancelled")}>
                    <XCircle className="h-4 w-4 me-1" />{isAr ? "إلغاء" : "Cancel"}
                  </Button>
                )}
                {isManager && (
                  <Button size="sm" variant="destructive" onClick={deleteTask}>
                    <Trash2 className="h-4 w-4 me-1" />{isAr ? "حذف" : "Delete"}
                  </Button>
                )}
                {showOpenInPage && (
                  <Link
                    to="/tasks"
                    className="ms-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={onClose}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {isAr ? "فتح في صفحة المهام" : "Open in Tasks"}
                  </Link>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <MessageSquare className="h-4 w-4" />
                  {isAr ? "التعليقات" : "Comments"}
                  <Badge variant="secondary">{comments.length}</Badge>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto pe-1">
                  {comments.map(c => {
                    const author = profiles.byId(c.author_id);
                    return (
                      <div key={c.id} className="rounded-lg border bg-card p-2 text-sm">
                        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                          <span className="font-semibold">{author?.display_name || author?.email || "—"}</span>
                          <span>{fmtDateTime(c.created_at, lang)}</span>
                        </div>
                        <div className="whitespace-pre-wrap">{c.body}</div>
                      </div>
                    );
                  })}
                  {comments.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-3">{isAr ? "لا توجد تعليقات بعد" : "No comments yet"}</div>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <Textarea
                    rows={2}
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    placeholder={isAr ? "اكتب تعليقاً..." : "Add a comment..."}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addComment(); } }}
                  />
                  <Button onClick={addComment} disabled={!newComment.trim()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
