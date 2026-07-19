import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { CheckCircle2, AlertTriangle, Radio, RefreshCw, Clock, Monitor, Loader2 } from "lucide-react";

const OWNER_EMAIL = "e.hesham@steinheim-eg.com";
const CACHE_PREFIX = "hide-job-title:";

type ChannelStatus = "connecting" | "live" | "error" | "closed";

function shortId() {
  try {
    const buf = new Uint8Array(4);
    crypto.getRandomValues(buf);
    return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

/**
 * Owner-only verification panel. Shows the live saved value from the DB,
 * whether it matches the locally cached UI state, the realtime channel
 * status, the last time the value changed, and a session tag — so the
 * owner can open a second account/tab and confirm changes propagate
 * instantly without any manual refresh.
 */
export function HideJobTitleVerifier() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const email = (user?.email || "").trim().toLowerCase();
  const isOwner = email === OWNER_EMAIL && !!user?.id;
  const uid = user?.id ?? null;
  const cacheKey = uid ? `${CACHE_PREFIX}${uid}` : null;

  const [dbValue, setDbValue] = useState<boolean | null>(null);
  const [localValue, setLocalValue] = useState<boolean | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [channelStatus, setChannelStatus] = useState<ChannelStatus>("connecting");
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionTag = useRef(shortId());
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const readLocal = useCallback(() => {
    if (!cacheKey) { setLocalValue(null); return; }
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw === "true" || raw === "false") setLocalValue(raw === "true");
      else if (raw) setLocalValue(Boolean(JSON.parse(raw)));
      else setLocalValue(null);
    } catch { setLocalValue(null); }
  }, [cacheKey]);

  const reload = useCallback(async () => {
    if (!isOwner || !uid) return;
    setFetching(true);
    try {
      const { data, error: err } = await supabase
        .from("profiles")
        .select("hide_job_title, updated_at")
        .eq("user_id", uid)
        .maybeSingle();
      if (err) throw err;
      if (!mounted.current) return;
      setDbValue(Boolean((data as any)?.hide_job_title));
      setUpdatedAt(((data as any)?.updated_at as string) ?? null);
      setError(null);
    } catch (e: any) {
      if (!mounted.current) return;
      setError(e?.message ?? (isAr ? "تعذر قراءة الحالة" : "Read failed"));
    } finally {
      if (mounted.current) setFetching(false);
      readLocal();
    }
  }, [isOwner, uid, isAr, readLocal]);

  useEffect(() => {
    if (!isOwner || !uid) return;
    void reload();
    const ch = supabase
      .channel(`hide-job-title-verifier:${uid}-${sessionTag.current}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `user_id=eq.${uid}` },
        (payload: any) => {
          if (!mounted.current) return;
          setDbValue(Boolean(payload?.new?.hide_job_title));
          setUpdatedAt((payload?.new?.updated_at as string) ?? new Date().toISOString());
          setLastEventAt(new Date());
          setError(null);
          readLocal();
        },
      )
      .subscribe((status: string) => {
        if (!mounted.current) return;
        if (status === "SUBSCRIBED") setChannelStatus("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setChannelStatus("error");
        else if (status === "CLOSED") setChannelStatus("closed");
        else setChannelStatus("connecting");
      });
    const onStorage = (e: StorageEvent) => { if (e.key === cacheKey) readLocal(); };
    const onResync = () => { readLocal(); void reload(); };
    const onFocus = () => { void reload(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("app:resync", onResync as EventListener);
    window.addEventListener("focus", onFocus);
    return () => {
      supabase.removeChannel(ch);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("app:resync", onResync as EventListener);
      window.removeEventListener("focus", onFocus);
    };
  }, [isOwner, uid, cacheKey, reload, readLocal]);

  if (!isOwner) return null;

  const inSync = dbValue !== null && (localValue === null || localValue === dbValue);
  const fmt = (d: Date | string | null) => {
    if (!d) return "—";
    try { return new Date(d).toLocaleTimeString(isAr ? "ar-EG" : "en-US", { hour12: false }); }
    catch { return "—"; }
  };

  const statusChip = (() => {
    if (channelStatus === "live") {
      return { icon: <Radio className="h-3 w-3" />, cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 ring-emerald-400/30", label: isAr ? "التزامن اللحظي فعّال" : "Realtime live" };
    }
    if (channelStatus === "connecting") {
      return { icon: <Loader2 className="h-3 w-3 animate-spin" />, cls: "bg-amber-500/10 text-amber-700 dark:text-amber-200 ring-amber-400/30", label: isAr ? "جارٍ الاتصال..." : "Connecting..." };
    }
    return { icon: <AlertTriangle className="h-3 w-3" />, cls: "bg-red-500/10 text-red-700 dark:text-red-200 ring-red-400/30", label: isAr ? "انقطع التزامن — سيُعاد المحاولة" : "Realtime interrupted — retrying" };
  })();

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            {isAr ? "تحقق من التزامن عبر الحسابات والجلسات" : "Cross-account & multi-session sync verifier"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {isAr
              ? "افتح حساب آخر أو جلسة ثانية، بدّل الإعداد من أي مكان، وشوف القيمة تتحدث هنا لحظياً بدون تحديث يدوي."
              : "Open a second account or session, toggle the setting anywhere, and watch this panel update instantly with no manual refresh."}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ring-1 whitespace-nowrap ${statusChip.cls}`}>
          {statusChip.icon}
          {statusChip.label}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border bg-background/40 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {isAr ? "آخر حالة محفوظة في قاعدة البيانات" : "Last saved DB value"}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`inline-flex h-6 min-w-14 items-center justify-center rounded-full px-2 text-[11px] font-bold ring-1 ${
              dbValue === null ? "bg-neutral-500/10 text-muted-foreground ring-neutral-400/30"
                : dbValue ? "bg-neutral-900/70 text-amber-100/90 ring-amber-400/25"
                : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 ring-emerald-400/30"
            }`}>
              {dbValue === null ? "—" : dbValue ? (isAr ? "مخفي" : "Hidden") : (isAr ? "ظاهر" : "Visible")}
            </span>
            <button type="button" onClick={() => void reload()} className="ms-auto inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] hover:bg-muted">
              {fetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {isAr ? "تحديث" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="rounded-xl border bg-background/40 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {isAr ? "حالة الواجهة (هذه الجلسة)" : "UI state (this session)"}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`inline-flex h-6 min-w-14 items-center justify-center rounded-full px-2 text-[11px] font-bold ring-1 ${
              localValue === null ? "bg-neutral-500/10 text-muted-foreground ring-neutral-400/30"
                : localValue ? "bg-neutral-900/70 text-amber-100/90 ring-amber-400/25"
                : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 ring-emerald-400/30"
            }`}>
              {localValue === null ? "—" : localValue ? (isAr ? "مخفي" : "Hidden") : (isAr ? "ظاهر" : "Visible")}
            </span>
            <span className={`ms-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${
              inSync ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 ring-emerald-400/30"
                : "bg-amber-500/10 text-amber-800 dark:text-amber-200 ring-amber-400/30"
            }`}>
              {inSync ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              {inSync ? (isAr ? "متزامن" : "In sync") : (isAr ? "غير متزامن" : "Out of sync")}
            </span>
          </div>
        </div>

        <div className="rounded-xl border bg-background/40 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {isAr ? "آخر تحديث لحظي" : "Last realtime update"}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px]">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono">{fmt(lastEventAt)}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{isAr ? "محفوظ:" : "saved:"}</span>
            <span className="font-mono">{fmt(updatedAt)}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Monitor className="h-3 w-3" />
            {isAr ? "معرّف الجلسة:" : "Session tag:"} <span className="font-mono">{sessionTag.current}</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-700 ring-1 ring-red-400/30 dark:text-red-200" role="alert">
          {error}
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        {isAr
          ? "طريقة الاختبار: سجّل دخول بحساب آخر في نافذة/جهاز ثاني، غيّر الإعداد من صفحة الإعدادات، والقيمة هنا هتتغير خلال ثانية بدون ما تعمل أي تحديث."
          : "How to test: sign in with another account in a second window/device, flip the setting from its Settings page, and this panel updates within a second — no manual refresh."}
      </p>
    </div>
  );
}
