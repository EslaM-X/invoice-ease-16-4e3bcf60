export const DELIVERY_DAYS_OPTIONS = [7, 21, 30, 45, 60] as const;
export type DeliveryDays = (typeof DELIVERY_DAYS_OPTIONS)[number];

export function isValidDeliveryDays(n: unknown): n is DeliveryDays {
  return typeof n === "number" && (DELIVERY_DAYS_OPTIONS as readonly number[]).includes(n);
}

/**
 * Add N business days to a date. Treats Friday (5) and Saturday (6) as
 * weekend (Middle-East convention). Skips holidays only implicitly.
 */
export function addBusinessDays(from: Date | string, days: number): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 5 && dow !== 6) added++;
  }
  return d;
}

export function formatDeliveryWindowText(
  invoiceDate: Date | string,
  days: number,
  lang: "ar" | "en",
): { line: string; dateLabel: string; dueDate: Date } {
  const dueDate = addBusinessDays(invoiceDate, days);
  const dateLabel = dueDate.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const line =
    lang === "ar"
      ? `${days} يوم عمل من تاريخ الفاتورة`
      : `${days} business days from invoice date`;
  return { line, dateLabel, dueDate };
}
