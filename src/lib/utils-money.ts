export function fmtMoney(n: number, currency = "EGP", lang: "ar" | "en" = "ar") {
  try {
    return new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-EG", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n || 0);
  } catch {
    return `${(n || 0).toFixed(2)} ${currency}`;
  }
}

export function fmtNumber(n: number, lang: "ar" | "en" = "ar") {
  return new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US").format(n || 0);
}

export function fmtDate(d: string | Date, lang: "ar" | "en" = "ar") {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/** Full date + weekday + precise time (HH:mm:ss) */
export function fmtDateTime(d: string | Date, lang: "ar" | "en" = "ar") {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
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
