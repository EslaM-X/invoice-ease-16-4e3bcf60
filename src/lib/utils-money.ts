export function fmtMoney(n: number, currency = "SAR", lang: "ar" | "en" = "ar") {
  try {
    return new Intl.NumberFormat(lang === "ar" ? "ar-SA" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n || 0);
  } catch {
    return `${(n || 0).toFixed(2)} ${currency}`;
  }
}

export function fmtNumber(n: number, lang: "ar" | "en" = "ar") {
  return new Intl.NumberFormat(lang === "ar" ? "ar-SA" : "en-US").format(n || 0);
}

export function fmtDate(d: string | Date, lang: "ar" | "en" = "ar") {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-SA" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}
