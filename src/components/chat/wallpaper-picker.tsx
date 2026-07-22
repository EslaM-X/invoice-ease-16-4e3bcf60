import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Palette, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type WallpaperPreset =
  | "noir"
  | "gold-dust"
  | "midnight"
  | "porcelain"
  | "emerald"
  | "sunset";

export const WALLPAPER_STYLES: Record<WallpaperPreset, string> = {
  noir:
    "bg-[linear-gradient(180deg,color-mix(in_oklab,var(--muted)_35%,transparent),color-mix(in_oklab,var(--background)_92%,transparent),color-mix(in_oklab,var(--muted)_25%,transparent))]",
  "gold-dust":
    "bg-[radial-gradient(circle_at_20%_10%,color-mix(in_oklab,var(--brand-gold,#d4af37)_18%,transparent),transparent_55%),radial-gradient(circle_at_80%_90%,color-mix(in_oklab,var(--brand-gold,#d4af37)_12%,transparent),transparent_50%),linear-gradient(180deg,var(--background),color-mix(in_oklab,var(--muted)_55%,transparent))]",
  midnight:
    "bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,#1e3a8a_30%,transparent),transparent_60%),linear-gradient(180deg,#0b0f1e,color-mix(in_oklab,#0b0f1e_90%,transparent))]",
  porcelain:
    "bg-[linear-gradient(180deg,#fafaf7,#f2ecdf)]",
  emerald:
    "bg-[radial-gradient(circle_at_10%_20%,color-mix(in_oklab,#059669_20%,transparent),transparent_55%),linear-gradient(180deg,color-mix(in_oklab,#022c22_88%,transparent),color-mix(in_oklab,#064e3b_75%,transparent))]",
  sunset:
    "bg-[radial-gradient(circle_at_90%_10%,color-mix(in_oklab,#f97316_25%,transparent),transparent_55%),radial-gradient(circle_at_10%_90%,color-mix(in_oklab,#db2777_22%,transparent),transparent_55%),linear-gradient(180deg,#1a0b13,#2a1119)]",
};

const PRESETS: Array<{ id: WallpaperPreset; label_ar: string; label_en: string; swatch: string }> = [
  { id: "noir", label_ar: "نوار كلاسيك", label_en: "Noir Classic", swatch: "linear-gradient(135deg,#1a1a1c,#2a2a2c)" },
  { id: "gold-dust", label_ar: "غبار ذهبي", label_en: "Gold Dust", swatch: "radial-gradient(circle at 30% 30%,#d4af37,#1a1a1c)" },
  { id: "midnight", label_ar: "منتصف الليل", label_en: "Midnight", swatch: "linear-gradient(135deg,#1e3a8a,#0b0f1e)" },
  { id: "porcelain", label_ar: "بورسلين", label_en: "Porcelain", swatch: "linear-gradient(135deg,#fafaf7,#e7dfc9)" },
  { id: "emerald", label_ar: "زمردي", label_en: "Emerald", swatch: "linear-gradient(135deg,#059669,#022c22)" },
  { id: "sunset", label_ar: "غروب", label_en: "Sunset", swatch: "linear-gradient(135deg,#f97316,#db2777)" },
];

export function WallpaperPicker({
  value, onChange, rtl,
}: {
  value: WallpaperPreset;
  onChange: (v: WallpaperPreset) => void;
  rtl: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full shrink-0" aria-label={rtl ? "خلفية الشات" : "Wallpaper"}>
          <Palette className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent dir={rtl ? "rtl" : "ltr"} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{rtl ? "خلفية المحادثة" : "Chat wallpaper"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onChange(p.id); setOpen(false); }}
              className={cn(
                "relative h-24 rounded-xl overflow-hidden ring-2 transition",
                value === p.id ? "ring-primary shadow-lg scale-[1.02]" : "ring-border hover:ring-primary/50"
              )}
              style={{ background: p.swatch }}
              aria-label={rtl ? p.label_ar : p.label_en}
            >
              {value === p.id && (
                <span className="absolute top-1.5 end-1.5 h-5 w-5 rounded-full bg-primary text-primary-foreground grid place-items-center">
                  <Check className="h-3 w-3" />
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 bg-black/50 text-white text-[10px] font-medium py-1 px-2 text-center">
                {rtl ? p.label_ar : p.label_en}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
