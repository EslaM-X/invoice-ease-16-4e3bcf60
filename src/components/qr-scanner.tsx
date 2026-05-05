import { useEffect, useRef, useState, useCallback } from "react";
import { ScanLine, X, Loader2, RefreshCw, Zap, ZapOff, Wifi, WifiOff, Gauge, Keyboard, Timer, Camera, Database } from "lucide-react";
import { getCacheSize, getLastCacheUpdate } from "@/lib/product-cache";

type Props = {
  onScan: (text: string) => void;
  onClose: () => void;
  /** Last network/fetch duration reported by parent (ms). Displayed in HUD. */
  lastFetchMs?: number | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatAgo(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `قبل ${s}ث`;
  const m = Math.round(s / 60);
  if (m < 60) return `قبل ${m}د`;
  const h = Math.round(m / 60);
  return `قبل ${h}س`;
}

/**
 * QR Scanner v3.2 — diagnostics, manual fallback, adaptive backoff.
 */
export function QrScanner({ onScan, onClose, lastFetchMs }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<any>(null);
  const lastScan = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const lastDecodeAtRef = useRef<number>(0);
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);
  const fpsTickRef = useRef<{ count: number; ts: number }>({ count: 0, ts: Date.now() });
  const fpsRef = useRef(0);
  // Debounce / stabilization: require N consecutive frames with the same decode within a window
  const stabilizeRef = useRef<{ text: string; count: number; firstAt: number }>({ text: "", count: 0, firstAt: 0 });
  const STABILIZE_REQUIRED = 2; // 2 consecutive identical decodes
  const STABILIZE_WINDOW_MS = 350;
  const COOLDOWN_MS = 1500;

  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<"permission" | "notfound" | "inuse" | "generic">("generic");
  const [flash, setFlash] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryIn, setRetryIn] = useState(0);
  const [lowRes, setLowRes] = useState(false);
  const [fps, setFps] = useState(0);
  const [lastDecodeMs, setLastDecodeMs] = useState<number | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualId, setManualId] = useState("");
  const [online, setOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [cacheInfo, setCacheInfo] = useState<{ size: number; at: number | null }>({ size: 0, at: null });

  const getFps = useCallback(() => {
    if (typeof navigator === "undefined") return 10;
    const mem = (navigator as any).deviceMemory ?? 4;
    const cores = navigator.hardwareConcurrency ?? 4;
    const target = mem <= 2 || cores <= 2 ? 8 : mem <= 4 ? 12 : 15;
    return lowRes ? Math.min(target, 8) : target;
  }, [lowRes]);

  const loadLib = async (retries = 3): Promise<any> => {
    for (let i = 0; i < retries; i++) {
      try { return await import("html5-qrcode"); }
      catch (e) {
        if (i === retries - 1) throw e;
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
  };

  /** Adaptive backoff: factors network + recent fps + attempt count. */
  const computeBackoff = (attempt: number) => {
    let base = 800 * attempt; // 800, 1600, 2400…
    if (!online) base *= 2;          // network down → wait longer
    if (fpsRef.current && fpsRef.current < 5) base += 600; // perf issues
    return Math.min(base, 6000);
  };

  const classifyError = (e: any): typeof errorKind => {
    const name = e?.name || "";
    const msg = (e?.message || "").toLowerCase();
    if (name === "NotAllowedError" || msg.includes("permission")) return "permission";
    if (name === "NotFoundError" || msg.includes("not found")) return "notfound";
    if (name === "NotReadableError" || msg.includes("in use") || msg.includes("could not start")) return "inuse";
    return "generic";
  };

  const start = useCallback(async () => {
    setError(null);
    setStarting(true);
    setRetryIn(0);
    attemptRef.current += 1;
    const startedAt = performance.now();
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

      lastDecodeAtRef.current = performance.now();
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
          fpsTickRef.current.count += 1;
          const nowPerf = performance.now();
          const decodeMs = Math.round(nowPerf - lastDecodeAtRef.current);
          lastDecodeAtRef.current = nowPerf;
          setLastDecodeMs(decodeMs);

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
        () => { fpsTickRef.current.count += 1; }
      );

      try {
        const caps = (sc as any).getRunningTrackCapabilities?.();
        if (caps && "torch" in caps) setTorchSupported(true);
      } catch {}

      if (mountedRef.current) {
        const bootMs = Math.round(performance.now() - startedAt);
        console.info("[qr] camera ready in", bootMs, "ms");
        setStarting(false);
        setRetrying(false);
        attemptRef.current = 0;
      }
    } catch (e: any) {
      console.error("[qr] start failed", e);
      if (!mountedRef.current) return;
      const kind = classifyError(e);
      setErrorKind(kind);
      // Permission denied → don't auto-retry, ask the user
      if (kind === "permission" || attemptRef.current >= 3) {
        setError(e?.message ?? "تعذّر تشغيل الكاميرا");
        setStarting(false);
        setRetrying(false);
        return;
      }
      setRetrying(true);
      const delay = computeBackoff(attemptRef.current);
      let remaining = Math.ceil(delay / 1000);
      setRetryIn(remaining);
      const tick = setInterval(() => {
        remaining -= 1;
        if (!mountedRef.current || remaining <= 0) { clearInterval(tick); setRetryIn(0); }
        else setRetryIn(remaining);
      }, 1000);
      setTimeout(() => mountedRef.current && start(), delay);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onScan, lowRes, getFps, online]);

  const toggleTorch = async () => {
    const sc = scannerRef.current;
    if (!sc) return;
    try {
      await sc.applyVideoConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn((v) => !v);
    } catch (e) { console.warn("[qr] torch toggle failed", e); }
  };

  const submitManual = () => {
    const v = manualId.trim();
    if (!v) return;
    // Accept either bare UUID or full encoded QR string
    if (UUID_RE.test(v) || v.startsWith("S1:") || v.startsWith("{")) {
      onScan(v);
      setManualId("");
      setShowManual(false);
    }
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

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      const r = fpsTickRef.current;
      const now = Date.now();
      const dt = (now - r.ts) / 1000;
      const v = dt > 0 ? Math.round(r.count / dt) : 0;
      setFps(v);
      fpsRef.current = v;
      fpsTickRef.current = { count: 0, ts: now };
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const refresh = () => setCacheInfo({ size: getCacheSize(), at: getLastCacheUpdate() });
    refresh();
    const iv = setInterval(refresh, 2000);
    return () => clearInterval(iv);
  }, [lastFetchMs]);

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

  const errorHelp = () => {
    switch (errorKind) {
      case "permission": return "اذهب إلى إعدادات المتصفح واسمح بالوصول إلى الكاميرا، ثم أعد المحاولة.";
      case "notfound":  return "لم يتم العثور على كاميرا. تأكد من توصيل كاميرا أو استخدام جهاز آخر.";
      case "inuse":     return "الكاميرا مستخدمة من تطبيق آخر. أغلق التطبيقات الأخرى وحاول مجددًا.";
      default:          return "تأكد من إعطاء صلاحية الكاميرا، أو استخدم الإدخال اليدوي بالأسفل.";
    }
  };

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

        {/* Top status bar */}
        <div className="pointer-events-none absolute left-2 right-2 top-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white">
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

        {/* Bottom-left timing HUD */}
        {!starting && !error && (
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 text-[11px] text-white">
            <div className="flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-1 backdrop-blur">
              <Timer className="h-3 w-3 text-primary" />
              <span>فك: {lastDecodeMs != null ? `${lastDecodeMs}ms` : "—"}</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-1 backdrop-blur">
              <Wifi className="h-3 w-3 text-primary" />
              <span>جلب: {lastFetchMs != null ? `${lastFetchMs}ms` : "—"}</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-1 backdrop-blur" title="عدد المنتجات المخزّنة محليًا وآخر تحديث">
              <Database className="h-3 w-3 text-primary" />
              <span>
                كاش: {cacheInfo.size}
                {cacheInfo.at ? ` · ${formatAgo(cacheInfo.at)}` : " · —"}
              </span>
            </div>
          </div>
        )}

        {flash && <div className="pointer-events-none absolute inset-0 bg-emerald-400/30" />}

        {starting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">
              {retrying
                ? `إعادة المحاولة (${attemptRef.current}/3)${retryIn ? ` خلال ${retryIn}ث` : "..."}`
                : "جاري تشغيل الكاميرا..."}
            </span>
            {retrying && (
              <span className="text-[11px] opacity-70">
                {!online ? "الشبكة غير متاحة — تأخير أطول" : fpsRef.current && fpsRef.current < 5 ? "أداء منخفض — تأخير معدّل" : "إعادة محاولة تكيّفية"}
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-black/85 px-4 py-6 text-center text-white">
            <ScanLine className="h-8 w-8 text-destructive" />
            <span className="text-sm font-medium">{error}</span>
            <span className="max-w-xs text-xs opacity-80">{errorHelp()}</span>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={() => { attemptRef.current = 0; start(); }}
                className="flex items-center gap-2 rounded-md border border-white/30 px-3 py-1.5 text-xs hover:bg-white/10"
              >
                <RefreshCw className="h-3.5 w-3.5" /> إعادة المحاولة
              </button>
              <button
                onClick={() => setShowManual((v) => !v)}
                className="flex items-center gap-2 rounded-md border border-white/30 px-3 py-1.5 text-xs hover:bg-white/10"
              >
                <Keyboard className="h-3.5 w-3.5" /> إدخال يدوي
              </button>
            </div>
            {showManual && (
              <div className="mt-2 w-full max-w-xs space-y-2">
                <input
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitManual()}
                  placeholder="أدخل معرّف المنتج (UUID) أو رمز QR"
                  className="w-full rounded-md border border-white/30 bg-black/50 px-3 py-2 text-xs text-white placeholder:text-white/50"
                  dir="ltr"
                />
                <button
                  onClick={submitManual}
                  className="w-full rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  بحث وإضافة
                </button>
              </div>
            )}
          </div>
        )}

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

      {/* Settings + manual entry shortcut */}
      <div className="grid gap-2 rounded-md border bg-card p-3 text-xs">
        <label className="flex cursor-pointer items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Camera className="h-3.5 w-3.5 text-primary" />
            وضع منخفض الدقة (أكثر استقرارًا)
          </span>
          <input
            type="checkbox"
            checked={lowRes}
            onChange={(e) => setLowRes(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
        </label>
        {!error && (
          <button
            onClick={() => setShowManual((v) => !v)}
            className="flex items-center justify-center gap-2 rounded-md border bg-background px-3 py-1.5 hover:bg-accent"
          >
            <Keyboard className="h-3.5 w-3.5" /> إدخال يدوي
          </button>
        )}
        {!error && showManual && (
          <div className="space-y-2">
            <input
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitManual()}
              placeholder="UUID أو رمز QR"
              className="w-full rounded-md border bg-background px-3 py-2"
              dir="ltr"
            />
            <button
              onClick={submitManual}
              className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground hover:opacity-90"
            >
              بحث وإضافة
            </button>
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
