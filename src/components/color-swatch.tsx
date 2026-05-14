import { swatchStyle } from "@/lib/color-swatch";
import { cn } from "@/lib/utils";

type Size = "xs" | "sm" | "md" | "lg";

const SIZES: Record<Size, string> = {
  xs: "h-3.5 w-3.5",
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

/**
 * iOS-style color swatch. Rounded squircle with subtle ring + inner highlight
 * + soft shadow so finishes (matte black, gunmetal, brushed gold, chrome)
 * render with depth and stay legible on light AND dark surfaces.
 */
export function ColorSwatch({
  value,
  size = "sm",
  className,
  title,
}: {
  value: string | null | undefined;
  size?: Size;
  className?: string;
  title?: string;
}) {
  return (
    <span
      aria-hidden
      title={title ?? value ?? undefined}
      className={cn(
        "inline-block flex-shrink-0 rounded-[6px] ring-1 ring-black/15 dark:ring-white/20",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(0,0,0,0.18),0_1px_2px_rgba(0,0,0,0.18)]",
        SIZES[size],
        className,
      )}
      style={swatchStyle(value)}
    />
  );
}
