import { useEffect, useRef, useState, useCallback } from "react";
import { ScanLine, X, Loader2, RefreshCw, Zap, ZapOff, Wifi, WifiOff, Gauge } from "lucide-react";

type Props = { onScan: (text: string) => void; onClose: () => void };

/**
 * QR Scanner v3.1 — optimized for weak networks & unstable conditions.
 * - Lazy-loads html5-qrcode with retry + adaptive fps
 * - Low-res mode toggle (320x240) for weak devices
 * - Live status overlay: network, fps, retry countdown
 * - Torch toggle, auto-pause on hidden tab, auto-retry on failure
 */
export function QrScanner({ onScan, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<any>(null);
  const lastScan = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);
  const fpsTickRef = useRef<{ count: number; ts: number }>({ count: 0, ts: Date.now() });

  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryIn, setRetryIn] = useState(0);
  const [lowRes, setLowRes] = useState(false);
  const [fps, setFps] = useState(0);
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  // Adaptive fps based on device perf (capped lower in low-res mode for stability)
  const getFps = useCallback(() => {
    if (typeof navigator === "undefined") return 10;
    const mem = (navigator as any).deviceMemory ?? 4;
    const cores = navigator.hardwareConcurrency ?? 4;
    const target = mem <= 2 || cores <= 2 ? 8 : mem <= 4 ? 12 : 15;
    return lowRes ? Math.min(target, 8) : target;
  }, [lowRes]);

  // Library load with retry
  const loadLib = async (retries = 3): Promise<any> => {
    for (let i = 0; i < retries; i++) {
      try { return await import("html5-qrcode"); }
      catch (e) {
        if (i === retries - 1) throw e;
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
  };

  const start = useCallback(async () => {
    setError(null);
    setStarting(true);
    setRetryIn(0);
    attemptRef.current += 1;
    try {
      const { Html5Qrcode } = await loadLib();
      if (!ref.current || !mountedRef.current) return;

      if (scannerRef.current) {
        try { await scannerRef.current.stop(); } catch {}
        try { scannerRef.current.clear(); } catch {}
        scannerRef.current = null;
      }

      const id = "qr-reader-" + Math.random().toString(36).slice(2);
      ref.current.id = id;
      const sc = new Html5Qrcode(id, { verbose: false });
      scannerRef.current = sc;

      const videoConstraints: MediaTrackConstraints = lowRes
        ? { facingMode: "environment", width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 20 } }
        : { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } };

      await sc.start(
        videoConstraints,
        {
          fps: getFps(),
          qrbox: (vw: number, vh: number) => {
            const m = Math.min(vw, vh);
            const size = Math.floor(m * 0.72);
            return { width: size, height: size };
          },
          aspectRatio: 1.0,
          disableFlip: false,
          useBarCodeDetectorIfSupported: true,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        } as any,
        (text: string) => {
          // Track frame-tick whenever the scan callback hits successful decode
          fpsTickRef.current.count += 1;
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
        () => {
          // every scan attempt (success or not) — used as fps proxy
          fpsTickRef.current.count += 1;
        }
      );

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
      if (attemptRef.current < 3) {
        setRetrying(true);
        const delay = 1000 * attemptRef.current;
        // countdown for UI
        let remaining = Math.ceil(delay / 1000);
        setRetryIn(remaining);
        const tick = setInterval(() => {
          remaining -= 1;
          if (!mountedRef.current || remaining <= 0) { clearInterval(tick); setRetryIn(0); }
          else setRetryIn(remaining);
        }, 1000);
        setTimeout(() => mountedRef.current && start(), delay);
      } else {
        setError(e?.message ?? "تعذّر تشغيل الكاميرا");
        setStarting(false);
        setRetrying(false);
      }
    }
  }, [onScan, lowRes, getFps]);

  // Torch
  const toggleTorch = async () => {
    const sc = scannerRef.current;
    if (!sc) return;
    try {
      await sc.applyVideoConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn((v) => !v);
    } catch (e) { console.warn("[qr] torch toggle failed", e); }
  };

  // Visibility pause/resume
  useEffect(() => {
    const onVis = () => {
      const sc = scannerRef.current;
      if (!sc) return;
      try { if (document.hidden) sc.pause?.(true); else sc.resume?.(); } catch {}
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Network listeners
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  // FPS sampler (1s window)
  useEffect(() => {
    const iv = setInterval(() => {
      const ref = fpsTickRef.current;
      const now = Date.now();
      const dt = (now - ref.ts) / 1000;
      if (dt > 0) setFps(Math.round(ref.count / dt));
      fpsTickRef.current = { count: 0, ts: now };
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // Restart when lowRes toggles
  useEffect(() => {
    mountedRef.current = true;
    start();
    return () => {
      mountedRef.current = false;
      const sc = scannerRef.current;
      if (sc) { try { sc.stop().then(() => sc.clear()).catch(() => {}); } catch {} }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowRes]);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl border border-border bg-black" style={{ minHeight: 320 }}>
        <div ref={ref} className="h-full w-full" />

        {/* Aiming overlay */}
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

        {/* Top status bar */}
        <div className="pointer-events-none absolute left-2 right-2 top-2 flex items-center justify-between gap-2 text-[11px] text-white">
          <div className="flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-1 backdrop-blur">
            {online
              ? <><Wifi className="h-3 w-3 text-emerald-400" /> <span>متصل</span></>
              : <><WifiOff className="h-3 w-3 text-red-400" /> <span>غير متصل</span></>}
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-1 backdrop-blur">
            <Gauge className="h-3 w-3 text-primary" />
            <span>{starting ? "—" : `${fps} fps`}</span>
            {lowRes && <span className="opacity-70">· low-res</span>}
          </div>
        </div>

        {flash && <div className="pointer-events-none absolute inset-0 bg-emerald-400/30" />}

        {starting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">
              {retrying
                ? `إعادة المحاولة (${attemptRef.current}/3)${retryIn ? ` خلال ${retryIn}ث` : "..."}`
                : "جاري تشغيل الكاميرا..."}
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

        {/* Bottom-right action buttons */}
        {!starting && !error && (
          <div className="absolute bottom-3 right-3 flex flex-col gap-2">
            {torchSupported && (
              <button
                onClick={toggleTorch}
                className="rounded-full bg-black/60 p-2 text-white backdrop-blur transition hover:bg-black/80"
                aria-label="فلاش"
              >
                {torchOn ? <Zap className="h-5 w-5 text-primary" /> : <ZapOff className="h-5 w-5" />}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Settings row */}
      <div className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-xs">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={lowRes}
            onChange={(e) => setLowRes(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          <span>وضع منخفض الدقة (أكثر استقرارًا للأجهزة الضعيفة)</span>
        </label>
        <span className="text-muted-foreground">{lowRes ? "320×240" : "HD"}</span>
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
