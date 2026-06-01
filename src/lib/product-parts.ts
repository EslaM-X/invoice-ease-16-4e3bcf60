// Helpers for tracking multi-part products (mixers) inside delivery receipts.
// We piggyback on the existing `note` field on delivery_receipt_items by
// prefixing it with `[PART:<key>]` so we don't need any DB schema change.

export type PartKey = "full" | "mixer" | "trim";

export type MultiPartConfig = {
  /** Number of physical pieces that make up the full product. */
  totalParts: number;
  /** How many parts each PartKey contributes. */
  weights: Record<PartKey, number>;
};

// Keywords that identify the special multi-part faucet products.
const MULTI_PART_PATTERNS: RegExp[] = [
  /WALL\s*MOUNTED\s*TWO\s*HOLE\s*BASIN\s*MIXER/i,
  /CONCEALED\s*SHOWER/i,
  /SHOWER\s*MIXERS\s*CONCEALED/i,
  /FREE\s*STANDING\s*BATH\s*MIXER/i,
  /BATH\s*MIXERS\s*FREE\s*STANDING/i,
];

export function isMultiPartProduct(name: string | null | undefined): boolean {
  if (!name) return false;
  return MULTI_PART_PATTERNS.some((re) => re.test(name));
}

// For these products we consider 2 logical pieces:
//  - mixer: الجزء الدفن / concealed body
//  - trim:  الجزء الظاهر / external trim
//  - full:  both pieces together (counts as 2)
export const DEFAULT_CONFIG: MultiPartConfig = {
  totalParts: 2,
  weights: { full: 2, mixer: 1, trim: 1 },
};

export function partLabel(key: PartKey, isAr: boolean): string {
  if (isAr) {
    switch (key) {
      case "full": return "المنتج كامل";
      case "mixer": return "الخلاط الدفن فقط (MIXER)";
      case "trim": return "الجزء الظاهر فقط (بدون المكسر)";
    }
  }
  switch (key) {
    case "full": return "Full product";
    case "mixer": return "Concealed mixer only (MIXER)";
    case "trim": return "External trim only";
  }
}

const TAG_RE = /\[PART:(full|mixer|trim)\]/i;

export function parsePartFromNote(note: string | null | undefined): {
  part: PartKey;
  cleanNote: string;
} {
  const s = note ?? "";
  const m = s.match(TAG_RE);
  if (!m) return { part: "full", cleanNote: s };
  return { part: m[1].toLowerCase() as PartKey, cleanNote: s.replace(TAG_RE, "").trim() };
}

export function buildNoteWithPart(part: PartKey, userNote: string): string {
  const tag = `[PART:${part}]`;
  const txt = (userNote || "").trim();
  return txt ? `${tag} ${txt}` : tag;
}

/** For a row, given prior delivered notes (from other receipts), compute
 *  which parts are still pending — per unit. Returns an Arabic/English label
 *  listing remaining components, or empty string if nothing to flag. */
export function remainingPartsLabel(
  invoiceQty: number,
  priorNotes: Array<string | null>,
  isAr: boolean,
): string {
  const cfg = DEFAULT_CONFIG;
  const requiredUnits = invoiceQty * cfg.totalParts;
  let deliveredUnits = 0;
  let mixerCount = 0;
  let trimCount = 0;
  let fullCount = 0;
  for (const n of priorNotes) {
    const { part } = parsePartFromNote(n);
    deliveredUnits += cfg.weights[part];
    if (part === "mixer") mixerCount++;
    else if (part === "trim") trimCount++;
    else fullCount++;
  }
  const missing = requiredUnits - deliveredUnits;
  if (missing <= 0) return "";
  // Estimate which side is missing by comparing mixer vs trim parts already given out
  const mixersOut = mixerCount + fullCount;
  const trimsOut = trimCount + fullCount;
  const missingMixer = Math.max(0, invoiceQty - mixersOut);
  const missingTrim = Math.max(0, invoiceQty - trimsOut);
  const parts: string[] = [];
  if (missingMixer > 0) parts.push(isAr ? `الخلاط الدفن: ${missingMixer}` : `Mixer: ${missingMixer}`);
  if (missingTrim > 0) parts.push(isAr ? `الجزء الظاهر: ${missingTrim}` : `Trim: ${missingTrim}`);
  return parts.join(" • ");
}
