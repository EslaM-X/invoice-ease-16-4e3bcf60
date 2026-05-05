import { useEffect, useRef, useState } from "react";
import { ScanLine, X, Loader2 } from "lucide-react";

type Props = { onScan: (text: string) => void; onClose: () => void };

/**
 * QR Scanner v2 — visible feedback, faster start, low-bandwidth friendly.
 * - Visual flash on successful scan
 * - Higher fps + larger qrbox for slow networks
 * - Re-uses camera if mounted multiple times in quick succession
 */
export function QrScanner({ onScan, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<any>(null);
  const lastScan = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (!ref.current || stopped) return;
        const id = "qr-reader-" + Math.random().toString(36).slice(2);
        ref.current.id = id;
        const sc = new Html5Qrcode(id, { verbose: false });
        scannerRef.current = sc;

        await sc.start(
          { facingMode: "environment" },
          {
            fps: 15, // faster scan rate
            qrbox: (vw: number, vh: number) => {
              const m = Math.min(vw, vh);
              const size = Math.floor(m * 0.7);
              return { width: size, height: size };
            },
            aspectRatio: 1.0,
            disableFlip: false,
          },
          (text: string) => {
            const now = Date.now();
            if (lastScan.current.text === text && now - lastScan.current.at < 1500) return;
            lastScan.current = { text, at: now };
            // Visual feedback
            setFlash(true);
            setTimeout(() => setFlash(false), 200);
            // Haptic if available
            if (typeof navigator !== "undefined" && "vibrate" in navigator) {
              try { (navigator as any).vibrate?.(50); } catch {}
            }
            onScan(text);
          },
          () => {}
        );
        if (!stopped) setStarting(false);
      } catch (e: any) {
        console.error(e);
        setError(e?.message ?? "تعذّر تشغيل الكاميرا");
        setStarting(false);
      }
    })();

    return () => {
      stopped = true;
      const sc = scannerRef.current;
      if (sc) {
        try {
          sc.stop().then(() => sc.clear()).catch(() => {});
        } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl border border-border bg-black" style={{ minHeight: 320 }}>
        <div ref={ref} className="h-full w-full" />
        {/* Aiming overlay */}
        {!starting && !error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-56 w-56">
              <div className="absolute -inset-1 rounded-2xl border-2 border-primary/60 shadow-[0_0_30px_oklch(0.78_0.11_82_/_0.4)]" />
              {/* Animated scan line */}
              <div className="absolute inset-x-2 top-2 h-0.5 animate-[scan_2s_ease-in-out_infinite] bg-primary shadow-[0_0_8px_oklch(0.78_0.11_82)]" />
              {/* Corner brackets */}
              <span className="absolute left-0 top-0 h-6 w-6 rounded-tl-lg border-l-4 border-t-4 border-primary" />
              <span className="absolute right-0 top-0 h-6 w-6 rounded-tr-lg border-r-4 border-t-4 border-primary" />
              <span className="absolute bottom-0 left-0 h-6 w-6 rounded-bl-lg border-b-4 border-l-4 border-primary" />
              <span className="absolute bottom-0 right-0 h-6 w-6 rounded-br-lg border-b-4 border-r-4 border-primary" />
            </div>
          </div>
        )}
        {/* Flash on success */}
        {flash && <div className="pointer-events-none absolute inset-0 bg-emerald-400/30" />}
        {/* Loading */}
        {starting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">جاري تشغيل الكاميرا...</span>
          </div>
        )}
        {/* Error */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 px-4 text-center text-white">
            <ScanLine className="h-8 w-8 text-destructive" />
            <span className="text-sm">{error}</span>
            <span className="text-xs opacity-70">تأكد من إعطاء صلاحية الكاميرا</span>
          </div>
        )}
      </div>

      <button
        onClick={onClose}
        className="flex w-full items-center justify-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent"
      >
        <X className="h-4 w-4" /> إغلاق
      </button>

      <style>{`
        @keyframes scan {
          0%, 100% { top: 4px; }
          50% { top: calc(100% - 8px); }
        }
      `}</style>
    </div>
  );
}
