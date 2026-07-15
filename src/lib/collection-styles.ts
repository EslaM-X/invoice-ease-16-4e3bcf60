// Distinct color identity per product collection.
// Colors for the four seeded collections (JOY, UP, ART, QUATRO) keep their
// original Tailwind classes for backward compatibility with pages that
// don't yet pass inline styles. Custom collections added at runtime use
// inline styles derived from `color_hex` in the DB registry.

import { getCollectionEntry } from "@/lib/collection-registry";

export type CollectionKey = string;

type Style = {
  solid: string;
  soft: string;
  badge: string;
  dot: string;
  solidStyle?: React.CSSProperties;
  softStyle?: React.CSSProperties;
  badgeStyle?: React.CSSProperties;
  dotStyle?: React.CSSProperties;
};

const FALLBACK: Style = {
  solid: "bg-primary text-primary-foreground shadow",
  soft: "bg-muted hover:bg-muted/70 text-foreground",
  badge: "border-border bg-muted text-muted-foreground",
  dot: "bg-muted-foreground",
};

const SEEDED: Record<string, Style> = {
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

function hexToRgb(hex: string): string {
  const h = (hex || "#8b5cf6").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `${r} ${g} ${b}`;
}

function isLight(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex).split(" ").map(Number);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.65;
}

function dynamicStyle(hex: string): Style {
  const rgb = hexToRgb(hex);
  const textOnSolid = isLight(hex) ? "#0b0b0b" : "#ffffff";
  return {
    solid: "shadow-sm",
    soft: "transition hover:brightness-110",
    badge: "border",
    dot: "",
    solidStyle: {
      backgroundColor: `rgb(${rgb})`,
      color: textOnSolid,
      boxShadow: `0 1px 2px rgba(${rgb} / 0.35)`,
    },
    softStyle: {
      backgroundColor: `rgba(${rgb} / 0.12)`,
      color: `rgb(${rgb})`,
    },
    badgeStyle: {
      backgroundColor: `rgba(${rgb} / 0.15)`,
      color: `rgb(${rgb})`,
      borderColor: `rgba(${rgb} / 0.35)`,
    },
    dotStyle: {
      backgroundColor: `rgb(${rgb})`,
    },
  };
}

export function collectionStyle(c?: string | null): Style {
  if (!c) return FALLBACK;
  const key = c.toUpperCase();
  if (SEEDED[key]) return SEEDED[key];
  const entry = getCollectionEntry(key);
  if (entry) return dynamicStyle(entry.color_hex);
  return FALLBACK;
}

export function collectionPillClass(c: string | null | undefined, active: boolean) {
  const s = collectionStyle(c);
  return active ? s.solid : s.soft;
}
export function collectionPillStyle(c: string | null | undefined, active: boolean): React.CSSProperties | undefined {
  const s = collectionStyle(c);
  return active ? s.solidStyle : s.softStyle;
}
export function collectionBadgeClass(c: string | null | undefined) {
  return collectionStyle(c).badge;
}
export function collectionBadgeStyle(c: string | null | undefined): React.CSSProperties | undefined {
  return collectionStyle(c).badgeStyle;
}
export function collectionDotClass(c: string | null | undefined) {
  return collectionStyle(c).dot;
}
export function collectionDotStyle(c: string | null | undefined): React.CSSProperties | undefined {
  return collectionStyle(c).dotStyle;
}
