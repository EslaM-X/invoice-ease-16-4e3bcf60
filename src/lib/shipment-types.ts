// Shared metadata for the 3 shipment kinds used by POs and their receipts.
// G = Grounded (sea), A = Air, D = Door-to-Door.
//
// Use these helpers anywhere you render a PO, a receipt batch, or a
// dashboard tile so the look (color, icon, label, gradient) stays consistent.

import { Ship, Plane, Truck, type LucideIcon } from "lucide-react";

export type ShipmentType = "grounded" | "air" | "door_to_door";

export const SHIPMENT_TYPES: ShipmentType[] = ["grounded", "air", "door_to_door"];

export type ShipmentMeta = {
  type: ShipmentType;
  prefix: "G" | "A" | "D";
  icon: LucideIcon;
  /** Localized full name. */
  label: (isAr: boolean) => string;
  /** Short tag like "بحري" / "Sea". */
  shortLabel: (isAr: boolean) => string;
  /** Brief description shown under the picker card. */
  description: (isAr: boolean) => string;
  /** Tailwind classes for solid colored chip / badge. */
  chipClass: string;
  /** Tailwind classes for soft tinted surface (cards, rows). */
  surfaceClass: string;
  /** Tailwind classes for the icon + text accent color. */
  accentTextClass: string;
  /** Tailwind class for a hex-like dot used in legends. */
  dotClass: string;
  /** Tailwind ring color used when a picker card is selected. */
  ringSelectedClass: string;
};

const META: Record<ShipmentType, ShipmentMeta> = {
  grounded: {
    type: "grounded",
    prefix: "G",
    icon: Ship,
    label: (ar) => (ar ? "شحن بري (GROUNDED)" : "Grounded (Land)"),
    shortLabel: (ar) => (ar ? "بري" : "Land"),
    description: (ar) =>
      ar
        ? "الشحن البري الرئيسي. يبدأ بالحرف G ويأخذ ترقيمًا تلقائيًا (G1, G2, …)."
        : "Main overland freight. Auto-numbered with G prefix (G1, G2, …).",
    chipClass: "bg-amber-600 text-white border-amber-600",
    surfaceClass: "bg-amber-500/10 border-amber-500/30",
    accentTextClass: "text-amber-700 dark:text-amber-400",
    dotClass: "bg-amber-500",
    ringSelectedClass: "ring-amber-500/60 border-amber-500",
  },
  air: {
    type: "air",
    prefix: "A",
    icon: Plane,
    label: (ar) => (ar ? "شحن جوي (AIR)" : "Air freight"),
    shortLabel: (ar) => (ar ? "طيران" : "Air"),
    description: (ar) =>
      ar
        ? "شحن سريع عبر الطيران. يبدأ بالحرف A وترقيمه مستقل (A1, A2, …)."
        : "Fast air freight. Auto-numbered with A prefix (A1, A2, …).",
    chipClass: "bg-sky-600 text-white border-sky-600",
    surfaceClass: "bg-sky-500/10 border-sky-500/30",
    accentTextClass: "text-sky-700 dark:text-sky-400",
    dotClass: "bg-sky-500",
    ringSelectedClass: "ring-sky-500/60 border-sky-500",
  },
  door_to_door: {
    type: "door_to_door",
    prefix: "D",
    icon: Truck,
    label: (ar) => (ar ? "من الباب للباب (D2D)" : "Door to Door (D2D)"),
    shortLabel: () => "D2D",
    description: (ar) =>
      ar
        ? "خدمة من المورد لباب المخزن. يبدأ بالحرف D (D1, D2, …)."
        : "Supplier-to-door service. Auto-numbered with D prefix (D1, D2, …).",
    chipClass: "bg-violet-600 text-white border-violet-600",
    surfaceClass: "bg-violet-500/10 border-violet-500/30",
    accentTextClass: "text-violet-700 dark:text-violet-400",
    dotClass: "bg-violet-500",
    ringSelectedClass: "ring-violet-500/60 border-violet-500",
  },
};

export function shipmentMeta(type: string | null | undefined): ShipmentMeta {
  if (type && (type in META)) return META[type as ShipmentType];
  return META.grounded;
}

/** Build the display code for a partial-receipt batch from a PO. */
export function receiptDisplayCode(
  shipmentCode: string | null | undefined,
  receiptNumber: number | null | undefined,
  receiptCodeFromDb?: string | null,
) {
  if (receiptCodeFromDb && receiptCodeFromDb.trim().length > 0) return receiptCodeFromDb;
  const base = shipmentCode && shipmentCode.trim().length > 0 ? shipmentCode : "PO";
  return `${base}#${receiptNumber ?? 1}`;
}
