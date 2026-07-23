import { memo } from "react";
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
 *
 * Memoized + GPU-friendly (CSS keyframes only) so it doesn't force a repaint
 * of the virtualized message list on every render.
 */
function TypingIndicatorImpl({
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
    <span
      className="typing-dots inline-flex items-end gap-0.5 leading-none"
      aria-hidden
      style={{ contain: "strict", willChange: "transform" }}
    >
      <span className="typing-dot" />
      <span className="typing-dot" style={{ animationDelay: "150ms" }} />
      <span className="typing-dot" style={{ animationDelay: "300ms" }} />
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
      style={{ contain: "layout paint" }}
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

function sameTypers(a: Typer[], b: Typer[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].name !== b[i].name || a[i].avatarUrl !== b[i].avatarUrl) return false;
  }
  return true;
}

export const TypingIndicator = memo(TypingIndicatorImpl, (prev, next) =>
  prev.rtl === next.rtl &&
  prev.variant === next.variant &&
  prev.showAvatars === next.showAvatars &&
  prev.className === next.className &&
  sameTypers(prev.typers, next.typers)
);
