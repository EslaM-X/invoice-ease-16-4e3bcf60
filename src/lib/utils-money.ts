// Numbers are ALWAYS shown in Latin (English) digits across the app,
// even when the UI language is Arabic. Only month/weekday names follow `lang`.
// We force `numberingSystem: "latn"` everywhere to guarantee 0-9 digits.

export function fmtMoney(n: number, currency = "EGP", lang: "ar" | "en" = "ar") {
  // Always render in English locale to avoid RTL marks (‏) and ج.م. wrapping issues.
  // Currency symbol stays consistent across both languages.
  void lang;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n || 0);
  } catch {
    return `${(n || 0).toFixed(2)} ${currency}`;
  }
}

/**
 * Adaptive money formatter — returns { short, full, compact }.
 * - `full` is always the exact currency-formatted number.
 * - When the absolute value is ≥ 1,000,000, `short` becomes a compact form
 *   (e.g. "EGP 2.78M", "EGP 1.23B") so KPI cards never clip on billions.
 *   Arabic UI gets localized suffixes: م (million), ب (billion), ت (trillion).
 * - `compact` is true when we actually shortened, so the caller can decide
 *   whether to show a muted "≈ full" underneath.
 */
export function fmtMoneyAdaptive(
  n: number,
  currency = "EGP",
  lang: "ar" | "en" = "ar",
): { short: string; full: string; compact: boolean } {
  const full = fmtMoney(n, currency, lang);
  const abs = Math.abs(Number(n) || 0);
  if (abs < 1_000_000) return { short: full, full, compact: false };

  // Always use Latin suffixes (K/M/B/T) regardless of UI language so
  // Arabic cards don't render "م/ب/ت" — user request.
  void lang;
  let val = n;
  let suf = "M";
  if (abs >= 1_000_000_000_000) { val = n / 1_000_000_000_000; suf = "T"; }
  else if (abs >= 1_000_000_000) { val = n / 1_000_000_000; suf = "B"; }
  else { val = n / 1_000_000; suf = "M"; }

  const num = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: val >= 100 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(val);
  return { short: `${currency} ${num}${suf}`, full, compact: true };
}

export function fmtNumber(n: number, _lang: "ar" | "en" = "ar") {
  // Always Latin digits, regardless of UI language.
  return new Intl.NumberFormat("en-US").format(n || 0);
}

export function fmtDate(d: string | Date, lang: "ar" | "en" = "ar") {
  const date = typeof d === "string" ? new Date(d) : d;
  const locale = (lang === "ar" ? "ar-EG" : "en-GB") + "-u-nu-latn";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/** Full date + weekday + precise time (HH:mm:ss) — Latin digits always */
export function fmtDateTime(d: string | Date, lang: "ar" | "en" = "ar") {
  const date = typeof d === "string" ? new Date(d) : d;
  const locale = (lang === "ar" ? "ar-EG" : "en-GB") + "-u-nu-latn";
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
