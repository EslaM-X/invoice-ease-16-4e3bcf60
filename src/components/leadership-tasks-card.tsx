import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Crown, Briefcase, Sparkles, AlertTriangle, Clock, PlayCircle, CheckCircle2, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useEffectiveUser } from "@/lib/use-effective-user";
import { useTeamProfiles } from "@/lib/team-profiles";
import { useRealtimeTable } from "@/lib/realtime";

/**
 * Leadership Tasks Card
 * Visible only for the two allowed accounts. Shows tasks assigned by the
 * CEO (k.elsharbatly) and the COO — Chief Operating Officer (e.hesham),
 * split into two halves.
 */
const ALLOWED_VIEWERS = new Set(["esraa@steinheim-eg.com", "f.hesham@steinheim-eg.com"]);

const CEO = { email: "k.elsharbatly@steinheim-eg.com", roleAr: "المدير التنفيذي — CEO", roleEn: "CEO — Chief Executive Officer", short: "CEO", displayOverride: null as string | null, Icon: Crown };
const COO = { email: "e.hesham@steinheim-eg.com",      roleAr: "مدير العمليات التنفيذي — COO", roleEn: "COO — Chief Operating Officer", short: "COO", displayOverride: "Eslam Hesham" as string | null, Icon: Briefcase };

type Task = {
  id: string;
  title: string;
  description: string | null;
  assignee_id: string;
  assigned_by: string;
  priority: "urgent" | "high" | "normal" | "low";
  status: "pending" | "in_progress" | "done" | "cancelled";
  due_date: string | null;
  created_at: string;
};

const PRIORITY_ORDER: Record<Task["priority"], number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function priorityChip(p: Task["priority"], isAr: boolean) {
  const map = {
    urgent: { ar: "عاجلة", en: "Urgent", cls: "bg-red-500/15 text-red-300 ring-red-400/40" },
    high:   { ar: "عالية", en: "High",   cls: "bg-amber-500/15 text-amber-300 ring-amber-400/40" },
    normal: { ar: "عادية", en: "Normal", cls: "bg-sky-500/15 text-sky-300 ring-sky-400/40" },
    low:    { ar: "منخفضة", en: "Low",    cls: "bg-neutral-500/15 text-neutral-300 ring-neutral-400/30" },
  } as const;
  const m = map[p];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${m.cls}`}>{isAr ? m.ar : m.en}</span>;
}

function statusChip(s: Task["status"], isAr: boolean) {
  const map = {
    pending:     { ar: "قيد الانتظار", en: "Pending",     Icon: Clock,        cls: "text-amber-300 ring-amber-400/30" },
    in_progress: { ar: "قيد التنفيذ",  en: "In progress", Icon: PlayCircle,   cls: "text-sky-300 ring-sky-400/30" },
    done:        { ar: "منجزة",         en: "Done",        Icon: CheckCircle2, cls: "text-emerald-300 ring-emerald-400/30" },
    cancelled:   { ar: "ملغاة",         en: "Cancelled",   Icon: AlertTriangle, cls: "text-neutral-400 ring-neutral-500/30" },
  } as const;
  const m = map[s];
  const Icon = m.Icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 bg-black/30 ${m.cls}`}>
      <Icon className="h-3 w-3" />
      {isAr ? m.ar : m.en}
    </span>
  );
}

function initialsOf(name: string | null, email: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function LeaderAvatar({ url, name, email, size = 56 }: { url: string | null; name: string | null; email: string | null; size?: number }) {
  return (
    <div
      className="relative shrink-0 rounded-full"
      style={{
        width: `clamp(64px, ${size * 0.85}px, ${size}px)`,
        height: `clamp(64px, ${size * 0.85}px, ${size}px)`,
        padding: 2,
        background: "conic-gradient(from 220deg, #E9C77E, #B8863A, #F6E1A4, #8A5A1A, #E9C77E)",
        boxShadow: "0 0 0 1px rgba(0,0,0,0.6), 0 0 24px -6px rgba(233,199,126,0.35)",
      }}
    >
      <div className="h-full w-full rounded-full bg-neutral-950 p-[2px]">
        {url ? (
          <img
            src={url}
            alt={name || email || ""}
            loading="lazy"
            className="h-full w-full rounded-full object-cover object-top"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-neutral-800 to-neutral-950 text-lg font-bold text-amber-200">
            {initialsOf(name, email)}
          </div>
        )}
      </div>
    </div>
  );
}

export function LeadershipTasksCard() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const effective = useEffectiveUser();
  const viewerEmail = (effective.email ?? "").trim().toLowerCase();
  const allowed = ALLOWED_VIEWERS.has(viewerEmail);

  const team = useTeamProfiles();
  const ceoProfile = team.byEmail(CEO.email);
  const cooProfile = team.byEmail(COO.email);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<"all" | Task["priority"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | Task["status"]>("all");
  const [flash, setFlash] = useState<{ ceo: boolean; coo: boolean }>({ ceo: false, coo: false });

  const meId = effective.id;
  const ceoId = ceoProfile?.user_id ?? null;
  const cooId = cooProfile?.user_id ?? null;

  async function refresh() {
    if (!meId || (!ceoId && !cooId)) { setTasks([]); setLoaded(true); return; }
    const ids = [ceoId, cooId].filter(Boolean) as string[];
    const { data } = await supabase
      .from("tasks")
      .select("id,title,description,assignee_id,assigned_by,priority,status,due_date,created_at")
      .eq("assignee_id", meId)
      .in("assigned_by", ids)
      .order("created_at", { ascending: false })
      .limit(200);
    setTasks((data as Task[]) ?? []);
    setLoaded(true);
  }

  useEffect(() => { if (allowed) void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [allowed, meId, ceoId, cooId]);

  useRealtimeTable("tasks", (payload: any) => {
    if (!allowed) return;
    const row = payload?.new ?? payload?.old;
    if (!row || row.assignee_id !== meId) return;
    if (row.assigned_by !== ceoId && row.assigned_by !== cooId) return;
    // Flash the half that received the new/updated task
    if (payload?.eventType === "INSERT") {
      if (row.assigned_by === ceoId) setFlash((f) => ({ ...f, ceo: true }));
      if (row.assigned_by === cooId) setFlash((f) => ({ ...f, coo: true }));
      setTimeout(() => setFlash({ ceo: false, coo: false }), 10000);
    }
    void refresh();
  });

  const filtered = useMemo(() => {
    return tasks.filter((t) => (priorityFilter === "all" || t.priority === priorityFilter) && (statusFilter === "all" || t.status === statusFilter));
  }, [tasks, priorityFilter, statusFilter]);

  const ceoTasks = useMemo(() => filtered.filter((t) => t.assigned_by === ceoId).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]), [filtered, ceoId]);
  const cooTasks = useMemo(() => filtered.filter((t) => t.assigned_by === cooId).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]), [filtered, cooId]);

  if (!allowed) return null;

  return (
    <section
      dir={isAr ? "rtl" : "ltr"}
      aria-label={isAr ? "مهامي من القيادة" : "Tasks from leadership"}
      className="leadership-tasks-surface relative overflow-hidden rounded-2xl p-3 sm:p-4 md:p-5"
    >
      <div aria-hidden className="gold-hairline-live absolute inset-x-0 top-0" />
      {/* Ambient gold shimmer */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute -top-24 -right-16 h-56 w-56 rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(233,199,126,0.18), transparent 60%)" }} />
        <div className="absolute -bottom-20 -left-16 h-56 w-56 rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(184,134,58,0.15), transparent 60%)" }} />
      </div>

      {/* Header */}
      <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-300/5 p-2 ring-1 ring-amber-400/30">
            <Sparkles className="h-5 w-5 text-amber-300" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight text-amber-100 sm:text-lg">
              {isAr ? "مهامي من القيادة" : "Tasks from Leadership"}
            </h2>
            <p className="truncate text-[11px] text-amber-100/60">
              {isAr ? "المهام الموكلة إليك من مجلس الإدارة" : "Tasks assigned to you by the executive team"}
            </p>
          </div>
        </div>

        {/* Filters — horizontally scrollable on narrow screens */}
        <div
          className="-mx-1 flex flex-nowrap items-center gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-wrap lg:overflow-visible"
          role="toolbar"
          aria-label={isAr ? "فلاتر المهام" : "Task filters"}
        >
          <FilterGroup
            label={isAr ? "الأولوية" : "Priority"}
            value={priorityFilter}
            onChange={(v) => setPriorityFilter(v as any)}
            options={[
              { v: "all", ar: "الكل", en: "All" },
              { v: "urgent", ar: "عاجلة", en: "Urgent" },
              { v: "high", ar: "عالية", en: "High" },
              { v: "normal", ar: "عادية", en: "Normal" },
              { v: "low", ar: "منخفضة", en: "Low" },
            ]}
            isAr={isAr}
          />
          <FilterGroup
            label={isAr ? "الحالة" : "Status"}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as any)}
            options={[
              { v: "all", ar: "الكل", en: "All" },
              { v: "pending", ar: "قيد الانتظار", en: "Pending" },
              { v: "in_progress", ar: "قيد التنفيذ", en: "In progress" },
              { v: "done", ar: "منجزة", en: "Done" },
            ]}
            isAr={isAr}
          />
        </div>
      </div>

      {/* Two halves — stack on mobile, side-by-side on md+ */}
      <div className="relative mt-4 grid gap-3 sm:gap-4 md:grid-cols-2">
        {/* Vertical gold divider */}
        <div aria-hidden className="pointer-events-none absolute inset-y-2 left-1/2 hidden w-px -translate-x-1/2 md:block"
             style={{ background: "linear-gradient(to bottom, transparent, rgba(233,199,126,0.35), transparent)" }} />

        <LeaderColumn
          isAr={isAr}
          leader={CEO}
          profile={ceoProfile}
          tasks={ceoTasks}
          loaded={loaded}
          flash={flash.ceo}
        />
        <LeaderColumn
          isAr={isAr}
          leader={COO}
          profile={cooProfile}
          tasks={cooTasks}
          loaded={loaded}
          flash={flash.coo}
        />
      </div>

      <div className="relative mt-3 flex justify-end">
        <Link to="/tasks" className="text-[11px] font-medium text-amber-200/80 hover:text-amber-200 hover:underline">
          {isAr ? "فتح إدارة المهام →" : "Open task manager →"}
        </Link>
      </div>
    </section>
  );
}

function FilterGroup<T extends string>({
  label, value, onChange, options, isAr,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ v: T; ar: string; en: string }>;
  isAr: boolean;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 rounded-full bg-black/40 p-1 ring-1 ring-amber-400/20"
      role="radiogroup"
      aria-label={label}
    >
      <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-amber-100/60">{label}</span>
      {options.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.v)}
            className={`rounded-full px-2 py-1 text-[11px] font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-1 focus-visible:ring-offset-black ${
              active
                ? "bg-gradient-to-b from-amber-400 to-amber-600 text-neutral-950 shadow"
                : "text-amber-100/70 hover:text-amber-100"
            }`}
          >
            {isAr ? o.ar : o.en}
          </button>
        );
      })}
    </div>
  );
}

function LeaderColumn({
  isAr, leader, profile, tasks, loaded, flash,
}: {
  isAr: boolean;
  leader: typeof CEO;
  profile: { display_name: string | null; email: string | null; avatar_url: string | null } | null;
  tasks: Task[];
  loaded: boolean;
  flash: boolean;
}) {
  const LeaderIcon = leader.Icon;
  const roleLabel = isAr ? leader.roleAr : leader.roleEn;
  return (
    <article
      aria-label={`${leader.short} — ${roleLabel}`}
      className={`leadership-column relative rounded-2xl bg-gradient-to-b from-neutral-950/70 to-black/50 p-3 ring-1 ring-amber-400/20 sm:p-4 ${
        flash ? "ring-2 ring-amber-300/70 shadow-[0_0_40px_-8px_rgba(233,199,126,0.55)] animate-pulse" : ""
      }`}
    >
      {/* Leader header — grid keeps text container flexible on all widths */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 sm:gap-4">
        <LeaderAvatar
          url={profile?.avatar_url ?? null}
          name={profile?.display_name ?? null}
          email={leader.email}
          size={96}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <LeaderIcon className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">{leader.short}</span>
          </div>
          <div className="mt-0.5 truncate text-base font-bold leading-tight text-amber-100 sm:text-lg">
            {leader.displayOverride || profile?.display_name || leader.email.split("@")[0]}
          </div>
          <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-amber-100/70 sm:text-xs">
            {roleLabel}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-0.5">
          <span
            className="rounded-lg bg-gradient-to-b from-amber-400/25 to-amber-600/15 px-2.5 py-1 text-sm font-bold text-amber-100 ring-1 ring-amber-400/40 tabular-nums"
            aria-label={isAr ? `${tasks.length} مهمة` : `${tasks.length} tasks`}
          >
            {tasks.length}
          </span>
          <span aria-hidden className="text-[9px] uppercase tracking-wider text-amber-100/50">{isAr ? "مهمة" : "tasks"}</span>
        </div>
      </div>

      <div aria-hidden className="my-3 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(233,199,126,0.35), transparent)" }} />

      {/* Task list — visible scroll surface, keyboard-scrollable */}
      <div
        className="leadership-scroll max-h-[60vh] min-h-[180px] overflow-y-auto sm:max-h-[420px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
        tabIndex={0}
        role="region"
        aria-label={isAr ? `مهام ${leader.short}` : `${leader.short} tasks`}
      >
        {!loaded ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-neutral-900/70 ring-1 ring-amber-400/10" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
            <Sparkles className="h-6 w-6 text-amber-300/50" aria-hidden />
            <span className="text-xs font-medium text-amber-100/70">{isAr ? "لا مهام حالياً" : "No tasks right now"}</span>
            <span className="text-[10px] text-amber-100/40">
              {isAr ? `في انتظار مهام من ${roleLabel}` : `Awaiting tasks from ${roleLabel}`}
            </span>
          </div>
        ) : (
          <ul className="space-y-2">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} isAr={isAr} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, isAr }: { task: Task; isAr: boolean }) {
  const overdue = task.due_date && task.status !== "done" && new Date(task.due_date).getTime() < Date.now();
  const due = task.due_date
    ? new Date(task.due_date).toLocaleDateString(isAr ? "ar-EG" : "en-US", { month: "short", day: "numeric" })
    : null;
  return (
    <li>
      <Link
        to="/tasks"
        className={`group block rounded-lg bg-black/40 p-2.5 ring-1 transition hover:bg-black/60 ${
          overdue ? "ring-red-400/40" : "ring-amber-400/10 hover:ring-amber-400/30"
        }`}
        style={overdue ? { borderInlineStart: "3px solid rgba(248,113,113,0.7)" } : undefined}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-amber-50 group-hover:text-amber-100">{task.title}</div>
            {task.description && (
              <div className="mt-0.5 line-clamp-2 text-[11px] text-amber-100/60">{task.description}</div>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {priorityChip(task.priority, isAr)}
              {statusChip(task.status, isAr)}
              {due && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ring-1 ${
                  overdue ? "bg-red-500/15 text-red-300 ring-red-400/40" : "bg-black/40 text-amber-100/70 ring-amber-400/20"
                }`}>
                  <CalendarDays className="h-3 w-3" />
                  {due}
                  {overdue && <span className="font-bold">{isAr ? " · متأخرة" : " · overdue"}</span>}
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}
