import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type NoirTone = "gold" | "emerald" | "blue" | "amber" | "neutral" | "violet";

const toneMap: Record<NoirTone, { icon: string; text: string; glow: string; bar: string }> = {
  gold:    { icon: "bg-[#c9a84c]/12 text-[#c9a84c] border-[#c9a84c]/30", text: "text-[#f5e7b8]", glow: "bg-[#c9a84c]/12",  bar: "via-[#c9a84c]" },
  emerald: { icon: "bg-emerald-500/12 text-emerald-400 border-emerald-500/25", text: "text-emerald-300", glow: "bg-emerald-500/10", bar: "via-emerald-400/70" },
  blue:    { icon: "bg-sky-500/12 text-sky-400 border-sky-500/25",             text: "text-sky-300",     glow: "bg-sky-500/10",     bar: "via-sky-400/70" },
  amber:   { icon: "bg-amber-500/12 text-amber-400 border-amber-500/25",       text: "text-amber-300",   glow: "bg-amber-500/10",   bar: "via-amber-400/70" },
  violet:  { icon: "bg-violet-500/12 text-violet-300 border-violet-500/25",    text: "text-violet-200",  glow: "bg-violet-500/10",  bar: "via-violet-400/70" },
  neutral: { icon: "bg-white/5 text-white/70 border-white/10",                 text: "text-[#fdfcfb]",   glow: "bg-white/5",        bar: "via-white/40" },
};

export function NoirKpiCard({
  label,
  value,
  fullValue,
  subValue,
  Icon,
  tone = "neutral",
  hidden = false,
  loading = false,
  trailing,
}: {
  label: string;
  value: ReactNode;
  /** Exact/full value string used for tooltip + aria when `value` is compacted. */
  fullValue?: string;
  /** Optional secondary line (e.g. "≈ EGP 2,779,517.50" under a compact value). */
  subValue?: ReactNode;
  Icon: LucideIcon;
  tone?: NoirTone;
  hidden?: boolean;
  loading?: boolean;
  trailing?: ReactNode;
}) {
  const t = toneMap[tone];
  const ariaValue = hidden
    ? "hidden"
    : (fullValue ?? (typeof value === "string" || typeof value === "number" ? String(value) : undefined));
  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={ariaValue ? `${label}: ${ariaValue}` : label}
      title={!hidden ? fullValue : undefined}
      className="noir-kpi noir-glow noir-press noir-ripple focus-gold group relative overflow-hidden rounded-2xl border border-[#c9a84c]/20 bg-gradient-to-br from-[#161616] to-[#0d0d0d] p-4 shadow-xl shadow-black/40 hover:-translate-y-0.5 hover:border-[#c9a84c]/40 active:scale-[0.98] sm:p-5"
    >
      {/* animated shimmering top gold hairline */}
      <div aria-hidden="true" className="gold-hairline-live absolute inset-x-0 top-0" />
      {/* ambient glow (grows on hover) */}
      <div aria-hidden="true" className={`pointer-events-none absolute -bottom-14 left-1/2 h-24 w-40 -translate-x-1/2 rounded-full ${t.glow} blur-3xl opacity-40 transition-all duration-500 group-hover:opacity-90 group-hover:w-56 motion-reduce:transition-none`} />

      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/45 truncate sm:text-[11px]">{label}</div>
        </div>
        <div aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${t.icon} transition-transform duration-300 group-hover:scale-110`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>


      <div className="relative mt-4 flex items-end justify-between gap-2 sm:mt-6">
        {loading ? (
          <div aria-hidden="true" className="skeleton-noir h-8 w-20 rounded-md sm:h-10 sm:w-28" />
        ) : hidden ? (
          <div aria-hidden="true" className="flex items-center gap-1.5">
            {[0,1,2,3,4].map(i => (
              <span key={i} className="h-2.5 w-2.5 rounded-full bg-[#c9a84c]/60 shadow-[0_0_6px_rgba(201,168,76,0.5)]" />
            ))}
          </div>
        ) : (
          <div className="min-w-0 flex-1 overflow-hidden">
            <div
              className={`ltr-nums font-display font-bold tracking-tight tabular-nums leading-tight break-words transition-colors duration-300 ${t.text}`}
              style={{ fontSize: "clamp(1.35rem, 4.6vw, 1.875rem)" }}
            >
              {value}
            </div>
            {subValue && (
              <div className="ltr-nums mt-1.5 text-sm font-medium tabular-nums text-[#c9a84c]/75 truncate sm:text-[15px]">
                {subValue}
              </div>
            )}
          </div>
        )}
        {trailing}
      </div>

      {/* bottom gold sweep (slides in on hover) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-4 bottom-0 h-px origin-left scale-x-0 bg-gradient-to-r from-transparent via-[#c9a84c]/70 to-transparent transition-transform duration-500 group-hover:scale-x-100" />
    </div>
  );
}

