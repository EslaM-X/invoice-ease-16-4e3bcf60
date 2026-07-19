import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveUser } from "@/lib/use-effective-user";
import { useI18n } from "@/lib/i18n";
import { Eye, EyeOff, Loader2, RefreshCw, ShieldCheck, WifiOff } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const OWNER_EMAIL = "e.hesham@steinheim-eg.com";

/**
 * Owner-only toggle: hides / shows Eslam Hesham (COO) from the
 * Leadership Tasks card. Persists to profiles.hide_from_leadership_card
 * (RLS-enforced by the prevent_hide_from_leadership_card_edit trigger).
 *
 * Guarantees:
 * - Confirmation before HIDING (message: temporary, one-click reversible).
 * - Restoring is instant, one click, no confirmation.
 * - Loading indicator while (a) loading initial value, (b) saving.
 * - Realtime sync across tabs/devices. If the subscription fails or a save
 *   fails, the UI reverts, warns the user, and reloads the truth from the DB.
 */
export function CooHideToggle() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const effective = useEffectiveUser();
  const email = (effective.email ?? "").trim().toLowerCase();
  const isOwner = email === OWNER_EMAIL && !!effective.id;

  const [hidden, setHidden] = useState<boolean | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  // Authoritative reload from DB. Called on mount, on realtime failure,
  // on window focus / online events, and after any save failure so the
  // UI can never disagree with the persisted truth.
  const reload = useCallback(async () => {
    if (!isOwner || !effective.id) return;
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("hide_from_leadership_card")
        .eq("user_id", effective.id)
        .maybeSingle();
      if (!mountedRef.current) return;
      if (error) throw error;
      setHidden(Boolean((data as any)?.hide_from_leadership_card));
      setSyncError(null);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setSyncError(
        isAr
          ? "تعذر تحميل حالة الإخفاء من قاعدة البيانات"
          : "Could not load hide state from the database",
      );
    } finally {
      if (mountedRef.current) setInitialLoading(false);
    }
  }, [isOwner, effective.id, isAr]);

  // Initial load + auto-reverify on login change (effective.id updates on re-login).
  useEffect(() => {
    if (!isOwner || !effective.id) { setInitialLoading(false); return; }
    setInitialLoading(true);
    void reload();
  }, [isOwner, effective.id, reload]);

  // Realtime subscription with explicit status handling.
  // On CHANNEL_ERROR / TIMED_OUT / CLOSED we surface an inline warning and
  // fall back to a DB reload so the toggle never displays stale truth.
  useEffect(() => {
    if (!isOwner || !effective.id) return;
    const ch = supabase
      .channel(`coo-hide:${effective.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `user_id=eq.${effective.id}` },
        (payload: any) => {
          if (!mountedRef.current) return;
          setHidden(Boolean(payload?.new?.hide_from_leadership_card));
          setSyncError(null);
        },
      )
      .subscribe((status: string) => {
        if (!mountedRef.current) return;
        if (status === "SUBSCRIBED") {
          setSyncError(null);
          void reload(); // reconcile on (re)connect
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setSyncError(
            isAr
              ? "انقطع التزامن الفوري — يتم إعادة القراءة من قاعدة البيانات"
              : "Realtime sync interrupted — re-reading from the database",
          );
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
  }, [isOwner, effective.id, reload, isAr]);

  if (!isOwner) return null;

  async function persist(next: boolean) {
    if (saving || hidden === null) return;
    setSaving(true);
    const prev = hidden;
    // Optimistic: flip immediately for instant feel.
    setHidden(next);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ hide_from_leadership_card: next })
        .eq("user_id", effective.id!);
      if (error) throw error;
      if (mountedRef.current) {
        toast.success(
          next
            ? (isAr ? "تم إخفاؤك مؤقتاً — تقدر ترجع بزرار واحد" : "Hidden temporarily — restore anytime with one click")
            : (isAr ? "رجعت للظهور في كارت المهام" : "You are visible in the tasks card again"),
        );
      }
    } catch (e: any) {
      if (mountedRef.current) {
        setHidden(prev);
        const msg = e?.message?.includes("hide_from_leadership_card")
          ? (isAr ? "غير مسموح بتعديل هذا الإعداد" : "Not allowed to modify this setting")
          : (isAr ? "فشل الحفظ — يتم إعادة قراءة الحالة" : "Save failed — re-reading state");
        toast.error(msg);
        setSyncError(msg);
      }
      await reload();
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  async function onPrimaryClick() {
    if (hidden) {
      await persist(false); // instant restore — no confirmation
    } else {
      setConfirmOpen(true);
    }
  }

  // Initial loading skeleton — matches the pill shape.
  if (initialLoading || hidden === null) {
    return (
      <div dir={isAr ? "rtl" : "ltr"} className="flex justify-end">
        <div className="inline-flex items-center gap-2 rounded-full bg-neutral-900/50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-100/50 ring-1 ring-amber-400/20">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {isAr ? "جارٍ التحميل..." : "Loading..."}
        </div>
      </div>
    );
  }

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="flex flex-wrap items-center justify-end gap-2">
      {syncError && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-red-300 ring-1 ring-red-400/40"
          role="alert"
        >
          <WifiOff className="h-3 w-3" />
          {syncError}
          <button
            type="button"
            onClick={() => void reload()}
            className="ms-1 inline-flex items-center gap-1 rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-100 hover:bg-red-500/30"
            title={isAr ? "إعادة المحاولة" : "Retry"}
          >
            <RefreshCw className="h-3 w-3" />
            {isAr ? "إعادة" : "Retry"}
          </button>
        </span>
      )}

      {hidden && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-neutral-900/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-100/80 ring-1 ring-amber-400/25"
          aria-live="polite"
        >
          <EyeOff className="h-3 w-3" />
          {isAr ? "أنت مخفي مؤقتاً" : "You are hidden (temporary)"}
        </span>
      )}

      <button
        type="button"
        onClick={onPrimaryClick}
        disabled={saving}
        aria-pressed={hidden}
        aria-busy={saving}
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider ring-1 transition disabled:opacity-70 ${
          hidden
            ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-neutral-950 ring-emerald-300/50 shadow hover:brightness-110"
            : "bg-amber-500/15 text-amber-200 ring-amber-400/30 hover:bg-amber-500/25"
        }`}
        title={
          hidden
            ? (isAr ? "إظهاري فوراً في كارت مهام القيادة" : "Show me again in the leadership tasks card")
            : (isAr ? "إخفائي مؤقتاً من كارت مهام القيادة (يتم الحفظ في الحساب)" : "Temporarily hide me from the leadership tasks card (saved to your account)")
        }
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : hidden ? (
          <ShieldCheck className="h-3.5 w-3.5" />
        ) : (
          <Eye className="h-3.5 w-3.5" />
        )}
        {saving
          ? (isAr ? "جارٍ الحفظ..." : "Saving...")
          : hidden
          ? (isAr ? "تفعيل كارت المهام — إظهاري الآن" : "Re-activate tasks card — show me now")
          : (isAr ? "إخفائي مؤقتاً من كارت المهام" : "Hide me from tasks card")}
      </button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir={isAr ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isAr ? "تأكيد الإخفاء المؤقت" : "Confirm temporary hide"}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                {isAr
                  ? "هيتم إخفاء عمودك من كارت مهام القيادة عند باقي المسؤولين."
                  : "Your column will be hidden from the leadership tasks card for other executives."}
              </span>
              <span className="block font-semibold text-amber-600 dark:text-amber-300">
                {isAr
                  ? "التغيير مؤقت ومحفوظ في حسابك — تقدر ترجعه في أي وقت بزرار واحد من نفس المكان."
                  : "The change is temporary and saved to your account — you can restore it anytime with one click from the same place."}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isAr ? "إلغاء" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setConfirmOpen(false);
                void persist(true);
              }}
            >
              {isAr ? "إخفائي الآن" : "Hide me now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
