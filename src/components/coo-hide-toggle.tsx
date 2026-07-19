import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveUser } from "@/lib/use-effective-user";
import { useI18n } from "@/lib/i18n";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

const OWNER_EMAIL = "e.hesham@steinheim-eg.com";

/**
 * Small owner-only toggle: hides / shows Eslam Hesham (COO) from the
 * Leadership Tasks card that appears on other executives' dashboards.
 * Only rendered for e.hesham@steinheim-eg.com.
 */
export function CooHideToggle() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const effective = useEffectiveUser();
  const email = (effective.email ?? "").trim().toLowerCase();
  const isOwner = email === OWNER_EMAIL && !!effective.id;

  const [hidden, setHidden] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

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
    return () => { cancel = true; };
  }, [isOwner, effective.id]);

  if (!isOwner || hidden === null) return null;

  async function toggle() {
    if (saving) return;
    setSaving(true);
    const next = !hidden;
    const { error } = await supabase
      .from("profiles")
      .update({ hide_from_leadership_card: next })
      .eq("user_id", effective.id!);
    setSaving(false);
    if (error) {
      toast.error(isAr ? "تعذر الحفظ" : "Could not save");
      return;
    }
    setHidden(next);
    toast.success(
      next
        ? (isAr ? "تم إخفاؤك من كارت المهام" : "You are now hidden from the tasks card")
        : (isAr ? "عدت للظهور في كارت المهام" : "You are visible in the tasks card again"),
    );
  }

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="flex justify-end">
      <button
        type="button"
        onClick={toggle}
        disabled={saving}
        aria-pressed={hidden}
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider ring-1 transition ${
          hidden
            ? "bg-neutral-900/70 text-amber-200 ring-amber-400/40 hover:bg-neutral-900"
            : "bg-amber-500/15 text-amber-200 ring-amber-400/30 hover:bg-amber-500/25"
        }`}
        title={
          hidden
            ? (isAr ? "أنت مخفي حالياً من كارت مهام القيادة — اضغط للعودة" : "You are hidden — click to reappear")
            : (isAr ? "إخفاؤك مؤقتاً من كارت مهام القيادة" : "Temporarily hide yourself from the leadership tasks card")
        }
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        {hidden
          ? (isAr ? "أنت مخفي من كارت المهام — إظهاري" : "Hidden from tasks card — show me")
          : (isAr ? "إخفائي مؤقتاً من كارت المهام" : "Hide me from tasks card")}
      </button>
    </div>
  );
}
