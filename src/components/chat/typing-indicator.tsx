import { cn } from "@/lib/utils";
import { LuxuryAvatar } from "@/components/chat/luxury-avatar";

export type Typer = { id: string; name: string; avatarUrl?: string | null };

/**
 * Smart, RTL-aware typing indicator.
 * - 1 typer  → "Ahmed is typing…"
 * - 2 typers → "Ahmed and Mohamed are typing…"
 * - 3 typers → "Ahmed, Mohamed and 1 more are typing…"
 * - 4+       → "Several people are typing…"
 *
 * variant="line" is the full row above the composer (with avatars).
 * variant="inline" is a compact string for headers / sidebar rows.
 */
export function TypingIndicator({
  typers,
  rtl,
  variant = "line",
  className,
  showAvatars = true,
}: {
  typers: Typer[];
  rtl: boolean;
  variant?: "line" | "inline";
  className?: string;
  showAvatars?: boolean;
}) {
  if (!typers || typers.length === 0) return null;
  const first = firstName(typers[0]?.name);
  const second = firstName(typers[1]?.name);
  const remaining = Math.max(0, typers.length - 2);

  let text = "";
  if (typers.length === 1) {
    text = rtl ? `${first} يكتب الآن…` : `${first} is typing…`;
  } else if (typers.length === 2) {
    text = rtl ? `${first} و${second} يكتبان الآن…` : `${first} and ${second} are typing…`;
  } else if (typers.length === 3) {
    text = rtl
      ? `${first}، ${second} و+${remaining} يكتبون الآن…`
      : `${first}, ${second} and ${remaining} more are typing…`;
  } else {
    text = rtl ? "عدة أعضاء يكتبون الآن…" : "Several people are typing…";
  }

  const dots = (
    <span className="inline-flex items-end gap-0.5 leading-none" aria-hidden>
      {[0, 150, 300].map((d) => (
        <span
          key={d}
          className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-bounce motion-reduce:opacity-70"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </span>
  );

  if (variant === "inline") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-primary italic truncate",
          className
        )}
        aria-live="polite"
      >
        {dots}
        <span className="truncate">{text}</span>
      </span>
    );
  }

  const shown = typers.slice(0, 3);
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs text-muted-foreground",
        className
      )}
      aria-live="polite"
    >
      {showAvatars && shown.length > 0 && (
        <div className={cn("flex", rtl ? "-space-x-reverse -space-x-2" : "-space-x-2")}>
          {shown.map((t) => (
            <LuxuryAvatar
              key={t.id}
              url={t.avatarUrl ?? null}
              name={t.name}
              size={22}
              ring="soft"
              showSkeleton={false}
              className="ring-2 ring-card"
            />
          ))}
        </div>
      )}
      <div
        className={cn(
          "inline-flex items-center gap-2 rounded-full px-2.5 py-1",
          "bg-black/40 text-white/90 backdrop-blur border border-[color:var(--brand-gold,#d4af37)]/25"
        )}
      >
        {dots}
        <span className="italic">{text}</span>
      </div>
    </div>
  );
}

function firstName(n?: string): string {
  if (!n) return "?";
  return n.trim().split(/\s+/)[0] || n.trim();
}
