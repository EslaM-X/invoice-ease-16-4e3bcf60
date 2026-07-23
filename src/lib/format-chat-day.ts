// Day-key + human label helpers for chat date separators.
// Timezone-aware: uses the browser's resolved timezone by default so
// "Today"/"Yesterday" stays correct across DST and travel.

function resolveTz(tz?: string): string {
  if (tz) return tz;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// Format cache keyed by "tz|locale|shape" — Intl.DateTimeFormat is expensive
// and this helper is called for every message in the virtualized list.
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, locale: string | undefined, opts: Intl.DateTimeFormatOptions) {
  const key = `${tz}|${locale ?? ""}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: tz, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

const YMD = { year: "numeric", month: "2-digit", day: "2-digit" } as const;

/** YYYY-MM-DD in the target timezone (defaults to the user's tz). */
export function chatDayKey(iso: string | Date, tz?: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (!(d instanceof Date) || isNaN(d.getTime())) return "unknown";
  const zone = resolveTz(tz);
  // Use en-CA which gives us a YYYY-MM-DD ordering natively.
  const parts = fmt(zone, "en-CA", YMD).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

function diffDaysInTz(target: Date, now: Date, tz: string): number {
  // Compare pure day-keys to avoid DST off-by-one bugs.
  const a = chatDayKey(target, tz);
  const b = chatDayKey(now, tz);
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const utcA = Date.UTC(ay, am - 1, ad);
  const utcB = Date.UTC(by, bm - 1, bd);
  return Math.round((utcB - utcA) / 86_400_000);
}

/**
 * WhatsApp-style label: Today / Yesterday / weekday (within 6 days) / full date.
 * `locale` "ar" | "en" (fallback: system locale). `tz` overrides the timezone.
 */
export function formatChatDayLabel(
  iso: string | Date,
  locale: "ar" | "en" | undefined = undefined,
  tz?: string,
): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  const zone = resolveTz(tz);
  const diffDays = diffDaysInTz(d, new Date(), zone);
  const rtl = locale === "ar";
  const bcp = locale === "ar" ? "ar-EG" : locale === "en" ? "en-US" : undefined;
  if (diffDays === 0) return rtl ? "اليوم" : "Today";
  if (diffDays === 1) return rtl ? "أمس" : "Yesterday";
  if (diffDays > 1 && diffDays < 7) {
    return fmt(zone, bcp, { weekday: "long" }).format(d);
  }
  return fmt(zone, bcp, { day: "numeric", month: "long", year: "numeric" }).format(d);
}
