import { useEffect, useRef, useState, useCallback } from "react";
import { ScanLine, X, Loader2, RefreshCw, Zap, ZapOff, Wifi, WifiOff, Gauge, Keyboard, Timer, Camera, Database, AlertTriangle } from "lucide-react";
import { getCacheSize, getLastCacheUpdate } from "@/lib/product-cache";

type CamInfo = { id: string; label: string };

type Props = {
  onScan: (text: string) => void;
  onClose: () => void;
  /** Last network/fetch duration reported by parent (ms). Displayed in HUD. */
  lastFetchMs?: number | null;
};

type StartCandidate = {
  label: string;
  source: string | MediaTrackConstraints;
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

export async function requestCameraPermission(
  facingMode: "environment" | "user" = "environment",
): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  try {
    const permissionApi = (navigator as Navigator & {
      permissions?: { query: (descriptor: PermissionDescriptor) => Promise<PermissionStatus> };
    }).permissions;
    if (permissionApi?.query) {
      const status = await permissionApi.query({ name: "camera" as PermissionName });
      return status.state === "granted";
    }
  } catch {}
  return !!navigator.mediaDevices?.getUserMedia;
}

function buildCameraCandidates(lowRes: boolean): StartCandidate[] {
  const width = lowRes ? 640 : 1280;
  const height = lowRes ? 480 : 720;
  const frameRate = lowRes ? { ideal: 12, max: 18 } : { ideal: 18, max: 24 };

  return [
    {
      label: "rear-exact",
      source: {
        facingMode: { exact: "environment" },
        width: { ideal: width },
        height: { ideal: height },
        frameRate,
      },
    },
    {
      label: "rear-ideal",
      source: {
        facingMode: "environment",
        width: { ideal: width },
        height: { ideal: height },
        frameRate,
      },
    },
    {
      label: "any-camera",
      source: {
        width: { ideal: width },
        height: { ideal: height },
        frameRate,
      },
    },
  ];
}

function pickRearCamera(cameras: CamInfo[]): CamInfo | null {
  const rearMatch = cameras.find((cam) =>
    /back|rear|environment|world|traseira|trasera|arrière|后置|الخلف|خلف/i.test(cam.label),
  );
  if (rearMatch) return rearMatch;
  if (cameras.length > 1) return cameras[cameras.length - 1] ?? null;
  return cameras[0] ?? null;
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
  const STABILIZE_REQUIRED = 1; // accept on first decode (with cooldown for de-dupe)
  const STABILIZE_WINDOW_MS = 250;
  const COOLDOWN_MS = 900;

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
  const [cameras, setCameras] = useState<CamInfo[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const facing: "environment" | "user" = "environment";
  const [failToast, setFailToast] = useState<string | null>(null);

  const getFps = useCallback(() => {
    if (typeof navigator === "undefined") return 15;
    const mem = (navigator as any).deviceMemory ?? 4;
    const cores = navigator.hardwareConcurrency ?? 4;
    const target = mem <= 2 || cores <= 2 ? 12 : mem <= 4 ? 18 : 24;
    return lowRes ? Math.min(target, 10) : target;
  }, [lowRes]);

  /** Explicitly request camera permission first — needed in installed PWAs/Android WebView. */
  const ensurePermission = async (): Promise<boolean> => {
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return true;
      return await requestCameraPermission(facing);
    } catch (e: any) {
      console.warn("[qr] permission probe failed", e);
      throw e;
    }
  };

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
      await ensurePermission();
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

      lastDecodeAtRef.current = performance.now();
      const scanConfig = {
        fps: getFps(),
        qrbox: (vw: number, vh: number) => {
          const m = Math.min(vw, vh);
          const size = Math.floor(m * 0.72);
          return { width: size, height: size };
        },
        aspectRatio: 1.0,
        disableFlip: false,
        useBarCodeDetectorIfSupported: false,
        experimentalFeatures: { useBarCodeDetectorIfSupported: false },
      } as any;

      const onDecode = (text: string) => {
        fpsTickRef.current.count += 1;
        const nowPerf = performance.now();
        const decodeMs = Math.round(nowPerf - lastDecodeAtRef.current);
        lastDecodeAtRef.current = nowPerf;
        setLastDecodeMs(decodeMs);

        const now = Date.now();
        if (lastScan.current.text === text && now - lastScan.current.at < COOLDOWN_MS) return;

        const stab = stabilizeRef.current;
        if (stab.text === text && now - stab.firstAt < STABILIZE_WINDOW_MS) {
          stab.count += 1;
        } else {
          stabilizeRef.current = { text, count: 1, firstAt: now };
          return;
        }
        if (stab.count < STABILIZE_REQUIRED) return;

        stabilizeRef.current = { text: "", count: 0, firstAt: 0 };
        lastScan.current = { text, at: now };
        setFlash(true);
        setTimeout(() => setFlash(false), 200);
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          try { (navigator as any).vibrate?.(50); } catch {}
        }
        onScan(text);
      };

      const onDecodeError = () => {
        fpsTickRef.current.count += 1;
      };

      let started = false;
      let lastError: any = null;
      const candidates: StartCandidate[] = [];

      if (cameraId) {
        candidates.push({ label: "saved-camera", source: cameraId });
      } else {
        const preferredRear = pickRearCamera(cameras);
        if (preferredRear) candidates.push({ label: `rear-device:${preferredRear.label}`, source: preferredRear.id });
        candidates.push(...buildCameraCandidates(lowRes));
      }

      for (const candidate of candidates) {
        try {
          console.info("[qr] starting with", candidate.label);
          await sc.start(candidate.source as any, scanConfig, onDecode, onDecodeError);
          started = true;
          break;
        } catch (candidateError: any) {
          lastError = candidateError;
          console.warn("[qr] candidate failed", candidate.label, candidateError);
          try { await sc.stop(); } catch {}
          try { await sc.clear(); } catch {}
          if (!mountedRef.current) return;
          scannerRef.current = new Html5Qrcode(id, { verbose: false });
        }
      }

      sc.clear = scannerRef.current.clear?.bind(scannerRef.current) ?? sc.clear?.bind(sc);
      if (!started) throw lastError ?? new Error("تعذّر تشغيل الكاميرا");

      try {
        const activeScanner = scannerRef.current;
        const caps = activeScanner?.getRunningTrackCapabilities?.();
        if (caps && "torch" in caps) setTorchSupported(true);
        else setTorchSupported(false);
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
      setFailToast(e?.message ?? "فشل تشغيل الماسح");
      window.setTimeout(() => mountedRef.current && setFailToast(null), 3500);
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
  }, [onScan, lowRes, getFps, online, cameraId, facing]);

  // Enumerate cameras once we have permission
  useEffect(() => {
    (async () => {
      try {
        const lib = await import("html5-qrcode");
        const list = await lib.Html5Qrcode.getCameras();
        if (!mountedRef.current) return;
        setCameras(list.map((c: any) => ({ id: c.id, label: c.label || "كاميرا" })));
      } catch (e) {
        console.warn("[qr] enumerate failed", e);
      }
    })();
  }, [starting]);

  const toggleTorch = async () => {
    const sc = scannerRef.current;
    if (!sc) return;
    try {
      const next = !torchOn;
      await sc.applyVideoConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
      try { localStorage.setItem("qr.torch", next ? "1" : "0"); } catch {}
    } catch (e) { console.warn("[qr] torch toggle failed", e); }
  };

  // Restore torch preference once the camera is ready
  useEffect(() => {
    if (starting || error) return;
    if (!torchSupported) return;
    try {
      const saved = localStorage.getItem("qr.torch");
      if (saved === "1" && !torchOn) toggleTorch();
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starting, torchSupported, error]);

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
  }, [lowRes, cameraId, facing]);

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

        {failToast && !error && (
          <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-2 rounded-full bg-destructive/90 px-3 py-1.5 text-[11px] text-white shadow-lg backdrop-blur">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{failToast}</span>
              <button
                onClick={() => { attemptRef.current = 0; setFailToast(null); start(); }}
                className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 hover:bg-white/30"
              >
                <RefreshCw className="h-3 w-3" /> إعادة
              </button>
            </div>
          </div>
        )}

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
        {torchSupported && (
          <button
            onClick={toggleTorch}
            className="flex items-center justify-center gap-2 rounded-md border bg-background px-3 py-1.5 hover:bg-accent"
          >
            {torchOn ? <Zap className="h-3.5 w-3.5 text-primary" /> : <ZapOff className="h-3.5 w-3.5" />}
            {torchOn ? "إيقاف الفلاش" : "تفعيل الفلاش"}
          </button>
        )}
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
