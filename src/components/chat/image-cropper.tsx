import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { RotateCw, RotateCcw, ZoomIn, Loader2, Check } from "lucide-react";

/**
 * Crop the source image (data URL) into a rotated / cropped JPEG blob at target width,
 * preserving as much fidelity as possible while keeping file size sane.
 */
async function makeCroppedBlob(
  src: string,
  pixels: Area,
  rotation: number,
  targetWidth: number,
): Promise<Blob> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("image_load_failed"));
  });

  // Off-screen canvas rotated, then a second canvas that crops to `pixels`.
  const rad = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const rotW = Math.floor(img.width * cos + img.height * sin);
  const rotH = Math.floor(img.width * sin + img.height * cos);

  const rot = document.createElement("canvas");
  rot.width = rotW;
  rot.height = rotH;
  const rctx = rot.getContext("2d")!;
  rctx.imageSmoothingEnabled = true;
  rctx.imageSmoothingQuality = "high";
  rctx.translate(rotW / 2, rotH / 2);
  rctx.rotate(rad);
  rctx.drawImage(img, -img.width / 2, -img.height / 2);

  // Crop
  const cropX = pixels.x;
  const cropY = pixels.y;
  const cropW = pixels.width;
  const cropH = pixels.height;

  // Downscale to targetWidth preserving aspect ratio
  const scale = Math.min(1, targetWidth / cropW);
  const outW = Math.round(cropW * scale);
  const outH = Math.round(cropH * scale);

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(rot, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

  // JPEG @ 0.92 gives visually identical result to source at a fraction of the size
  return new Promise<Blob>((res, rej) => {
    out.toBlob(
      (b) => (b ? res(b) : rej(new Error("blob_failed"))),
      "image/jpeg",
      0.92,
    );
  });
}

export function ImageCropperDialog({
  open,
  onOpenChange,
  srcDataUrl,
  aspect = 9 / 16,
  targetWidth = 1440,
  rtl,
  onCropped,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  srcDataUrl: string | null;
  aspect?: number;
  targetWidth?: number;
  rtl: boolean;
  onCropped: (blob: Blob) => Promise<void> | void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  const onComplete = useCallback((_a: Area, px: Area) => setPixels(px), []);

  const confirm = async () => {
    if (!srcDataUrl || !pixels) return;
    setBusy(true);
    try {
      const blob = await makeCroppedBlob(srcDataUrl, pixels, rotation, targetWidth);
      await onCropped(blob);
      onOpenChange(false);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={rtl ? "rtl" : "ltr"} className="max-w-xl p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle>
            {rtl ? "قص وتدوير الخلفية" : "Crop & rotate wallpaper"}
          </DialogTitle>
          <DialogDescription>
            {rtl
              ? "اسحب لتحريك الصورة، دوّرها، وكبّرها لضبط أفضل شكل قبل الحفظ."
              : "Drag to reposition, rotate, and zoom to frame it perfectly before saving."}
          </DialogDescription>
        </DialogHeader>

        <div className="relative bg-black h-[52vh]">
          {srcDataUrl && (
            <Cropper
              image={srcDataUrl}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              onCropComplete={onComplete}
              restrictPosition
              objectFit="contain"
            />
          )}
        </div>

        <div className="p-4 space-y-3 border-t bg-card">
          <div className="flex items-center gap-2">
            <ZoomIn className="h-4 w-4 text-muted-foreground shrink-0" />
            <Slider
              value={[zoom * 100]}
              onValueChange={(v) => setZoom(v[0] / 100)}
              min={100}
              max={400}
              step={1}
              className="flex-1"
            />
            <span className="text-xs tabular-nums w-10 text-end">{Math.round(zoom * 100)}%</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setRotation((r) => r - 90)}>
              <RotateCcw className="h-4 w-4 me-1" />
              {rtl ? "يسار" : "Left"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRotation((r) => r + 90)}>
              <RotateCw className="h-4 w-4 me-1" />
              {rtl ? "يمين" : "Right"}
            </Button>
            <span className="text-xs text-muted-foreground ms-auto">
              {rtl ? "زاوية:" : "Angle:"} {rotation % 360}°
            </span>
          </div>
        </div>

        <DialogFooter className="p-4 pt-0 gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {rtl ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={confirm} disabled={busy || !pixels} className="min-w-32">
            {busy ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Check className="h-4 w-4 me-2" />}
            {rtl ? "حفظ الخلفية" : "Save wallpaper"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
