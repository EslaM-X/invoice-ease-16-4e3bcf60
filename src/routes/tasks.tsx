import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTeamProfiles } from "@/lib/team-profiles";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtDateTime } from "@/lib/utils-money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ClipboardList, Plus, Clock, CheckCircle2, XCircle, Play, Flag, MessageSquare,
  User as UserIcon, Send, Trash2, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/tasks")({
  component: () => <AppShell><TasksPage /></AppShell>,
});

const MANAGER_EMAIL = "k.elsharbatly@steinheim-eg.com";

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
};
type Comment = { id: string; task_id: string; author_id: string; body: string; created_at: string };

const PRIO_META: Record<TaskPriority, { ar: string; en: string; cls: string }> = {
  low:    { ar: "منخفضة", en: "Low",    cls: "bg-slate-500/10 text-slate-600 border-slate-500/30" },
  normal: { ar: "عادية",  en: "Normal", cls: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
  high:   { ar: "عالية",  en: "High",   cls: "bg-orange-500/10 text-orange-600 border-orange-500/30" },
  urgent: { ar: "عاجلة",  en: "Urgent", cls: "bg-red-500/10 text-red-600 border-red-500/30" },
};
const STATUS_META: Record<TaskStatus, { ar: string; en: string; cls: string; icon: any }> = {
  pending:     { ar: "بانتظار البدء", en: "Pending",     cls: "bg-amber-500/10 text-amber-700 border-amber-500/30", icon: Clock },
  in_progress: { ar: "قيد التنفيذ",   en: "In progress", cls: "bg-blue-500/10 text-blue-700 border-blue-500/30",   icon: Play },
  done:        { ar: "منجزة",         en: "Done",        cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30", icon: CheckCircle2 },
  cancelled:   { ar: "ملغاة",         en: "Cancelled",   cls: "bg-slate-500/10 text-slate-600 border-slate-500/30", icon: XCircle },
};

function TasksPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const profiles = useTeamProfiles();

  const isManager = (user?.email || "").toLowerCase() === MANAGER_EMAIL;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<{ title: string; description: string; assignee_id: string; priority: TaskPriority; due_date: string }>({
    title: "", description: "", assignee_id: "", priority: "normal", due_date: "",
  });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("tasks" as any).select("*").order("created_at", { ascending: false }).limit(500);
    setTasks((data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => { if (user) load(); }, [user?.id]);
  useRealtimeTable("tasks" as any, () => load());

  // Load comments for selected task
  useEffect(() => {
    if (!openId) { setComments([]); return; }
    (async () => {
      const { data } = await supabase.from("task_comments" as any).select("*").eq("task_id", openId).order("created_at", { ascending: true });
      setComments((data as any) ?? []);
    })();
  }, [openId]);
  useRealtimeTable("task_comments" as any, () => {
    if (!openId) return;
    supabase.from("task_comments" as any).select("*").eq("task_id", openId).order("created_at", { ascending: true })
      .then(({ data }) => setComments((data as any) ?? []));
  });

  // Team member options (exclude self? no, allow all incl. self)
  const teamOptions = useMemo(() => {
    // gather from profiles cache; only approved-looking users
    const seen = new Set<string>();
    const out: { id: string; label: string }[] = [];
    tasks.forEach(t => {
      [t.assignee_id, t.assigned_by].forEach(id => {
        if (id && !seen.has(id)) {
          seen.add(id);
          const p = profiles.byId(id);
          out.push({ id, label: p?.display_name || p?.email || id.slice(0, 8) });
        }
      });
    });
    return out;
  }, [tasks, profiles]);

  // Include ALL profiles for assignment (manager needs full list)
  const [allTeam, setAllTeam] = useState<{ id: string; label: string; email: string | null }[]>([]);
  useEffect(() => {
    if (!isManager) return;
    supabase.from("profiles").select("user_id, display_name, email, approval_status")
      .then(({ data }) => {
        const rows = ((data as any) ?? [])
          .filter((p: any) => p.approval_status === "approved" || p.approval_status === null)
          .map((p: any) => ({ id: p.user_id, label: p.display_name || p.email || p.user_id.slice(0, 8), email: p.email }));
        setAllTeam(rows);
      });
  }, [isManager]);

  const openTask = useMemo(() => tasks.find(t => t.id === openId) ?? null, [tasks, openId]);

  const submitCreate = async () => {
    if (!form.title.trim() || !form.assignee_id) { toast.error(isAr ? "أدخل العنوان واختر المكلَّف" : "Title and assignee required"); return; }
    const { error } = await supabase.from("tasks" as any).insert({
      title: form.title.trim(),
      description: form.description.trim() || null,
      assignee_id: form.assignee_id,
      assigned_by: user!.id,
      priority: form.priority,
      due_date: form.due_date ? new Date(form.due_date).toISOString() : null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم إسناد المهمة" : "Task assigned");
    setCreateOpen(false);
    setForm({ title: "", description: "", assignee_id: "", priority: "normal", due_date: "" });
    load();
  };

  const updateStatus = async (task: Task, status: TaskStatus) => {
    const { error } = await supabase.from("tasks" as any).update({ status }).eq("id", task.id);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم التحديث" : "Updated");
  };

  const deleteTask = async (task: Task) => {
    if (!confirm(isAr ? "حذف المهمة نهائياً؟" : "Delete task?")) return;
    const { error } = await supabase.from("tasks" as any).delete().eq("id", task.id);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم الحذف" : "Deleted");
    setOpenId(null);
  };

  const addComment = async () => {
    if (!openId || !newComment.trim()) return;
    const { error } = await supabase.from("task_comments" as any).insert({
      task_id: openId, author_id: user!.id, body: newComment.trim(),
    });
    if (error) { toast.error(error.message); return; }
    setNewComment("");
  };

  // Grouped tabs
  const myInbox = useMemo(() => tasks.filter(t => t.assignee_id === user?.id && t.status !== "done" && t.status !== "cancelled"), [tasks, user?.id]);
  const myDone = useMemo(() => tasks.filter(t => t.assignee_id === user?.id && (t.status === "done" || t.status === "cancelled")), [tasks, user?.id]);
  const assignedByMe = useMemo(() => tasks.filter(t => t.assigned_by === user?.id), [tasks, user?.id]);

  const [tab, setTab] = useState<string>("inbox");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="h-6 w-6 text-primary shrink-0" />
            <span className="truncate">{isAr ? "إدارة المهام" : "Task Management"}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAr
              ? "نظام توزيع المهام على الفريق مع أولويات، إشعارات لحظية، وتعليقات."
              : "Assign, prioritize and track tasks across the team with realtime updates."}
          </p>
        </div>
        {isManager && (
          <Button onClick={() => setCreateOpen(true)} className="shrink-0">
            <Plus className="h-4 w-4 me-1" />
            {isAr ? "مهمة جديدة" : "New task"}
          </Button>
        )}
      </div>

      {!isManager && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-xs text-blue-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {isAr
            ? `فقط ${MANAGER_EMAIL} يمكنه إنشاء مهام جديدة. تظهر لك هنا المهام المسندة إليك.`
            : `Only ${MANAGER_EMAIL} can create tasks. Your assigned tasks appear here.`}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="inbox">
            {isAr ? "صندوق الوارد" : "My inbox"}
            {myInbox.length > 0 && <Badge className="ms-2">{myInbox.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="done">
            {isAr ? "منجزة" : "Completed"}
            <Badge variant="secondary" className="ms-2">{myDone.length}</Badge>
          </TabsTrigger>
          {isManager && (
            <TabsTrigger value="assigned">
              {isAr ? "التي أسندتها" : "Assigned by me"}
              <Badge variant="secondary" className="ms-2">{assignedByMe.length}</Badge>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="inbox" className="mt-4">
          <TaskList tasks={sortByPriority(myInbox)} onOpen={setOpenId} profiles={profiles} isAr={isAr} loading={loading} />
        </TabsContent>
        <TabsContent value="done" className="mt-4">
          <TaskList tasks={myDone} onOpen={setOpenId} profiles={profiles} isAr={isAr} loading={loading} />
        </TabsContent>
        {isManager && (
          <TabsContent value="assigned" className="mt-4">
            <TaskList tasks={sortByPriority(assignedByMe)} onOpen={setOpenId} profiles={profiles} isAr={isAr} loading={loading} />
          </TabsContent>
        )}
      </Tabs>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isAr ? "مهمة جديدة" : "New task"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">{isAr ? "العنوان" : "Title"}</label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={isAr ? "اكتب عنوان المهمة" : "Task title"} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{isAr ? "الوصف" : "Description"}</label>
              <Textarea rows={4} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs text-muted-foreground">{isAr ? "المكلَّف" : "Assignee"}</label>
                <Select value={form.assignee_id} onValueChange={v => setForm({ ...form, assignee_id: v })}>
                  <SelectTrigger><SelectValue placeholder={isAr ? "اختر" : "Select"} /></SelectTrigger>
                  <SelectContent>
                    {allTeam.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{isAr ? "الأولوية" : "Priority"}</label>
                <Select value={form.priority} onValueChange={(v: TaskPriority) => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["urgent","high","normal","low"] as TaskPriority[]).map(p => (
                      <SelectItem key={p} value={p}>{isAr ? PRIO_META[p].ar : PRIO_META[p].en}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{isAr ? "تاريخ الاستحقاق" : "Due date"}</label>
                <Input type="datetime-local" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={submitCreate}>{isAr ? "إسناد" : "Assign"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task detail dialog */}
      <Dialog open={!!openId} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {openTask && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span>{openTask.title}</span>
                  <PriorityBadge p={openTask.priority} isAr={isAr} />
                  <StatusBadge s={openTask.status} isAr={isAr} />
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {openTask.description && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap">{openTask.description}</div>
                )}
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <Meta label={isAr ? "أسندها" : "Assigned by"} value={profiles.byId(openTask.assigned_by)?.display_name || "—"} />
                  <Meta label={isAr ? "المكلَّف" : "Assignee"} value={profiles.byId(openTask.assignee_id)?.display_name || "—"} />
                  <Meta label={isAr ? "تاريخ الإسناد" : "Created"} value={fmtDateTime(openTask.created_at, lang)} />
                  {openTask.due_date && <Meta label={isAr ? "الاستحقاق" : "Due"} value={fmtDateTime(openTask.due_date, lang)} />}
                  {openTask.started_at && <Meta label={isAr ? "بدأت" : "Started"} value={fmtDateTime(openTask.started_at, lang)} />}
                  {openTask.completed_at && <Meta label={isAr ? "انتهت" : "Completed"} value={fmtDateTime(openTask.completed_at, lang)} />}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  {openTask.assignee_id === user?.id && openTask.status === "pending" && (
                    <Button size="sm" onClick={() => updateStatus(openTask, "in_progress")}>
                      <Play className="h-4 w-4 me-1" />{isAr ? "بدء التنفيذ" : "Start"}
                    </Button>
                  )}
                  {openTask.assignee_id === user?.id && openTask.status === "in_progress" && (
                    <Button size="sm" onClick={() => updateStatus(openTask, "done")}>
                      <CheckCircle2 className="h-4 w-4 me-1" />{isAr ? "تم الإنجاز" : "Mark done"}
                    </Button>
                  )}
                  {openTask.assignee_id === user?.id && openTask.status !== "done" && openTask.status !== "cancelled" && (
                    <Button size="sm" variant="outline" onClick={() => updateStatus(openTask, "pending")}>
                      {isAr ? "إعادة إلى الانتظار" : "Reset"}
                    </Button>
                  )}
                  {isManager && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => updateStatus(openTask, "cancelled")}>
                        <XCircle className="h-4 w-4 me-1" />{isAr ? "إلغاء" : "Cancel"}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => deleteTask(openTask)}>
                        <Trash2 className="h-4 w-4 me-1" />{isAr ? "حذف" : "Delete"}
                      </Button>
                    </>
                  )}
                </div>

                {/* Comments */}
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
                    <Textarea rows={2} value={newComment} onChange={e => setNewComment(e.target.value)} placeholder={isAr ? "اكتب تعليقاً..." : "Add a comment..."} />
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
    </div>
  );
}

function sortByPriority(list: Task[]) {
  const order: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  return [...list].sort((a, b) => {
    const p = order[a.priority] - order[b.priority];
    if (p !== 0) return p;
    return (a.due_date || "9999").localeCompare(b.due_date || "9999");
  });
}

function TaskList({ tasks, onOpen, profiles, isAr, loading }: {
  tasks: Task[]; onOpen: (id: string) => void;
  profiles: ReturnType<typeof useTeamProfiles>; isAr: boolean; loading: boolean;
}) {
  if (loading) return <div className="text-sm text-muted-foreground text-center py-8">{isAr ? "جاري التحميل..." : "Loading..."}</div>;
  if (tasks.length === 0) return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {isAr ? "لا توجد مهام هنا" : "No tasks here"}
    </div>
  );
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {tasks.map(t => {
        const assignee = profiles.byId(t.assignee_id);
        const overdue = t.due_date && t.status !== "done" && t.status !== "cancelled" && new Date(t.due_date) < new Date();
        return (
          <button
            key={t.id}
            onClick={() => onOpen(t.id)}
            className={`text-start rounded-2xl border bg-card p-4 shadow-sm transition hover:shadow-md hover:border-primary/50 ${overdue ? "border-red-500/50" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-bold truncate">{t.title}</div>
                {t.description && <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{t.description}</div>}
              </div>
              <PriorityBadge p={t.priority} isAr={isAr} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge s={t.status} isAr={isAr} />
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <UserIcon className="h-3 w-3" />
                {assignee?.display_name || assignee?.email || "—"}
              </span>
              {t.due_date && (
                <span className={`inline-flex items-center gap-1 ${overdue ? "text-red-600 font-bold" : "text-muted-foreground"}`}>
                  <Clock className="h-3 w-3" />
                  {new Date(t.due_date).toLocaleDateString()}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function PriorityBadge({ p, isAr }: { p: TaskPriority; isAr: boolean }) {
  const m = PRIO_META[p];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold shrink-0 ${m.cls}`}>
      <Flag className="h-3 w-3" />
      {isAr ? m.ar : m.en}
    </span>
  );
}
function StatusBadge({ s, isAr }: { s: TaskStatus; isAr: boolean }) {
  const m = STATUS_META[s];
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${m.cls}`}>
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
