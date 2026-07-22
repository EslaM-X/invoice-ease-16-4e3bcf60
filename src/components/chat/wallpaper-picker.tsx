import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Palette, Check, Upload, Trash2, Loader2, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ImageCropperDialog } from "@/components/chat/image-cropper";


export type WallpaperPreset =
  | "noir"
  | "gold-dust"
  | "midnight"
  | "porcelain"
  | "emerald"
  | "sunset"
  | "aurora"
  | "royal"
  | "sahara";

export type WallpaperValue =
  | { type: "preset"; preset: WallpaperPreset }
  | { type: "custom"; path: string };

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
  aurora:
    "bg-[radial-gradient(circle_at_20%_20%,color-mix(in_oklab,#22d3ee_20%,transparent),transparent_55%),radial-gradient(circle_at_80%_80%,color-mix(in_oklab,#a855f7_22%,transparent),transparent_55%),linear-gradient(180deg,#0a0a1a,#0f172a)]",
  royal:
    "bg-[radial-gradient(circle_at_50%_10%,color-mix(in_oklab,#7c3aed_25%,transparent),transparent_60%),linear-gradient(180deg,#120826,#1e1140)]",
  sahara:
    "bg-[radial-gradient(circle_at_20%_10%,color-mix(in_oklab,#eab308_22%,transparent),transparent_55%),linear-gradient(180deg,#2a1a0a,#3d2515)]",
};

const PRESETS: Array<{ id: WallpaperPreset; label_ar: string; label_en: string; swatch: string }> = [
  { id: "noir", label_ar: "نوار", label_en: "Noir", swatch: "linear-gradient(135deg,#1a1a1c,#2a2a2c)" },
  { id: "gold-dust", label_ar: "غبار ذهبي", label_en: "Gold Dust", swatch: "radial-gradient(circle at 30% 30%,#d4af37,#1a1a1c)" },
  { id: "midnight", label_ar: "منتصف الليل", label_en: "Midnight", swatch: "linear-gradient(135deg,#1e3a8a,#0b0f1e)" },
  { id: "porcelain", label_ar: "بورسلين", label_en: "Porcelain", swatch: "linear-gradient(135deg,#fafaf7,#e7dfc9)" },
  { id: "emerald", label_ar: "زمردي", label_en: "Emerald", swatch: "linear-gradient(135deg,#059669,#022c22)" },
  { id: "sunset", label_ar: "غروب", label_en: "Sunset", swatch: "linear-gradient(135deg,#f97316,#db2777)" },
  { id: "aurora", label_ar: "شفق", label_en: "Aurora", swatch: "linear-gradient(135deg,#22d3ee,#a855f7)" },
  { id: "royal", label_ar: "ملكي", label_en: "Royal", swatch: "linear-gradient(135deg,#7c3aed,#120826)" },
  { id: "sahara", label_ar: "صحراء", label_en: "Sahara", swatch: "linear-gradient(135deg,#eab308,#2a1a0a)" },
];

export function WallpaperPicker({
  value, customUrl, onSelectPreset, onUploadCustom, onClearCustom,
  applyPerRoom, onTogglePerRoom, hasRoomOverride, onResetToDefault,
  rtl, userId,
}: {
  value: WallpaperValue;
  customUrl?: string | null;
  onSelectPreset: (p: WallpaperPreset) => Promise<void> | void;
  onUploadCustom: (path: string) => Promise<void> | void;
  onClearCustom: () => Promise<void> | void;
  applyPerRoom: boolean;
  onTogglePerRoom: (v: boolean) => void;
  hasRoomOverride: boolean;
  onResetToDefault: () => Promise<void> | void;
  rtl: boolean;
  userId: string;
}) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(rtl ? "الصور فقط" : "Images only");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error(rtl ? "أقصى حد 15 ميجا" : "Max 15MB");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("chat-wallpapers")
        .upload(path, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
      if (error) throw error;
      await onUploadCustom(path);
      toast.success(rtl ? "تم رفع الخلفية" : "Wallpaper uploaded");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed");
    } finally {
      setUploading(false);
    }
  };

  const isCustom = value.type === "custom";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-10 w-10 rounded-full shrink-0 hover:bg-[color:var(--brand-gold,#d4af37)]/10"
          aria-label={rtl ? "خلفية الشات" : "Wallpaper"}
          title={rtl ? "خلفية الشات" : "Chat wallpaper"}
        >
          <Palette className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent dir={rtl ? "rtl" : "ltr"} className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-[color:var(--brand-gold,#d4af37)]" />
            {rtl ? "خلفية المحادثة" : "Chat wallpaper"}
          </DialogTitle>
          <DialogDescription>
            {rtl
              ? "اختر خلفية جاهزة أو ارفع صورتك بجودة استوديو، وطبّقها لكل الشاتات أو للمحادثة الحالية فقط."
              : "Pick a curated preset or upload your own studio-grade image, applied to all chats or just this one."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-xl border p-3 bg-muted/30">
          <div className="text-xs">
            <div className="font-semibold text-sm">
              {rtl ? "خلفية لهذه المحادثة فقط" : "Only for this conversation"}
            </div>
            <div className="text-muted-foreground">
              {rtl
                ? "لو مقفول، الاختيار بيتحفظ كخلفية افتراضية لكل الشاتات."
                : "When off, the choice becomes your default for every chat."}
            </div>
          </div>
          <Switch checked={applyPerRoom} onCheckedChange={onTogglePerRoom} />
        </div>

        {/* Upload / current custom */}
        <div className="rounded-xl border p-3 bg-gradient-to-br from-card to-muted/40">
          <div className="flex items-center gap-3">
            <div
              className="h-16 w-16 rounded-lg overflow-hidden ring-2 ring-[color:var(--brand-gold,#d4af37)]/40 shrink-0 bg-cover bg-center"
              style={{
                background: isCustom && customUrl
                  ? `url(${customUrl}) center/cover no-repeat`
                  : "linear-gradient(135deg,#1a1a1c,#2a2a2c)",
              }}
            />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                <ImageIcon className="h-4 w-4" />
                {rtl ? "صورتك الشخصية" : "Your uploaded image"}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {isCustom
                  ? (rtl ? "مفعّلة الآن" : "Currently active")
                  : (rtl ? "لم يتم رفع صورة بعد" : "No image yet")}
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { handleFile(e.target.files?.[0]); e.currentTarget.value = ""; }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="rounded-full"
            >
              {uploading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Upload className="h-4 w-4 me-1" />}
              {rtl ? "رفع" : "Upload"}
            </Button>
            {isCustom && (
              <Button size="icon" variant="ghost" onClick={() => onClearCustom()} className="h-8 w-8 text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Presets */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
            {rtl ? "خلفيات مميزة" : "Curated presets"}
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {PRESETS.map((p) => {
              const active = value.type === "preset" && value.preset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onSelectPreset(p.id); }}
                  className={cn(
                    "relative h-20 rounded-xl overflow-hidden ring-2 transition-all",
                    active
                      ? "ring-[color:var(--brand-gold,#d4af37)] shadow-lg scale-[1.03]"
                      : "ring-border hover:ring-primary/50 hover:scale-[1.02]"
                  )}
                  style={{ background: p.swatch }}
                  aria-label={rtl ? p.label_ar : p.label_en}
                >
                  {active && (
                    <span className="absolute top-1 end-1 h-5 w-5 rounded-full bg-[color:var(--brand-gold,#d4af37)] text-black grid place-items-center shadow">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-black/55 text-white text-[10px] font-medium py-1 px-2 text-center backdrop-blur-sm">
                    {rtl ? p.label_ar : p.label_en}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {applyPerRoom && hasRoomOverride && (
          <Button variant="outline" size="sm" onClick={() => onResetToDefault()} className="w-full">
            {rtl ? "استخدام الخلفية الافتراضية" : "Use default wallpaper"}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
