import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ClipboardList, Plus, CheckCircle2, XCircle, Play, Flag, MessageSquare,
  Send, Trash2, AlertTriangle, Inbox, Send as SendIcon, Search,
  X, ChevronRight, Circle, CircleDot, Timer, Keyboard, UserPlus,
  FileText, Truck,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { List, type RowComponentProps } from "react-window";
import { toast } from "sonner";
import { TaskInvoicePicker } from "@/components/task-invoice-picker";
import { TaskInvoiceChip } from "@/components/task-invoice-chip";


export const Route = createFileRoute("/tasks")({
  component: () => <AppShell><TasksPage /></AppShell>,
});

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
};
type Comment = { id: string; task_id: string; author_id: string; body: string; created_at: string };

const PRIO_META: Record<TaskPriority, { ar: string; en: string; dot: string; text: string; ring: string; order: number }> = {
  urgent: { ar: "عاجلة",  en: "Urgent", dot: "bg-red-500",    text: "text-red-600",    ring: "ring-red-500/30",    order: 0 },
  high:   { ar: "عالية",  en: "High",   dot: "bg-orange-500", text: "text-orange-600", ring: "ring-orange-500/30", order: 1 },
  normal: { ar: "عادية",  en: "Normal", dot: "bg-blue-500",   text: "text-blue-600",   ring: "ring-blue-500/30",   order: 2 },
  low:    { ar: "منخفضة", en: "Low",    dot: "bg-slate-400",  text: "text-slate-500",  ring: "ring-slate-500/30",  order: 3 },
};

const STATUS_META: Record<TaskStatus, { ar: string; en: string; icon: any; tone: string }> = {
  pending:     { ar: "قيد الانتظار", en: "Todo",        icon: Circle,      tone: "text-slate-500" },
  in_progress: { ar: "قيد التنفيذ",   en: "In progress", icon: CircleDot,   tone: "text-amber-500" },
  done:        { ar: "منجزة",         en: "Done",        icon: CheckCircle2, tone: "text-emerald-500" },
  cancelled:   { ar: "ملغاة",         en: "Cancelled",   icon: XCircle,     tone: "text-slate-400" },
};

function TasksPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const profiles = useTeamProfiles();

  const isManager = MANAGER_EMAILS.includes((user?.email || "").toLowerCase() as typeof MANAGER_EMAILS[number]);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");

  // Filters
  const [view, setView] = useState<"inbox" | "done" | "sent" | "all">("inbox");
  const [prioFilter, setPrioFilter] = useState<TaskPriority | "all">("all");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [invFilter, setInvFilter] = useState<"all" | "closed" | "open" | "none">("all");
  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkAssignee, setBulkAssignee] = useState<string>("");
  const [form, setForm] = useState<{ title: string; description: string; assignee_id: string; priority: TaskPriority; due_date: string; invoice_id: string | null; delivery_receipt_ids: string[] }>({
    title: "", description: "", assignee_id: "", priority: "normal", due_date: "", invoice_id: null, delivery_receipt_ids: [],
  });

  // Invoice-status hydration for filter chip (closed / open / none)
  const [invStatusMap, setInvStatusMap] = useState<Record<string, string | null>>({});

  // Position-preserving merge: keep existing row identity/order; only new
  // ids append. Rows that disappear from the server are removed. This prevents
  // visual reflow during realtime refreshes.
  const mergeTasks = (next: Task[]) => {
    setTasks((prev) => {
      const nextIds = new Set(next.map(n => n.id));
      const nextById = new Map(next.map(n => [n.id, n] as const));
      const keptInOrder: Task[] = [];
      for (const p of prev) {
        if (!nextIds.has(p.id)) continue;
        const n = nextById.get(p.id)!;
        // Shallow-equal check by JSON is cheap for small task objects and
        // preserves reference when nothing changed → skips row re-render.
        keptInOrder.push(JSON.stringify(p) === JSON.stringify(n) ? p : n);
        nextIds.delete(p.id);
      }
      // Append genuinely-new rows in their fetched order.
      for (const n of next) if (nextIds.has(n.id)) keptInOrder.push(n);
      return keptInOrder;
    });
  };

  const load = async () => {
    const { data } = await supabase.from("tasks" as any).select("*").order("created_at", { ascending: false }).limit(500);
    mergeTasks(((data as any) ?? []) as Task[]);
    setLoading(false);
  };

  useEffect(() => { if (user) load(); }, [user?.id]);
  useRealtimeTable("tasks" as any, () => load());


  // Comments for the currently open task
  useEffect(() => {
    if (!openId) { setComments([]); return; }
    supabase.from("task_comments" as any).select("*").eq("task_id", openId).order("created_at", { ascending: true })
      .then(({ data }) => setComments((data as any) ?? []));
  }, [openId]);
  useRealtimeTable("task_comments" as any, () => {
    if (!openId) return;
    supabase.from("task_comments" as any).select("*").eq("task_id", openId).order("created_at", { ascending: true })
      .then(({ data }) => setComments((data as any) ?? []));
  });

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

  // Hydrate invoice statuses for any linked invoices so the filter can distinguish
  // closed (after-sales) vs open (customer) tasks without a per-row fetch.
  useEffect(() => {
    const needed = Array.from(new Set(tasks.map(t => t.invoice_id).filter((x): x is string => !!x && !(x in invStatusMap))));
    if (needed.length === 0) return;
    supabase.from("invoices").select("id, status").in("id", needed)
      .then(({ data }) => {
        if (!data) return;
        setInvStatusMap(prev => {
          const next = { ...prev };
          for (const r of data as any[]) next[r.id] = r.status ?? null;
          return next;
        });
      });
  }, [tasks]);

  // Filter only — no re-sort. The fetched order (newest first by created_at)
  // is the single source of truth for position, so applying a filter, changing
  // view, or typing in search never moves an existing row.
  const visible = useMemo(() => {
    let list = tasks;
    if (view === "inbox") list = list.filter(t => t.assignee_id === user?.id && t.status !== "done" && t.status !== "cancelled");
    else if (view === "done") list = list.filter(t => t.assignee_id === user?.id && (t.status === "done" || t.status === "cancelled"));
    else if (view === "sent") list = list.filter(t => t.assigned_by === user?.id);
    if (prioFilter !== "all") list = list.filter(t => t.priority === prioFilter);
    if (statusFilter !== "all") list = list.filter(t => t.status === statusFilter);
    if (invFilter !== "all") {
      list = list.filter(t => {
        if (invFilter === "none") return !t.invoice_id;
        if (!t.invoice_id) return false;
        const s = invStatusMap[t.invoice_id];
        const closed = s === "completed";
        return invFilter === "closed" ? closed : !closed;
      });
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(t => t.title.toLowerCase().includes(q) || (t.description || "").toLowerCase().includes(q));
    }
    return list;
  }, [tasks, view, prioFilter, statusFilter, invFilter, invStatusMap, search, user?.id]);



  // Counters for the sidebar
  const counts = useMemo(() => {
    const mine = tasks.filter(t => t.assignee_id === user?.id);
    return {
      inbox: mine.filter(t => t.status !== "done" && t.status !== "cancelled").length,
      done: mine.filter(t => t.status === "done" || t.status === "cancelled").length,
      sent: tasks.filter(t => t.assigned_by === user?.id).length,
      overdue: mine.filter(t => t.due_date && t.status !== "done" && t.status !== "cancelled" && new Date(t.due_date) < new Date()).length,
    };
  }, [tasks, user?.id]);

  const submitCreate = async () => {
    if (!form.title.trim() || !form.assignee_id) { toast.error(isAr ? "أدخل العنوان واختر المكلَّف" : "Title and assignee required"); return; }
    const { error } = await supabase.from("tasks" as any).insert({
      title: form.title.trim(),
      description: form.description.trim() || null,
      assignee_id: form.assignee_id,
      assigned_by: user!.id,
      priority: form.priority,
      due_date: form.due_date ? new Date(form.due_date).toISOString() : null,
      invoice_id: form.invoice_id,
      delivery_receipt_ids: form.delivery_receipt_ids,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم إسناد المهمة" : "Task assigned");
    setCreateOpen(false);
    setForm({ title: "", description: "", assignee_id: "", priority: "normal", due_date: "", invoice_id: null, delivery_receipt_ids: [] });
    load();
  };

  const updateStatus = async (task: Task, status: TaskStatus) => {
    const { error } = await supabase.from("tasks" as any).update({ status }).eq("id", task.id);
    if (error) { toast.error(error.message); return; }
  };

  const deleteTask = async (task: Task) => {
    if (!confirm(isAr ? "حذف المهمة نهائياً؟" : "Delete task?")) return;
    const { error } = await supabase.from("tasks" as any).delete().eq("id", task.id);
    if (error) { toast.error(error.message); return; }
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

  // ----- Bulk actions -----
  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const clearSelection = () => setSelected(new Set());
  const selectAllVisible = () => setSelected(new Set(visible.map(t => t.id)));

  const bulkUpdate = async (patch: Partial<Pick<Task, "status" | "priority" | "assignee_id">>) => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const { error } = await supabase.from("tasks" as any).update(patch).in("id", ids);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? `تم تحديث ${ids.length} مهمة` : `Updated ${ids.length} tasks`);
    clearSelection();
  };
  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(isAr ? `حذف ${selected.size} مهمة نهائياً؟` : `Delete ${selected.size} tasks?`)) return;
    const ids = Array.from(selected);
    const { error } = await supabase.from("tasks" as any).delete().in("id", ids);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم الحذف" : "Deleted");
    clearSelection();
  };
  const bulkReassign = async () => {
    if (!bulkAssignee) return;
    await bulkUpdate({ assignee_id: bulkAssignee });
    setBulkAssignOpen(false);
    setBulkAssignee("");
  };

  // Keyboard shortcuts: j/k select-nav, o open, x toggle-select, c create, / focus search, ? help, esc close
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if (e.key === "Escape") { if (selected.size > 0) clearSelection(); else setOpenId(null); return; }
      if (inField) return;
      if (e.key === "?") { e.preventDefault(); setHelpOpen(true); return; }
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === "c" && isManager) { e.preventDefault(); setCreateOpen(true); return; }
      if (e.key === "x" && openId) { e.preventDefault(); toggleSelect(openId); return; }
      if (visible.length === 0) return;
      const idx = openId ? visible.findIndex(t => t.id === openId) : -1;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = visible[Math.min(visible.length - 1, idx + 1)] ?? visible[0];
        if (next) setOpenId(next.id);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = visible[Math.max(0, idx - 1)] ?? visible[0];
        if (prev) setOpenId(prev.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, openId, isManager, selected.size]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ClipboardList className="h-6 w-6 text-primary shrink-0" />
            <span>{isAr ? "إدارة المهام" : "Tasks"}</span>
            <span className="text-xs font-normal text-muted-foreground ms-2 hidden sm:inline">
              {isAr ? "اختصارات:" : "Shortcuts:"} <kbd className="rounded border px-1">j/k</kbd> · <kbd className="rounded border px-1">/</kbd>{isManager && <> · <kbd className="rounded border px-1">c</kbd></>}
            </span>
          </h1>
          {!isManager && (
            <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              {isAr ? `منشئو المهام المصرّح لهم: ${MANAGER_EMAILS.join("، ")}` : `Task creators: ${MANAGER_EMAILS.join(", ")}`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setHelpOpen(true)}
            aria-label={isAr ? "عرض اختصارات لوحة المفاتيح" : "Show keyboard shortcuts"}
            title={isAr ? "الاختصارات (?)" : "Shortcuts (?)"}
          >
            <Keyboard className="h-4 w-4" aria-hidden="true" />
          </Button>
          {isManager && (
            <Button
              onClick={() => setCreateOpen(true)}
              size="sm"
              aria-label={isAr ? "إنشاء مهمة جديدة" : "Create new task"}
            >
              <Plus className="h-4 w-4 me-1" aria-hidden="true" />
              {isAr ? "مهمة جديدة" : "New task"}
            </Button>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div
          role="region"
          aria-label={isAr ? "شريط الإجراءات الجماعية" : "Bulk actions"}
          aria-live="polite"
          className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 backdrop-blur p-2 shadow-md"
        >
          <span className="text-sm font-bold px-2">
            {isAr ? `${selected.size} مهمة محددة` : `${selected.size} selected`}
          </span>
          <div className="h-4 w-px bg-border" aria-hidden="true" />
          <Select onValueChange={(v: TaskStatus) => bulkUpdate({ status: v })}>
            <SelectTrigger className="h-8 w-auto min-w-[120px]"><SelectValue placeholder={isAr ? "تغيير الحالة" : "Set status"} /></SelectTrigger>
            <SelectContent>
              {(["pending","in_progress","done","cancelled"] as TaskStatus[]).map(s => (
                <SelectItem key={s} value={s}>{isAr ? STATUS_META[s].ar : STATUS_META[s].en}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select onValueChange={(v: TaskPriority) => bulkUpdate({ priority: v })}>
            <SelectTrigger className="h-8 w-auto min-w-[120px]"><SelectValue placeholder={isAr ? "تغيير الأولوية" : "Set priority"} /></SelectTrigger>
            <SelectContent>
              {(["urgent","high","normal","low"] as TaskPriority[]).map(p => (
                <SelectItem key={p} value={p}>{isAr ? PRIO_META[p].ar : PRIO_META[p].en}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isManager && (
            <>
              <Button size="sm" variant="outline" onClick={() => setBulkAssignOpen(true)}>
                <UserPlus className="h-4 w-4 me-1" />
                {isAr ? "إعادة إسناد" : "Reassign"}
              </Button>
              <Button size="sm" variant="destructive" onClick={bulkDelete}>
                <Trash2 className="h-4 w-4 me-1" />
                {isAr ? "حذف" : "Delete"}
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={clearSelection} className="ms-auto">
            <X className="h-4 w-4 me-1" />
            {isAr ? "إلغاء التحديد" : "Clear"}
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className="space-y-1">
          <SidebarLink active={view === "inbox"} onClick={() => setView("inbox")} icon={Inbox} label={isAr ? "الوارد" : "Inbox"} count={counts.inbox} accent={counts.overdue > 0} />
          <SidebarLink active={view === "done"} onClick={() => setView("done")} icon={CheckCircle2} label={isAr ? "منجزة" : "Completed"} count={counts.done} />
          {isManager && <SidebarLink active={view === "sent"} onClick={() => setView("sent")} icon={SendIcon} label={isAr ? "أسندتها" : "Sent"} count={counts.sent} />}
          <SidebarLink active={view === "all"} onClick={() => setView("all")} icon={ClipboardList} label={isAr ? "الكل" : "All"} count={tasks.length} />

          {counts.overdue > 0 && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-red-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                {isAr ? "متأخرة" : "Overdue"}
                <span className="ms-auto rounded-full bg-red-500 px-1.5 text-[10px] text-white">{counts.overdue}</span>
              </div>
            </div>
          )}

          <div className="mt-4 space-y-2">
            <FilterGroup label={isAr ? "الأولوية" : "Priority"}>
              <ChipRow>
                <Chip active={prioFilter === "all"} onClick={() => setPrioFilter("all")}>{isAr ? "الكل" : "All"}</Chip>
                {(["urgent", "high", "normal", "low"] as TaskPriority[]).map(p => (
                  <Chip key={p} active={prioFilter === p} onClick={() => setPrioFilter(p)}>
                    <span className={`h-1.5 w-1.5 rounded-full ${PRIO_META[p].dot}`} />
                    {isAr ? PRIO_META[p].ar : PRIO_META[p].en}
                  </Chip>
                ))}
              </ChipRow>
            </FilterGroup>
            <FilterGroup label={isAr ? "الحالة" : "Status"}>
              <ChipRow>
                <Chip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>{isAr ? "الكل" : "All"}</Chip>
                {(["pending", "in_progress", "done"] as TaskStatus[]).map(s => (
                  <Chip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                    {isAr ? STATUS_META[s].ar : STATUS_META[s].en}
                  </Chip>
                ))}
              </ChipRow>
            </FilterGroup>
            <FilterGroup label={isAr ? "الفاتورة" : "Invoice"}>
              <ChipRow>
                <Chip active={invFilter === "all"} onClick={() => setInvFilter("all")}>{isAr ? "الكل" : "All"}</Chip>
                <Chip active={invFilter === "closed"} onClick={() => setInvFilter("closed")}>
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {isAr ? "خدمة ما بعد البيع" : "After-sales"}
                </Chip>
                <Chip active={invFilter === "open"} onClick={() => setInvFilter("open")}>
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                  {isAr ? "عميل" : "Customer"}
                </Chip>
                <Chip active={invFilter === "none"} onClick={() => setInvFilter("none")}>{isAr ? "بدون فاتورة" : "No invoice"}</Chip>
              </ChipRow>
            </FilterGroup>
          </div>
        </aside>

        {/* List + detail */}
        <div className="min-w-0">
          {/* Search bar */}
          <div className="mb-2 relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={isAr ? "بحث... (اضغط / للتركيز)" : "Search... (press /)"}
              className="ps-9 h-9"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Dense list */}
          <div className="rounded-lg border bg-card overflow-hidden">
            {visible.length > 0 && (
              <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs">
                <Checkbox
                  checked={selected.size > 0 && visible.every(t => selected.has(t.id))}
                  onCheckedChange={(c) => c ? selectAllVisible() : clearSelection()}
                />
                <span className="text-muted-foreground">
                  {isAr ? `${visible.length} مهمة` : `${visible.length} tasks`}
                  {selected.size > 0 && <span className="ms-2 font-bold text-primary">· {selected.size} {isAr ? "محددة" : "selected"}</span>}
                </span>
              </div>
            )}
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">{isAr ? "جاري التحميل..." : "Loading..."}</div>
            ) : visible.length === 0 ? (
              <EmptyState view={view} isAr={isAr} isManager={isManager} onCreate={() => setCreateOpen(true)} hasFilters={!!search || prioFilter !== "all" || statusFilter !== "all"} onClearFilters={() => { setSearch(""); setPrioFilter("all"); setStatusFilter("all"); }} />
            ) : visible.length > 50 ? (
              // Virtualize long lists — only render rows in the viewport (+overscan)
              // so scroll stays 60fps and memory usage stays flat regardless of list size.
              <List
                rowCount={visible.length}
                rowHeight={52}
                defaultHeight={Math.min(640, Math.max(320, visible.length * 52))}
                overscanCount={10}
                className="divide-y"
                rowProps={{
                  rows: visible,
                  profiles,
                  selected,
                  openId,
                  isAr,
                  onToggle: toggleSelect,
                  onOpen: setOpenId,
                }}
                rowComponent={VirtualTaskRow}
              />
            ) : (
              <ul className="divide-y">
                {visible.map(t => {
                  const overdue = t.due_date && t.status !== "done" && t.status !== "cancelled" && new Date(t.due_date) < new Date();
                  const assignee = profiles.byId(t.assignee_id);
                  const Icon = STATUS_META[t.status].icon;
                  const isSelected = selected.has(t.id);
                  return (
                    <li key={t.id} className={`flex items-center gap-2 px-3 py-2.5 transition-colors duration-300 ease-out animate-in fade-in slide-in-from-top-1 hover:bg-muted/50 ${openId === t.id ? "bg-muted/40" : ""} ${isSelected ? "bg-primary/5" : ""}`}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(t.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0"
                      />
                      <button
                        onClick={() => setOpenId(t.id)}
                        className="min-w-0 flex-1 flex items-center gap-3 text-start"
                      >
                        <span className={`h-2 w-2 rounded-full ${PRIO_META[t.priority].dot} shrink-0`} title={isAr ? PRIO_META[t.priority].ar : PRIO_META[t.priority].en} />
                        <Icon className={`h-4 w-4 shrink-0 ${STATUS_META[t.status].tone}`} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}</span>
                        {t.invoice_id && (
                          <span className="hidden md:inline-flex shrink-0" onClick={(e) => e.stopPropagation()}>
                            <TaskInvoiceChip
                              invoiceId={t.invoice_id}
                              drCount={t.delivery_receipt_ids?.length ?? 0}
                              isAr={isAr}
                              size="xs"
                            />
                          </span>
                        )}
                        <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[140px]">
                          {assignee?.display_name || assignee?.email || "—"}
                        </span>
                        {t.due_date && (
                          <span className={`hidden md:inline-flex items-center gap-1 text-xs tabular-nums ${overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                            <Timer className="h-3 w-3" />
                            {new Date(t.due_date).toLocaleDateString(isAr ? "ar-EG-u-nu-latn" : "en-GB", { day: "2-digit", month: "short" })}
                          </span>
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isAr ? "مهمة جديدة" : "New task"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">{isAr ? "العنوان" : "Title"}</label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={isAr ? "اكتب عنوان المهمة" : "Task title"} autoFocus />
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
                <label className="text-xs text-muted-foreground">{isAr ? "الاستحقاق" : "Due"}</label>
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
                  <span className={`h-2 w-2 rounded-full ${PRIO_META[openTask.priority].dot}`} />
                  <span className="min-w-0 truncate">{openTask.title}</span>
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
                  <Meta label={isAr ? "الإسناد" : "Created"} value={fmtDateTime(openTask.created_at, lang)} />
                  {openTask.due_date && <Meta label={isAr ? "الاستحقاق" : "Due"} value={fmtDateTime(openTask.due_date, lang)} />}
                  {openTask.started_at && <Meta label={isAr ? "بدأت" : "Started"} value={fmtDateTime(openTask.started_at, lang)} />}
                  {openTask.completed_at && <Meta label={isAr ? "انتهت" : "Completed"} value={fmtDateTime(openTask.completed_at, lang)} />}
                </div>

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

      {/* Bulk reassign dialog */}
      <Dialog open={bulkAssignOpen} onOpenChange={setBulkAssignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isAr ? `إعادة إسناد ${selected.size} مهمة` : `Reassign ${selected.size} tasks`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">{isAr ? "المكلَّف الجديد" : "New assignee"}</label>
            <Select value={bulkAssignee} onValueChange={setBulkAssignee}>
              <SelectTrigger><SelectValue placeholder={isAr ? "اختر" : "Select"} /></SelectTrigger>
              <SelectContent>
                {allTeam.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAssignOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={bulkReassign} disabled={!bulkAssignee}>{isAr ? "إسناد" : "Assign"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Keyboard shortcuts help */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Keyboard className="h-5 w-5" />{isAr ? "اختصارات لوحة المفاتيح" : "Keyboard shortcuts"}</DialogTitle>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            {[
              { k: "j / ↓", ar: "المهمة التالية", en: "Next task" },
              { k: "k / ↑", ar: "المهمة السابقة", en: "Previous task" },
              { k: "x", ar: "تحديد/إلغاء المهمة المفتوحة", en: "Toggle selection" },
              { k: "/", ar: "التركيز على البحث", en: "Focus search" },
              { k: "?", ar: "عرض هذه القائمة", en: "Show this help" },
              { k: "Esc", ar: "إغلاق / إلغاء التحديد", en: "Close / clear selection" },
              ...(isManager ? [{ k: "c", ar: "إنشاء مهمة", en: "Create task" }] : []),
              { k: "⌘/Ctrl + Enter", ar: "إرسال التعليق", en: "Send comment" },
            ].map((s, i) => (
              <li key={i} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
                <span>{isAr ? s.ar : s.en}</span>
                <kbd className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">{s.k}</kbd>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({ view, isAr, isManager, onCreate, hasFilters, onClearFilters }: {
  view: "inbox" | "done" | "sent" | "all"; isAr: boolean; isManager: boolean;
  onCreate: () => void; hasFilters: boolean; onClearFilters: () => void;
}) {
  const meta: Record<string, { ar: string; en: string; sub_ar: string; sub_en: string; icon: any }> = {
    inbox: { ar: "صندوق الوارد فارغ", en: "Inbox is empty", sub_ar: "لا توجد مهام مسندة إليك حالياً. استمتع باستراحة! ☕", sub_en: "No tasks assigned to you. Enjoy the break! ☕", icon: Inbox },
    done:  { ar: "لا توجد مهام منجزة بعد", en: "No completed tasks yet", sub_ar: "المهام المنجزة ستظهر هنا.", sub_en: "Completed tasks will appear here.", icon: CheckCircle2 },
    sent:  { ar: "لم تُسند أي مهمة بعد", en: "No tasks sent", sub_ar: "أنشئ مهمة جديدة لتوزيعها على الفريق.", sub_en: "Create a new task to assign to the team.", icon: SendIcon },
    all:   { ar: "لا توجد مهام", en: "No tasks", sub_ar: "ابدأ بإنشاء أول مهمة.", sub_en: "Start by creating the first task.", icon: ClipboardList },
  };
  const m = meta[view];
  const Icon = m.icon;
  if (hasFilters) {
    return (
      <div className="p-12 text-center">
        <Search className="mx-auto mb-3 h-10 w-10 opacity-40" />
        <div className="text-sm font-medium">{isAr ? "لا توجد نتائج للفلاتر الحالية" : "No results for current filters"}</div>
        <Button size="sm" variant="outline" className="mt-3" onClick={onClearFilters}>{isAr ? "مسح الفلاتر" : "Clear filters"}</Button>
      </div>
    );
  }
  return (
    <div className="p-12 text-center">
      <Icon className="mx-auto mb-3 h-12 w-12 opacity-40" />
      <div className="text-base font-semibold">{isAr ? m.ar : m.en}</div>
      <div className="mt-1 text-sm text-muted-foreground">{isAr ? m.sub_ar : m.sub_en}</div>
      {isManager && (view === "sent" || view === "all") && (
        <Button size="sm" className="mt-4" onClick={onCreate}>
          <Plus className="h-4 w-4 me-1" />{isAr ? "مهمة جديدة" : "New task"}
        </Button>
      )}
    </div>
  );
}

function SidebarLink({ active, onClick, icon: Icon, label, count, accent }: {
  active: boolean; onClick: () => void; icon: any; label: string; count: number; accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
        active ? "bg-primary/10 text-primary" : "text-foreground/70 hover:bg-muted"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1 text-start">{label}</span>
      {count > 0 && (
        <span className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${
          accent ? "bg-red-500 text-white" : active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
        }`}>{count}</span>
      )}
    </button>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1">{children}</div>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
        active ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

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

type VirtualRowProps = {
  rows: Task[];
  profiles: ReturnType<typeof useTeamProfiles>;
  selected: Set<string>;
  openId: string | null;
  isAr: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
};

function VirtualTaskRow({ index, style, ariaAttributes, rows, profiles, selected, openId, isAr, onToggle, onOpen }: RowComponentProps<VirtualRowProps>) {
  const t = rows[index];
  if (!t) return null;
  const overdue = !!(t.due_date && t.status !== "done" && t.status !== "cancelled" && new Date(t.due_date) < new Date());
  const assignee = profiles.byId(t.assignee_id);
  const Icon = STATUS_META[t.status].icon;
  const isSelected = selected.has(t.id);
  return (
    <div
      style={style}
      {...ariaAttributes}
      className={`flex items-center gap-2 px-3 py-2.5 transition-colors duration-150 hover:bg-muted/50 ${openId === t.id ? "bg-muted/40" : ""} ${isSelected ? "bg-primary/5" : ""}`}
    >
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onToggle(t.id)}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0"
      />
      <button onClick={() => onOpen(t.id)} className="min-w-0 flex-1 flex items-center gap-3 text-start">
        <span className={`h-2 w-2 rounded-full ${PRIO_META[t.priority].dot} shrink-0`} title={isAr ? PRIO_META[t.priority].ar : PRIO_META[t.priority].en} />
        <Icon className={`h-4 w-4 shrink-0 ${STATUS_META[t.status].tone}`} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}</span>
        <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[140px]">
          {assignee?.display_name || assignee?.email || "—"}
        </span>
        {t.due_date && (
          <span className={`hidden md:inline-flex items-center gap-1 text-xs tabular-nums ${overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
            <Timer className="h-3 w-3" />
            {new Date(t.due_date).toLocaleDateString(isAr ? "ar-EG-u-nu-latn" : "en-GB", { day: "2-digit", month: "short" })}
          </span>
        )}
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>
    </div>
  );
}

