import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveUser } from "@/lib/use-effective-user";
import { useI18n } from "@/lib/i18n";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
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
 * (realtime — reflects everywhere instantly).
 *
 * - Asks for confirmation before HIDING (with a clear "temporary + reversible" note).
 * - Restoring is instant, one click, no confirmation.
 */
export function CooHideToggle() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const effective = useEffectiveUser();
  const email = (effective.email ?? "").trim().toLowerCase();
  const isOwner = email === OWNER_EMAIL && !!effective.id;

  const [hidden, setHidden] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Live-load current value + subscribe to realtime updates so any other
  // device / tab reflects the same state without a page reload.
  useEffect(() => {
    if (!isOwner || !effective.id) return;
    let cancel = false;
    supabase
      .from("profiles")
      .select("hide_from_leadership_card")
      .eq("user_id", effective.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancel) setHidden(Boolean((data as any)?.hide_from_leadership_card));
      });

    const ch = supabase
      .channel(`coo-hide:${effective.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `user_id=eq.${effective.id}` },
        (payload: any) => {
          const next = Boolean(payload?.new?.hide_from_leadership_card);
          setHidden(next);
        },
      )
      .subscribe();

    return () => {
      cancel = true;
      supabase.removeChannel(ch);
    };
  }, [isOwner, effective.id]);

  if (!isOwner || hidden === null) return null;

  async function persist(next: boolean) {
    if (saving) return;
    setSaving(true);
    // Optimistic: flip immediately for instant feel.
    const prev = hidden;
    setHidden(next);
    const { error } = await supabase
      .from("profiles")
      .update({ hide_from_leadership_card: next })
      .eq("user_id", effective.id!);
    setSaving(false);
    if (error) {
      setHidden(prev);
      toast.error(isAr ? "تعذر الحفظ — حاول مرة أخرى" : "Could not save — try again");
      return;
    }
    toast.success(
      next
        ? (isAr ? "تم إخفاؤك مؤقتاً — تقدر ترجع بزرار واحد" : "Hidden temporarily — restore anytime with one click")
        : (isAr ? "رجعت للظهور في كارت المهام" : "You are visible in the tasks card again"),
    );
  }

  async function onPrimaryClick() {
    if (hidden) {
      // Restoring is instant — no confirmation.
      await persist(false);
    } else {
      // Ask before hiding.
      setConfirmOpen(true);
    }
  }

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="flex flex-wrap items-center justify-end gap-2">
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
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider ring-1 transition ${
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
        {hidden
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
