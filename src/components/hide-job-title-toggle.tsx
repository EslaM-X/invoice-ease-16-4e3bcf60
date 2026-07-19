import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Eye, EyeOff, Loader2, ShieldCheck, Sparkles } from "lucide-react";
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

  const [hidden, setHidden] = useState<boolean>(() => {
    try {
      const raw = typeof localStorage !== "undefined" && cacheKey ? localStorage.getItem(cacheKey) : null;
      return raw === "true";
    } catch { return false; }
  });
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const reload = useCallback(async () => {
    if (!isOwner || !uid) return;
    const { data } = await supabase
      .from("profiles")
      .select("hide_job_title")
      .eq("user_id", uid)
      .maybeSingle();
    if (!mounted.current) return;
    const next = Boolean((data as any)?.hide_job_title);
    setHidden(next);
    if (cacheKey) { try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* ignore */ } }
  }, [isOwner, uid, cacheKey]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!isOwner || !uid) return;
    const ch = supabase
      .channel(`hide-job-title:${uid}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `user_id=eq.${uid}` },
        (payload: any) => {
          if (!mounted.current) return;
          const next = Boolean(payload?.new?.hide_job_title);
          setHidden(next);
          if (cacheKey) { try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* ignore */ } }
        },
      )
      .subscribe();
    const onFocus = () => { void reload(); };
    window.addEventListener("focus", onFocus);
    return () => {
      supabase.removeChannel(ch);
      window.removeEventListener("focus", onFocus);
    };
  }, [isOwner, uid, cacheKey, reload]);

  if (!isOwner) return null;

  const persist = async (next: boolean) => {
    if (saving || !uid) return;
    setSaving(true);
    const prev = hidden;
    setHidden(next);
    if (cacheKey) { try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* ignore */ } }
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ hide_job_title: next })
        .eq("user_id", uid);
      if (error) throw error;
      if (mounted.current) {
        toast.success(
          next
            ? (isAr ? "تم إخفاء لقبك (COO) من كل التطبيق مؤقتاً" : "Your title (COO) is now hidden across the app")
            : (isAr ? "رجع لقبك يظهر في كل مكان" : "Your title is visible again everywhere"),
        );
      }
    } catch (e: any) {
      if (mounted.current) {
        setHidden(prev);
        if (cacheKey) { try { localStorage.setItem(cacheKey, JSON.stringify(prev)); } catch { /* ignore */ } }
        toast.error(e?.message || (isAr ? "فشل الحفظ" : "Save failed"));
      }
      await reload();
    } finally {
      if (mounted.current) setSaving(false);
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
      <button
        type="button"
        onClick={() => void persist(!hidden)}
        disabled={saving}
        aria-pressed={hidden}
        aria-busy={saving}
        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-bold uppercase tracking-wider ring-1 transition disabled:opacity-70 ${
          hidden
            ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-neutral-950 ring-emerald-300/50 shadow hover:brightness-110"
            : "bg-amber-500/15 text-amber-700 dark:text-amber-200 ring-amber-400/30 hover:bg-amber-500/25"
        }`}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : hidden ? <ShieldCheck className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        {saving
          ? (isAr ? "جارٍ الحفظ..." : "Saving...")
          : hidden
            ? (isAr ? "إظهار لقبي COO في كل التطبيق الآن" : "Show my COO title everywhere now")
            : (isAr ? "إخفاء لقبي COO من كل التطبيق مؤقتاً" : "Hide my COO title across the app")}
      </button>
    </div>
  );
}
