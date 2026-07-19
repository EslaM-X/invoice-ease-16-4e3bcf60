import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Eye, EyeOff, Loader2, RefreshCw, ShieldCheck, Sparkles, WifiOff } from "lucide-react";
import { toast } from "sonner";

const OWNER_EMAIL = "e.hesham@steinheim-eg.com";
const CACHE_PREFIX = "hide-job-title:";

/**
 * Owner-only Settings toggle: temporarily hides the user's job title
 * (e.g. "COO") from appearing anywhere in the app — every RoleBadge
 * checks profiles.hide_job_title and renders nothing while it's true.
 * One click restores everything instantly.
 *
 * Persistence is enforced by the prevent_hide_job_title_edit trigger:
 * only the owner (or an admin) can toggle their own flag.
 */
export function HideJobTitleToggle() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const email = (user?.email || "").trim().toLowerCase();
  const isOwner = email === OWNER_EMAIL && !!user?.id;
  const uid = user?.id ?? null;
  const cacheKey = uid ? `${CACHE_PREFIX}${uid}` : null;

  const [hidden, setHidden] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const mounted = useRef(true);
  const reloadSeq = useRef(0);
  const saveSeq = useRef(0);
  useEffect(() => () => { mounted.current = false; }, []);

  const reload = useCallback(async () => {
    if (!isOwner || !uid) return;
    const seq = ++reloadSeq.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    setSyncing(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("hide_job_title")
        .eq("user_id", uid)
        .abortSignal(controller.signal)
        .maybeSingle();
      if (error) throw error;
      if (!mounted.current || seq !== reloadSeq.current) return;
      const next = Boolean((data as any)?.hide_job_title);
      setHidden(next);
      if (cacheKey) { try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* ignore */ } }
      setSyncError(null);
    } catch {
      if (!mounted.current || seq !== reloadSeq.current) return;
      setSyncError(isAr ? "تعذر التزامن الآن — آخر اختيار محفوظ محلياً وسيُعاد التحقق تلقائياً" : "Sync delayed — last local choice is kept and will retry automatically");
    } finally {
      clearTimeout(timeout);
      if (mounted.current && seq === reloadSeq.current) setSyncing(false);
    }
  }, [isOwner, uid, cacheKey, isAr]);

  useEffect(() => {
    if (!isOwner || !uid) return;
    try {
      const raw = cacheKey ? localStorage.getItem(cacheKey) : null;
      if (raw === "true" || raw === "false") setHidden(raw === "true");
      else if (raw) setHidden(Boolean(JSON.parse(raw)));
    } catch { /* ignore */ }
    void reload();
  }, [isOwner, uid, cacheKey, reload]);

  useEffect(() => {
    if (!isOwner || !uid) return;
    const ch = supabase
      .channel(`hide-job-title:${uid}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `user_id=eq.${uid}` },
        (payload: any) => {
          if (!mounted.current) return;
          const next = Boolean(payload?.new?.hide_job_title);
          setHidden(next);
          setSyncError(null);
          setSaving(false);
          if (cacheKey) { try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* ignore */ } }
          try { window.dispatchEvent(new CustomEvent("app:resync", { detail: { table: "profiles", source: "hide-job-title" } })); } catch { /* ignore */ }
        },
      )
      .subscribe((status: string) => {
        if (!mounted.current) return;
        if (status === "SUBSCRIBED") {
          setSyncError(null);
          void reload();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setSyncError(isAr ? "انقطع التزامن اللحظي — يتم إعادة القراءة تلقائياً" : "Realtime sync interrupted — re-reading automatically");
          void reload();
        }
      });
    const onFocus = () => { void reload(); };
    const onOnline = () => { void reload(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      supabase.removeChannel(ch);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [isOwner, uid, cacheKey, reload, isAr]);

  if (!isOwner) return null;

  const persist = async (next: boolean) => {
    if (!uid) return;
    const seq = ++saveSeq.current;
    setSaving(true);
    setSyncError(null);
    const prev = hidden;
    setHidden(next);
    if (cacheKey) { try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* ignore */ } }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ hide_job_title: next })
        .eq("user_id", uid)
        .abortSignal(controller.signal);
      if (error) throw error;
      if (mounted.current && seq === saveSeq.current) {
        toast.success(
          next
            ? (isAr ? "تم إخفاء لقبك (COO) من كل التطبيق مؤقتاً" : "Your title (COO) is now hidden across the app")
            : (isAr ? "رجع لقبك يظهر في كل مكان" : "Your title is visible again everywhere"),
        );
        setSyncError(null);
        try { window.dispatchEvent(new CustomEvent("app:resync", { detail: { table: "profiles", source: "hide-job-title" } })); } catch { /* ignore */ }
      }
    } catch (e: any) {
      if (mounted.current && seq === saveSeq.current) {
        setHidden(prev);
        if (cacheKey) { try { localStorage.setItem(cacheKey, JSON.stringify(prev)); } catch { /* ignore */ } }
        const msg = e?.name === "AbortError"
          ? (isAr ? "الحفظ استغرق وقتاً أطول — لم يتم تعليق الزر وسيُعاد التحقق الآن" : "Save took too long — the button stayed available and will re-check now")
          : (e?.message || (isAr ? "فشل الحفظ" : "Save failed"));
        setSyncError(msg);
        toast.error(msg);
      }
      await reload();
    } finally {
      clearTimeout(timeout);
      if (mounted.current && seq === saveSeq.current) setSaving(false);
    }
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4 text-amber-500" />
            {isAr ? "إخفاء لقب COO مؤقتاً" : "Temporarily hide COO title"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {isAr
              ? "بيخفي كلمة COO الي بتظهر جمب اسمك في أي مكان في التطبيق (تعديلات، تعليقات، مهام، سجل التغييرات). التغيير محفوظ في حسابك، ولحظي، ورجوعه بضغطة زر واحدة."
              : "Hides the COO title next to your name everywhere in the app (edits, comments, tasks, activity log). Saved to your account, instant, and reversible with one click."}
          </p>
        </div>
        {hidden && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-900/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-100/80 ring-1 ring-amber-400/25 whitespace-nowrap">
            <EyeOff className="h-3 w-3" />
            {isAr ? "لقبك مخفي" : "Title hidden"}
          </span>
        )}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {syncError && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-red-700 ring-1 ring-red-400/30 dark:text-red-200" role="alert">
            <WifiOff className="h-3 w-3" />
            {syncError}
            <button type="button" onClick={() => void reload()} className="ms-1 inline-flex items-center gap-1 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] hover:bg-red-500/25">
              <RefreshCw className="h-3 w-3" />
              {isAr ? "إعادة" : "Retry"}
            </button>
          </span>
        )}
        {!syncError && (syncing || saving) && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-400/30 dark:text-emerald-200">
            <Loader2 className="h-3 w-3 animate-spin" />
            {saving ? (isAr ? "يتم الحفظ في الخلفية..." : "Saving in background...") : (isAr ? "مزامنة..." : "Syncing...")}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => void persist(!hidden)}
        aria-pressed={hidden}
        aria-busy={saving}
        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-bold uppercase tracking-wider ring-1 transition disabled:opacity-70 ${
          hidden
            ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-neutral-950 ring-emerald-300/50 shadow hover:brightness-110"
            : "bg-amber-500/15 text-amber-700 dark:text-amber-200 ring-amber-400/30 hover:bg-amber-500/25"
        }`}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : hidden ? <ShieldCheck className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        {hidden
          ? (isAr ? "إظهار لقبي COO في كل التطبيق الآن" : "Show my COO title everywhere now")
          : (isAr ? "إخفاء لقبي COO من كل التطبيق مؤقتاً" : "Hide my COO title across the app")}
      </button>
    </div>
  );
}
