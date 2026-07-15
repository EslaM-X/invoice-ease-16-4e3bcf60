// Distinct color identity per product collection.
// Colors are resolved from the live registry (DB-backed collections table)
// so admins can add new collections at runtime.

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

// Convert #rrggbb → "r g b" for use with rgb(...) & rgba(...).
function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `${r} ${g} ${b}`;
}

// Perceived luminance to pick readable text on solid pill.
function isLight(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex).split(" ").map(Number);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.65;
}

export function collectionStyle(c?: string | null): Style {
  if (!c) return FALLBACK;
  const entry = getCollectionEntry(c);
  if (!entry) return FALLBACK;
  const rgb = hexToRgb(entry.color_hex);
  const textOnSolid = isLight(entry.color_hex) ? "#0b0b0b" : "#ffffff";
  return {
    solid: "shadow-sm",
    soft: "hover:brightness-110 transition",
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
