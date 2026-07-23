import { cn } from "@/lib/utils";

/**
 * WhatsApp-style day separator chip rendered inside the message list.
 * Passed the human label; the caller decides what date logic to run.
 */
export function DaySeparator({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      className={cn(
        "flex justify-center py-1.5 select-none pointer-events-none",
        className
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1",
          "text-[11px] font-semibold tracking-wide",
          "bg-black/55 text-white/95 backdrop-blur-md",
          "border border-[color:var(--brand-gold,#d4af37)]/35",
          "shadow-[0_6px_20px_-10px_rgba(0,0,0,0.6)]"
        )}
      >
        {label}
      </span>
    </div>
  );
}
