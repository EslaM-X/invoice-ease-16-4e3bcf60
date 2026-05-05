import { useEffect, useRef, useState, useCallback } from "react";
import { ScanLine, X, Loader2, RefreshCw, Zap, ZapOff } from "lucide-react";

type Props = { onScan: (text: string) => void; onClose: () => void };

/**
 * QR Scanner v3 — optimized for weak networks & unstable conditions.
 * - Lazy-loads html5-qrcode with retry & timeout (works on flaky 2G/3G)
 * - Adaptive fps based on device performance
 * - Auto-retry on camera failures (up to 3 attempts with backoff)
 * - Torch/flashlight toggle for low-light scanning
 * - Resilient to tab visibility changes (pauses & resumes)
 * - Visual + haptic feedback, debounced duplicate detection
 */
export function QrScanner({ onScan, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<any>(null);
  const lastScan = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Adaptive fps: reduce on low-memory devices for stability over speed
  const getFps = () => {
    if (typeof navigator === "undefined") return 10;
    const mem = (navigator as any).deviceMemory ?? 4;
    const cores = navigator.hardwareConcurrency ?? 4;
    if (mem <= 2 || cores <= 2) return 8;
    if (mem <= 4) return 12;
    return 15;
  };

  // Load library with retry for weak connections
  const loadLib = async (retries = 3): Promise<any> => {
    for (let i = 0; i < retries; i++) {
      try {
        return await import("html5-qrcode");
      } catch (e) {
        if (i === retries - 1) throw e;
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
  };

  const start = useCallback(async () => {
    setError(null);
    setStarting(true);
    attemptRef.current += 1;
    try {
      const { Html5Qrcode } = await loadLib();
      if (!ref.current || !mountedRef.current) return;

      // Re-use existing scanner if any
      if (scannerRef.current) {
        try { await scannerRef.current.stop(); } catch {}
        try { scannerRef.current.clear(); } catch {}
        scannerRef.current = null;
      }

      const id = "qr-reader-" + Math.random().toString(36).slice(2);
      ref.current.id = id;
      const sc = new Html5Qrcode(id, { verbose: false });
      scannerRef.current = sc;

      await sc.start(
        { facingMode: "environment" },
        {
          fps: getFps(),
          qrbox: (vw: number, vh: number) => {
            const m = Math.min(vw, vh);
            const size = Math.floor(m * 0.72);
            return { width: size, height: size };
          },
          aspectRatio: 1.0,
          disableFlip: false,
          // Use native BarcodeDetector when available (faster, lower CPU)
          useBarCodeDetectorIfSupported: true,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        } as any,
        (text: string) => {
          const now = Date.now();
          if (lastScan.current.text === text && now - lastScan.current.at < 1500) return;
          lastScan.current = { text, at: now };
          setFlash(true);
          setTimeout(() => setFlash(false), 200);
          if (typeof navigator !== "undefined" && "vibrate" in navigator) {
            try { (navigator as any).vibrate?.(50); } catch {}
          }
          onScan(text);
        },
        () => {}
      );

      // Torch detection
      try {
        const caps = (sc as any).getRunningTrackCapabilities?.();
        if (caps && "torch" in caps) setTorchSupported(true);
      } catch {}

      if (mountedRef.current) {
        setStarting(false);
        setRetrying(false);
        attemptRef.current = 0;
      }
    } catch (e: any) {
      console.error("[qr] start failed", e);
      if (!mountedRef.current) return;
      // Auto-retry up to 3 times with backoff
      if (attemptRef.current < 3) {
        setRetrying(true);
        setTimeout(() => mountedRef.current && start(), 1000 * attemptRef.current);
      } else {
        setError(e?.message ?? "تعذّر تشغيل الكاميرا");
        setStarting(false);
        setRetrying(false);
      }
    }
  }, [onScan]);

  // Toggle torch
  const toggleTorch = async () => {
    const sc = scannerRef.current;
    if (!sc) return;
    try {
      await sc.applyVideoConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn((v) => !v);
    } catch (e) {
      console.warn("[qr] torch toggle failed", e);
    }
  };

  // Pause/resume on tab visibility (saves battery + avoids stalls)
  useEffect(() => {
    const onVis = () => {
      const sc = scannerRef.current;
      if (!sc) return;
      try {
        if (document.hidden) sc.pause?.(true);
        else sc.resume?.();
      } catch {}
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    start();
    return () => {
      mountedRef.current = false;
      const sc = scannerRef.current;
      if (sc) {
        try { sc.stop().then(() => sc.clear()).catch(() => {}); } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl border border-border bg-black" style={{ minHeight: 320 }}>
        <div ref={ref} className="h-full w-full" />
        {!starting && !error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-56 w-56">
              <div className="absolute -inset-1 rounded-2xl border-2 border-primary/60 shadow-[0_0_30px_oklch(0.78_0.11_82_/_0.4)]" />
              <div className="absolute inset-x-2 top-2 h-0.5 animate-[scan_2s_ease-in-out_infinite] bg-primary shadow-[0_0_8px_oklch(0.78_0.11_82)]" />
              <span className="absolute left-0 top-0 h-6 w-6 rounded-tl-lg border-l-4 border-t-4 border-primary" />
              <span className="absolute right-0 top-0 h-6 w-6 rounded-tr-lg border-r-4 border-t-4 border-primary" />
              <span className="absolute bottom-0 left-0 h-6 w-6 rounded-bl-lg border-b-4 border-l-4 border-primary" />
              <span className="absolute bottom-0 right-0 h-6 w-6 rounded-br-lg border-b-4 border-r-4 border-primary" />
            </div>
          </div>
        )}
        {flash && <div className="pointer-events-none absolute inset-0 bg-emerald-400/30" />}
        {starting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">
              {retrying ? `إعادة المحاولة (${attemptRef.current}/3)...` : "جاري تشغيل الكاميرا..."}
            </span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-4 text-center text-white">
            <ScanLine className="h-8 w-8 text-destructive" />
            <span className="text-sm">{error}</span>
            <span className="text-xs opacity-70">تأكد من إعطاء صلاحية الكاميرا</span>
            <button
              onClick={start}
              className="mt-2 flex items-center gap-2 rounded-md border border-white/30 px-3 py-1.5 text-xs hover:bg-white/10"
            >
              <RefreshCw className="h-3.5 w-3.5" /> إعادة المحاولة
            </button>
          </div>
        )}
        {/* Torch button */}
        {!starting && !error && torchSupported && (
          <button
            onClick={toggleTorch}
            className="absolute bottom-3 right-3 rounded-full bg-black/60 p-2 text-white backdrop-blur transition hover:bg-black/80"
            aria-label="فلاش"
          >
            {torchOn ? <Zap className="h-5 w-5 text-primary" /> : <ZapOff className="h-5 w-5" />}
          </button>
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
