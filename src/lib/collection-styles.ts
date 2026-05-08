// Distinct color identity per product collection.
// Used in filter chips, badges, and pickers across products & invoices.

export type CollectionKey = "JOY" | "UP" | "ART" | "QUATRO";

type Style = {
  // Solid (active filter pill / strong badge)
  solid: string;
  // Soft (inactive filter pill background)
  soft: string;
  // Badge (small pill on rows / picker)
  badge: string;
  // Dot indicator
  dot: string;
};

const STYLES: Record<CollectionKey, Style> = {
  JOY: {
    solid: "bg-rose-500 text-white shadow-sm shadow-rose-500/30",
    soft: "bg-rose-500/10 text-rose-600 dark:text-rose-300 hover:bg-rose-500/20",
    badge: "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300",
    dot: "bg-rose-500",
  },
  UP: {
    solid: "bg-sky-500 text-white shadow-sm shadow-sky-500/30",
    soft: "bg-sky-500/10 text-sky-600 dark:text-sky-300 hover:bg-sky-500/20",
    badge: "border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500",
  },
  ART: {
    solid: "bg-violet-500 text-white shadow-sm shadow-violet-500/30",
    soft: "bg-violet-500/10 text-violet-600 dark:text-violet-300 hover:bg-violet-500/20",
    badge: "border-violet-500/30 bg-violet-500/15 text-violet-700 dark:text-violet-300",
    dot: "bg-violet-500",
  },
  QUATRO: {
    solid: "bg-amber-500 text-white shadow-sm shadow-amber-500/30",
    soft: "bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20",
    badge: "border-amber-500/30 bg-amber-500/15 text-amber-800 dark:text-amber-300",
    dot: "bg-amber-500",
  },
};

const FALLBACK: Style = {
  solid: "bg-primary text-primary-foreground shadow",
  soft: "bg-muted hover:bg-muted/70 text-foreground",
  badge: "border-border bg-muted text-muted-foreground",
  dot: "bg-muted-foreground",
};

export function collectionStyle(c?: string | null): Style {
  if (!c) return FALLBACK;
  const key = c.toUpperCase() as CollectionKey;
  return STYLES[key] ?? FALLBACK;
}

export function collectionPillClass(c: string | null | undefined, active: boolean) {
  const s = collectionStyle(c);
  return active ? s.solid : s.soft;
}

export function collectionBadgeClass(c: string | null | undefined) {
  return collectionStyle(c).badge;
}

export function collectionDotClass(c: string | null | undefined) {
  return collectionStyle(c).dot;
}
