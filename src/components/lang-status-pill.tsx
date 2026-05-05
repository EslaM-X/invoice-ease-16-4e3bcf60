import { useI18n } from "@/lib/i18n";
import { Languages } from "lucide-react";

/**
 * Compact RTL/LTR + language indicator.
 * Click to toggle. Preference persisted via I18nProvider (localStorage "lang").
 */
export function LangStatusPill() {
  const { lang, setLang, dir } = useI18n();
  const next = lang === "ar" ? "en" : "ar";
  return (
    <button
      onClick={() => setLang(next)}
      title={dir === "rtl" ? "RTL · العربية — اضغط للتبديل" : "LTR · English — click to toggle"}
      className="hidden items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition hover:bg-accent sm:inline-flex"
      aria-label="language and direction"
    >
      <Languages className="h-3 w-3 text-primary" />
      <span className="text-foreground">{lang.toUpperCase()}</span>
      <span className="opacity-70">·</span>
      <span className={dir === "rtl" ? "text-primary" : "text-foreground"}>{dir.toUpperCase()}</span>
    </button>
  );
}
