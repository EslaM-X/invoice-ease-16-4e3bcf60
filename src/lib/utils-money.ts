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
