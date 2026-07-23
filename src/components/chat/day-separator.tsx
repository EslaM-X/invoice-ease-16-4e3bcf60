import { memo } from "react";
import { cn } from "@/lib/utils";

/**
 * WhatsApp-style day separator chip rendered inside the message list.
 * `compact` shrinks paddings for the sticky-overlay use case on mobile.
 */
function DaySeparatorImpl({
  label,
  className,
  compact = false,
}: {
  label: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      data-testid="chat-day-separator"
      className={cn(
        "flex justify-center select-none pointer-events-none",
        compact ? "py-0" : "py-1.5",
        className
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full",
          compact ? "px-2.5 py-[3px] text-[10.5px]" : "px-3 py-1 text-[11px] sm:text-[11px]",
          "font-semibold tracking-wide",
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

export const DaySeparator = memo(DaySeparatorImpl);
