import { BadgePercent } from "lucide-react";

/**
 * Smart "VAT inclusive" badge.
 * Renders nothing when the invoice has no tax enabled — purely presentational,
 * it never mutates invoices or delivery receipts.
 */
export function VatBadge({
  taxEnabled,
  taxRate,
  isAr,
  variant = "chip",
  className = "",
}: {
  taxEnabled: boolean | null | undefined;
  taxRate?: number | null;
  isAr: boolean;
  /** `chip` for lists/UI, `print` for the printable invoice document. */
  variant?: "chip" | "print";
  className?: string;
}) {
  if (taxEnabled !== true) return null;
  const rate = Math.round((Number(taxRate ?? 0.14) || 0.14) * 100);

  if (variant === "print") {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-md border border-gray-500 px-3 py-1 text-[11px] font-semibold text-black ${className}`}
        dir={isAr ? "rtl" : "ltr"}
      >
        <BadgePercent className="h-3.5 w-3.5" />
        <span>
          {isAr ? `شامل ضريبة القيمة المضافة ${rate}%` : `VAT Inclusive (${rate}%)`}
        </span>
      </div>
    );
  }

  return (
    <span
      title={isAr ? "هذه الفاتورة شاملة ضريبة القيمة المضافة" : "This invoice is VAT inclusive"}
      className={`inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400 ${className}`}
    >
      <BadgePercent className="h-3 w-3" />
      {isAr ? `شامل الضريبة ${rate}%` : `VAT ${rate}%`}
    </span>
  );
}
