// Smart color swatch resolver.
// Maps human color/finish names (English + Arabic) to a CSS background that
// faithfully reproduces the look of the real finish — matte, polished, brushed,
// gunmetal, gold, bronze, etc. Falls back to the raw value if it already looks
// like a CSS color (e.g. "#abc", "rgb(...)", "red").

import type { CSSProperties } from "react";

type Swatch = {
  background: string;
  /** A second background layer for brushed / linear-grain finishes. */
  backgroundImage?: string;
  border?: string;
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g, "") // strip Arabic diacritics
    .replace(/\s+/g, " ")
    .trim();

// --- Real-finish presets (Awwwards-grade gradients) -----------------------

const POLISHED_CHROME: Swatch = {
  background:
    "linear-gradient(135deg, #f5f7fa 0%, #c4cdd5 18%, #ffffff 38%, #8a939c 55%, #e6ebf0 72%, #b3bcc4 100%)",
  border: "1px solid rgba(0,0,0,0.18)",
};

const BRUSHED_NICKEL: Swatch = {
  background: "linear-gradient(135deg, #d4d8dc 0%, #aeb5bb 50%, #cfd4d9 100%)",
  backgroundImage:
    "repeating-linear-gradient(90deg, rgba(255,255,255,0.35) 0 1px, rgba(0,0,0,0.08) 1px 2px), linear-gradient(135deg, #d4d8dc 0%, #aeb5bb 50%, #cfd4d9 100%)",
  border: "1px solid rgba(0,0,0,0.18)",
};

const BRUSHED_GOLD: Swatch = {
  background: "linear-gradient(135deg, #e8c97a 0%, #b58a3a 50%, #f0d488 100%)",
  backgroundImage:
    "repeating-linear-gradient(90deg, rgba(255,255,255,0.28) 0 1px, rgba(0,0,0,0.10) 1px 2px), linear-gradient(135deg, #e8c97a 0%, #b58a3a 50%, #f0d488 100%)",
  border: "1px solid rgba(120,80,10,0.35)",
};

const POLISHED_GOLD: Swatch = {
  background:
    "linear-gradient(135deg, #fbe6a2 0%, #c89a3a 25%, #ffe98a 50%, #a37820 75%, #f5d480 100%)",
  border: "1px solid rgba(120,80,10,0.4)",
};

const COFFEE_GOLD: Swatch = {
  background: "linear-gradient(135deg, #6e4a2a 0%, #a37345 50%, #c9925a 100%)",
  backgroundImage:
    "repeating-linear-gradient(90deg, rgba(255,255,255,0.18) 0 1px, rgba(0,0,0,0.18) 1px 2px), linear-gradient(135deg, #6e4a2a 0%, #a37345 50%, #c9925a 100%)",
  border: "1px solid rgba(60,30,10,0.5)",
};

const ROSE_GOLD: Swatch = {
  background:
    "linear-gradient(135deg, #f7d6c1 0%, #c98a73 50%, #f4cdb6 100%)",
  border: "1px solid rgba(120,60,40,0.35)",
};

const MATTE_BLACK: Swatch = {
  background: "#000000",
  border: "1px solid rgba(255,255,255,0.25)",
};

const GLOSS_BLACK: Swatch = {
  background:
    "radial-gradient(circle at 30% 25%, #4a4a4a 0%, #1a1a1a 45%, #050505 100%)",
  border: "1px solid rgba(255,255,255,0.2)",
};

const GUNMETAL: Swatch = {
  background: "linear-gradient(135deg, #3e4348 0%, #1f2226 55%, #4a5057 100%)",
  border: "1px solid rgba(255,255,255,0.15)",
};

const COPPER: Swatch = {
  background: "linear-gradient(135deg, #d98558 0%, #a05a2c 55%, #e9a378 100%)",
  border: "1px solid rgba(80,30,10,0.4)",
};

const BRONZE: Swatch = {
  background: "linear-gradient(135deg, #8a5a2e 0%, #5a3a1e 55%, #a87142 100%)",
  border: "1px solid rgba(60,30,10,0.45)",
};

const WHITE: Swatch = {
  background: "#fafafa",
  border: "1px solid rgba(0,0,0,0.25)",
};

// --- Name resolver --------------------------------------------------------

const KEYWORDS: Array<{ match: RegExp; swatch: Swatch }> = [
  // Black variants
  { match: /matte\s*black|mat\s*black|أسود\s*مطفي|أسود\s*مطفأ|اسود\s*مطفي/, swatch: MATTE_BLACK },
  { match: /gloss\s*black|glossy\s*black|piano\s*black|أسود\s*لامع|اسود\s*لامع/, swatch: GLOSS_BLACK },
  // Gunmetal
  { match: /metal\s*gun|gun\s*metal|gunmetal|رمادي\s*معدني/, swatch: GUNMETAL },
  // Gold variants — order matters: more specific first
  { match: /coffee\s*gold|قهوة|كوفي\s*جولد|بني\s*ذهبي/, swatch: COFFEE_GOLD },
  { match: /brushed\s*gold|ذهبي\s*مفرش|مفرش\s*ذهبي/, swatch: BRUSHED_GOLD },
  { match: /rose\s*gold|ذهبي\s*وردي|وردي\s*ذهبي/, swatch: ROSE_GOLD },
  { match: /polished\s*gold|gold|ذهبي|دهبي/, swatch: POLISHED_GOLD },
  // Silver / chrome / nickel
  { match: /brushed\s*nickel|brushed|نيكل\s*مفرش|مفرش/, swatch: BRUSHED_NICKEL },
  { match: /chrome\s*plated|chrome|polished|كروم|مصقول|بوليش/, swatch: POLISHED_CHROME },
  { match: /nickel|nikel|نيكل/, swatch: BRUSHED_NICKEL },
  // Copper / bronze
  { match: /copper|نحاس(?!\s*برون)/, swatch: COPPER },
  { match: /bronze|برونز|برونزي/, swatch: BRONZE },
  // White
  { match: /white|أبيض|ابيض/, swatch: WHITE },
];

const isCssColor = (s: string) => {
  const v = s.trim();
  if (!v) return false;
  if (/^#([0-9a-f]{3,8})$/i.test(v)) return true;
  if (/^(rgb|rgba|hsl|hsla|oklch|oklab|color)\s*\(/i.test(v)) return true;
  // a tiny set of well-known plain CSS colors used as raw values
  if (/^(red|blue|green|black|white|gray|grey|silver|gold|orange|purple|pink|yellow|brown|cyan|magenta|teal|navy|olive|maroon|lime|indigo|violet|coral|salmon|tan|beige|ivory|aqua|fuchsia|khaki|crimson)$/i.test(v)) return true;
  return false;
};

export function resolveSwatch(value: string | null | undefined): Swatch {
  if (!value) return { background: "transparent", border: "1px dashed rgba(0,0,0,0.25)" };
  const v = value.trim();
  if (isCssColor(v)) {
    return { background: v, border: "1px solid rgba(0,0,0,0.18)" };
  }
  const n = norm(v);
  for (const { match, swatch } of KEYWORDS) {
    if (match.test(n)) return swatch;
  }
  // Unknown: deterministic hash → muted swatch so it's still visible.
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 35% 55%), hsl(${hue} 35% 35%))`,
    border: "1px solid rgba(0,0,0,0.2)",
  };
}

/** Inline style suitable for a swatch dot/pill. */
export function swatchStyle(value: string | null | undefined): CSSProperties {
  const s = resolveSwatch(value);
  return {
    background: s.background,
    backgroundImage: s.backgroundImage,
    border: s.border,
  };
}
