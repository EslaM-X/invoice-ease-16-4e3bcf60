import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Crown, Briefcase, Sparkles, AlertTriangle, Clock, PlayCircle, CheckCircle2, CalendarDays, ClipboardList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useEffectiveUser } from "@/lib/use-effective-user";
import { useTeamProfiles } from "@/lib/team-profiles";
import { useRealtimeTable } from "@/lib/realtime";
import { TaskInvoiceChip } from "@/components/task-invoice-chip";
import { TaskDetailDialog } from "@/components/task-detail-dialog";
import { TaskNotificationsCenter } from "@/components/task-notifications-center";

/**
 * Build a Supabase Storage image-transform URL. Falls back to the original
 * URL for non-Supabase sources or if the URL can't be parsed.
 * Docs: https://supabase.com/docs/guides/storage/serving/image-transformations
 */
function transformAvatar(url: string, width: number, quality: number, format?: "webp" | "avif" | "origin") {
  try {
    const u = new URL(url);
    if (!u.pathname.includes("/storage/v1/object/public/")) return url;
    u.pathname = u.pathname.replace("/storage/v1/object/", "/storage/v1/render/image/");
    u.searchParams.set("width", String(width));
    u.searchParams.set("height", String(width));
    u.searchParams.set("resize", "cover");
    u.searchParams.set("quality", String(quality));
    if (format) u.searchParams.set("format", format);
    return u.toString();
  } catch {
    return url;
  }
}

// Higher-fidelity variant ladder — up to 768w retina + q≥90 on large sizes.
const AVATAR_WIDTHS = [128, 192, 256, 384, 512, 768] as const;
function buildSrcSet(url: string, format?: "webp" | "avif" | "origin") {
  return AVATAR_WIDTHS
    .map((w) => `${transformAvatar(url, w, w >= 512 ? 92 : w >= 256 ? 88 : 84, format)} ${w}w`)
    .join(", ");
}

/** Append a version tag so a re-uploaded avatar at the SAME storage path
 *  becomes a different URL string (busts <img>, HTTP, and AVATAR_CACHE). */
function versioned(url: string | null, version: string | number | null | undefined): string | null {
  if (!url) return null;
  if (!version) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("v", String(version));
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}v=${encodeURIComponent(String(version))}`;
  }
}



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
  invoice_id: string | null;
  delivery_receipt_ids: string[] | null;
};



function shallowEqualTask(a: Task, b: Task) {
  return a.id === b.id
    && a.title === b.title
    && a.description === b.description
    && a.assignee_id === b.assignee_id
    && a.assigned_by === b.assigned_by
    && a.priority === b.priority
    && a.status === b.status
    && a.due_date === b.due_date
    && a.created_at === b.created_at;
}

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

// Module-level cache: once an avatar URL has decoded successfully in this
// tab, subsequent renders skip the skeleton entirely — prevents the blur-up
// flash when the card re-mounts (nav-back, dashboard re-order, etc.).
const AVATAR_CACHE: Set<string> = new Set();
// Track the last URL seen per leader identity. When the URL changes (avatar
// re-uploaded, ?v= bumped, path replaced), we evict the previous entry so
// the stale bitmap never wins over the fresh one.
const AVATAR_LAST_URL: Map<string, string> = new Map();

function rememberAvatar(identity: string | null | undefined, url: string | null | undefined) {
  if (!identity || !url) return;
  const prev = AVATAR_LAST_URL.get(identity);
  if (prev && prev !== url) AVATAR_CACHE.delete(prev);
  AVATAR_LAST_URL.set(identity, url);
}

function preloadAvatar(url: string) {
  if (!url || AVATAR_CACHE.has(url)) return;
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  img.onload = () => {
    (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).finally(() => {
      AVATAR_CACHE.add(url);
    });
  };
}

function LeaderAvatar({ url, name, email, size = 192, prefetchRef }: { url: string | null; name: string | null; email: string | null; size?: number; prefetchRef?: React.RefObject<HTMLElement | null> }) {
  const dim = `clamp(112px, 16vw, ${size}px)`;

  const cached = !!url && AVATAR_CACHE.has(url);
  const [imgLoaded, setImgLoaded] = useState(cached);
  const [imgError, setImgError] = useState(false);
  // If a transformed variant fails, fall back to the raw original URL.
  const [useOriginal, setUseOriginal] = useState(false);

  // Intersection-observer prefetch: warm the largest variant a little before
  // the card scrolls into view so no flash happens even at high scroll speed.
  useEffect(() => {
    if (!url) return;
    if (AVATAR_CACHE.has(url)) { setImgLoaded(true); setImgError(false); return; }
    setImgLoaded(false); setImgError(false); setUseOriginal(false);
    const el = prefetchRef?.current;
    if (!el || typeof IntersectionObserver === "undefined") { preloadAvatar(url); return; }
    let done = false;
    const io = new IntersectionObserver((entries) => {
      if (done) return;
      if (entries.some((e) => e.isIntersecting)) {
        done = true;
        preloadAvatar(url);
        io.disconnect();
      }
    }, { rootMargin: "600px 0px", threshold: 0.01 });
    io.observe(el);
    // Safety net: prefetch after 1s even if IO never triggers (edge browsers).
    const t = setTimeout(() => { if (!done) { done = true; preloadAvatar(url); io.disconnect(); } }, 1000);
    return () => { clearTimeout(t); io.disconnect(); };
  }, [url, prefetchRef]);

  const showImg = !!url && !imgError;
  const canTransform = !!url && !useOriginal && url.includes("/storage/v1/object/public/");
  const sizesAttr = `(max-width: 640px) 96px, (max-width: 1024px) 15vw, ${size}px`;

  return (
    <div
      className="relative shrink-0 rounded-full"
      style={{
        width: dim,
        height: dim,
        padding: 3,
        background: "conic-gradient(from 220deg, #E9C77E, #B8863A, #F6E1A4, #8A5A1A, #E9C77E)",
        boxShadow: "0 0 0 1px rgba(0,0,0,0.65), 0 12px 34px -12px rgba(0,0,0,0.85), 0 0 36px -6px rgba(233,199,126,0.5)",
      }}
    >
      <div className="relative h-full w-full overflow-hidden rounded-full bg-neutral-950 p-[2px]">
        <div
          aria-hidden={showImg && imgLoaded}
          className={`absolute inset-[2px] flex items-center justify-center rounded-full bg-gradient-to-br from-neutral-800 to-neutral-950 text-2xl font-bold text-amber-200/85 transition-opacity duration-500 ${
            showImg && imgLoaded ? "opacity-0" : "opacity-100"
          }`}
          style={{ fontSize: `calc(${dim} * 0.28)` }}
        >
          {showImg && !imgLoaded && (
            <span aria-hidden className="absolute inset-0 rounded-full leadership-avatar-shimmer" />
          )}
          <span className="relative">{initialsOf(name, email)}</span>
        </div>
        {showImg && (
          <picture>
            {canTransform && (
              <>
                <source type="image/avif" srcSet={buildSrcSet(url!, "avif")} sizes={sizesAttr} />
                <source type="image/webp" srcSet={buildSrcSet(url!, "webp")} sizes={sizesAttr} />
              </>
            )}
            <img
              src={canTransform ? transformAvatar(url!, Math.min(768, size * 2), 92, "origin") : url!}
              srcSet={canTransform ? buildSrcSet(url!, "origin") : undefined}
              sizes={canTransform ? sizesAttr : undefined}

              alt={name || email || ""}
              loading="eager"
              decoding="async"
              // @ts-expect-error fetchpriority is a valid HTML attribute
              fetchpriority="high"
              draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget;
                const done = () => { AVATAR_CACHE.add(url!); setImgLoaded(true); };
                if (el.decode) el.decode().then(done).catch(done); else done();
              }}
              onError={() => {
                // Transform pipeline unavailable → drop to raw URL once.
                if (canTransform) { setUseOriginal(true); return; }
                setImgError(true);
              }}
              className="relative h-full w-full rounded-full object-cover object-top transition-[filter,opacity,transform] duration-700 ease-out"
              style={{
                imageRendering: "auto",
                WebkitBackfaceVisibility: "hidden",
                opacity: imgLoaded ? 1 : 0,
                filter: imgLoaded ? "blur(0px) saturate(1.06) contrast(1.03)" : "blur(16px) saturate(1.25)",
                transform: imgLoaded ? "translateZ(0) scale(1)" : "translateZ(0) scale(1.08)",
              }}
            />
          </picture>
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
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const meId = effective.id;
  const ceoId = ceoProfile?.user_id ?? null;
  const cooId = cooProfile?.user_id ?? null;

  async function refresh() {
    if (!meId || (!ceoId && !cooId)) { setTasks([]); setLoaded(true); return; }
    const ids = [ceoId, cooId].filter(Boolean) as string[];
    const { data } = await supabase
      .from("tasks")
      .select("id,title,description,assignee_id,assigned_by,priority,status,due_date,created_at,invoice_id,delivery_receipt_ids")
      .eq("assignee_id", meId)
      .in("assigned_by", ids)
      // Ascending order = stable positions. New inserts naturally append at the
      // end; existing rows never shift when other rows are added / removed.
      .order("created_at", { ascending: true })
      .limit(200);
    const next = (data as Task[]) ?? [];
    setTasks((prev) => {
      const prevById = new Map(prev.map((t) => [t.id, t]));
      let changed = prev.length !== next.length;
      const merged = next.map((n) => {
        const p = prevById.get(n.id);
        if (p && shallowEqualTask(p, n)) return p;
        changed = true;
        return n;
      });
      return changed ? merged : prev;
    });
    setLoaded(true);
  }


  useEffect(() => { if (allowed) void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [allowed, meId, ceoId, cooId]);

  // Realtime: reconcile by id, patch in place — never re-fetch or re-sort.
  // This keeps every visible row locked to its position across INSERT/UPDATE/DELETE.
  useRealtimeTable("tasks", (payload: any) => {
    if (!allowed) return;
    const evt = payload?.eventType as "INSERT" | "UPDATE" | "DELETE" | undefined;
    const nrow = payload?.new as Task | undefined;
    const orow = payload?.old as Task | undefined;
    const belongsHere = (r?: Task) =>
      !!r && r.assignee_id === meId && (r.assigned_by === ceoId || r.assigned_by === cooId);

    setTasks((prev) => {
      if (evt === "DELETE" && orow) {
        return prev.some((t) => t.id === orow.id) ? prev.filter((t) => t.id !== orow.id) : prev;
      }
      if (evt === "INSERT" && nrow) {
        if (!belongsHere(nrow) || prev.some((t) => t.id === nrow.id)) return prev;
        return [...prev, nrow]; // append preserves existing positions
      }
      if (evt === "UPDATE" && nrow) {
        const idx = prev.findIndex((t) => t.id === nrow.id);
        if (!belongsHere(nrow)) return idx >= 0 ? prev.filter((_, i) => i !== idx) : prev;
        if (idx < 0) return [...prev, nrow];
        if (shallowEqualTask(prev[idx], nrow)) return prev;
        const copy = prev.slice();
        copy[idx] = nrow; // replace in place — position stays
        return copy;
      }
      return prev;
    });

    if (evt === "INSERT" && belongsHere(nrow)) {
      if (nrow!.assigned_by === ceoId) setFlash((f) => ({ ...f, ceo: true }));
      if (nrow!.assigned_by === cooId) setFlash((f) => ({ ...f, coo: true }));
      setTimeout(() => setFlash({ ceo: false, coo: false }), 8000);
    }
  });

  // Filter only — no re-sort — so existing tasks keep their exact positions
  // even when priority / status changes.
  const filtered = useMemo(
    () => tasks.filter((t) => (priorityFilter === "all" || t.priority === priorityFilter) && (statusFilter === "all" || t.status === statusFilter)),
    [tasks, priorityFilter, statusFilter],
  );

  const ceoTasks = useMemo(() => filtered.filter((t) => t.assigned_by === ceoId), [filtered, ceoId]);
  const cooTasks = useMemo(() => filtered.filter((t) => t.assigned_by === cooId), [filtered, cooId]);

  // Split each column into active vs archive (done/cancelled).
  const isArchived = (t: Task) => t.status === "done" || t.status === "cancelled";
  const ceoActive = useMemo(() => ceoTasks.filter((t) => !isArchived(t)), [ceoTasks]);
  const ceoArchive = useMemo(() => ceoTasks.filter(isArchived), [ceoTasks]);
  const cooActive = useMemo(() => cooTasks.filter((t) => !isArchived(t)), [cooTasks]);
  const cooArchive = useMemo(() => cooTasks.filter(isArchived), [cooTasks]);



  if (!allowed) return null;

  return (
    <section
      dir={isAr ? "rtl" : "ltr"}
      aria-label={isAr ? "مهام الفريق" : "Team tasks"}
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
            <ClipboardList className="h-5 w-5 text-amber-300" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight text-amber-100 sm:text-lg">
              {isAr ? "مهامي مع الفريق" : "My tasks with the team"}
            </h2>
            <p className="truncate text-[11px] text-amber-100/60">
              {isAr ? "الإدارة العليا — متابعة مهام الفريق" : "Top management — team task follow-up"}
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
          tasks={ceoActive}
          archive={ceoArchive}
          loaded={loaded}
          flash={flash.ceo}
          onOpenTask={setOpenTaskId}
        />
        <LeaderColumn
          isAr={isAr}
          leader={COO}
          profile={cooProfile}
          tasks={cooActive}
          archive={cooArchive}
          loaded={loaded}
          flash={flash.coo}
          onOpenTask={setOpenTaskId}
        />

      </div>

      {/* Task notifications center — inside the leadership card */}
      <div className="relative mt-3">
        <TaskNotificationsCenter variant="compact" onOpenTask={setOpenTaskId} />
      </div>

      <TaskDetailDialog taskId={openTaskId} onClose={() => setOpenTaskId(null)} showOpenInPage />

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
  isAr, leader, profile, tasks, loaded, flash, onOpenTask,
}: {
  isAr: boolean;
  leader: typeof CEO;
  profile: { display_name: string | null; email: string | null; avatar_url: string | null; updated_at?: string | null } | null;
  tasks: Task[];
  loaded: boolean;
  flash: boolean;
  onOpenTask: (id: string) => void;
}) {
  const LeaderIcon = leader.Icon;
  const roleLabel = isAr ? leader.roleAr : leader.roleEn;
  const articleRef = useRef<HTMLElement | null>(null);
  // Version-tag the URL with the profile's updated_at so re-uploads to the
  // same storage path immediately break the previous cached bitmap.
  const versionedUrl = versioned(profile?.avatar_url ?? null, profile?.updated_at ?? null);
  rememberAvatar(leader.email, versionedUrl);
  return (
    <article
      ref={articleRef}
      aria-label={`${leader.short} — ${roleLabel}`}
      className={`leadership-column relative rounded-2xl bg-gradient-to-b from-neutral-950/70 to-black/50 p-3 ring-1 sm:p-4 transition-[box-shadow,ring-color] duration-700 ease-out ${
        flash ? "ring-2 ring-amber-300/70 shadow-[0_0_40px_-8px_rgba(233,199,126,0.55)]" : "ring-amber-400/20"
      }`}
    >
      {/* Leader header — grid keeps text container flexible on all widths */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 sm:gap-4">
        <LeaderAvatar
          url={versionedUrl}
          name={profile?.display_name ?? null}

          email={leader.email}
          size={224}
          prefetchRef={articleRef}
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
              <TaskRow key={t.id} task={t} isAr={isAr} onOpen={onOpenTask} />
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function TaskRow({ task, isAr, onOpen }: { task: Task; isAr: boolean; onOpen: (id: string) => void }) {
  const overdue = task.due_date && task.status !== "done" && new Date(task.due_date).getTime() < Date.now();
  const due = task.due_date
    ? new Date(task.due_date).toLocaleDateString(isAr ? "ar-EG" : "en-US", { month: "short", day: "numeric" })
    : null;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        aria-label={`${task.title}${task.due_date ? " — " + (isAr ? "الاستحقاق " : "due ") + new Date(task.due_date).toLocaleDateString(isAr ? "ar-EG" : "en-US") : ""}`}
        className={`group block w-full text-start rounded-lg bg-black/40 p-2.5 ring-1 transition hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
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
              {task.invoice_id && (
                <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                  <TaskInvoiceChip
                    invoiceId={task.invoice_id}
                    drCount={task.delivery_receipt_ids?.length ?? 0}
                    isAr={isAr}
                    size="xs"
                  />
                </span>
              )}
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
      </button>
    </li>
  );
}
