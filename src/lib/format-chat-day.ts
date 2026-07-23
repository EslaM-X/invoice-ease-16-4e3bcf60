// Day-key + human label helpers for chat date separators.
// Uses the user's local timezone via toDateString().

export function chatDayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (!(d instanceof Date) || isNaN(d.getTime())) return "unknown";
  // YYYY-MM-DD in local tz
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * WhatsApp-style label: Today / Yesterday / weekday (within 6 days) / full date.
 * `locale` "ar" | "en" (fallback: system locale).
 */
export function formatChatDayLabel(iso: string | Date, locale: "ar" | "en" | undefined = undefined): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  const now = new Date();
  const today = startOfDay(now);
  const target = startOfDay(d);
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);
  const rtl = locale === "ar";
  const bcp = locale === "ar" ? "ar-EG" : locale === "en" ? "en-US" : undefined;
  if (diffDays === 0) return rtl ? "اليوم" : "Today";
  if (diffDays === 1) return rtl ? "أمس" : "Yesterday";
  if (diffDays > 1 && diffDays < 7) {
    return new Intl.DateTimeFormat(bcp, { weekday: "long" }).format(d);
  }
  // Older: e.g. 12 يوليو 2026 / July 12, 2026
  return new Intl.DateTimeFormat(bcp, { day: "numeric", month: "long", year: "numeric" }).format(d);
}
