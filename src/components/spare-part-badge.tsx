import { Wrench } from "lucide-react";

export type SparePartLike = {
  is_spare_part?: boolean | null;
  parent_product_id?: string | null;
};

/** Small inline "spare part" tag. Shows the parent product name when known. */
export function SparePartBadge({
  product,
  parentName,
  isAr,
  size = "sm",
}: {
  product: SparePartLike | null | undefined;
  parentName?: string | null;
  isAr: boolean;
  size?: "xs" | "sm";
}) {
  if (!product?.is_spare_part) return null;
  const cls =
    size === "xs"
      ? "text-[9px] px-1 py-0 gap-0.5"
      : "text-[10px] px-1.5 py-0.5 gap-1";
  return (
    <span
      title={parentName ? (isAr ? `قطعة غيار لـ ${parentName}` : `Spare part for ${parentName}`) : undefined}
      className={`inline-flex items-center rounded border border-orange-500/40 bg-orange-500/10 font-bold text-orange-700 dark:text-orange-300 ${cls}`}
    >
      <Wrench className="h-3 w-3" />
      {isAr ? "قطعة غيار" : "Spare"}
      {parentName ? <span className="font-normal opacity-80">· {parentName}</span> : null}
    </span>
  );
}
