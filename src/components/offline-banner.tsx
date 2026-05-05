import { useEffect, useRef, useState, useCallback } from "react";
import { WifiOff, Wifi, RefreshCw, Loader2 } from "lucide-react";

const PROBE_URL =
  (import.meta as any).env?.VITE_SUPABASE_URL
    ? `${(import.meta as any).env.VITE_SUPABASE_URL}/auth/v1/health`
    : "/favicon.ico";
const PROBE_INTERVAL_MS = 15000;
const PROBE_TIMEOUT_MS = 4000;

async function probe(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(PROBE_URL + "?_=" + Date.now(), {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return res.type === "opaque" || res.ok;
  } catch {
    return false;
  }
}

/** Dispatched globally so any list/page can opt-in to refetch. */
export function triggerAppResync() {
  try { window.dispatchEvent(new CustomEvent("app:resync", { detail: { at: Date.now() } })); } catch {}
}

export function OfflineBanner() {
  const [online, setOnline] = useState<boolean>(true);
  const [showRecovered, setShowRecovered] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(0);
  const wasOnlineRef = useRef(true);
  const recoverTimer = useRef<number | null>(null);

  const runSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setProgress(8);
    triggerAppResync();
    const start = Date.now();
    const total = 1400;
    await new Promise<void>((resolve) => {
      const iv = setInterval(() => {
        const elapsed = Date.now() - start;
        const pct = Math.min(95, Math.round((elapsed / total) * 95));
        setProgress(pct);
        if (elapsed >= total) { clearInterval(iv); resolve(); }
      }, 80);
    });
    setProgress(100);
    setTimeout(() => { setSyncing(false); setProgress(0); }, 350);
  }, [syncing]);

  useEffect(() => {
    let mounted = true;

    const update = (next: boolean) => {
      if (!mounted) return;
      setOnline(next);
      if (next && !wasOnlineRef.current) {
        setShowRecovered(true);
        // Auto trigger one resync on recovery
        runSync();
        if (recoverTimer.current) window.clearTimeout(recoverTimer.current);
        recoverTimer.current = window.setTimeout(() => mounted && setShowRecovered(false), 6000);
      }
      wasOnlineRef.current = next;
    };

    const check = async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        update(false); return;
      }
      const ok = await probe();
      update(ok);
    };

    check();
    const iv = setInterval(check, PROBE_INTERVAL_MS);
    const onUp = () => check();
    const onDown = () => update(false);
    const onVis = () => { if (!document.hidden) check(); };
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      mounted = false;
      clearInterval(iv);
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
      document.removeEventListener("visibilitychange", onVis);
      if (recoverTimer.current) window.clearTimeout(recoverTimer.current);
    };
  }, [runSync]);

  const visible = !online || showRecovered || syncing;
  if (!visible) return null;

  const tone = !online
    ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
    : "border-emerald-500/40 bg-emerald-500/15 text-emerald-200";

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-[env(safe-area-inset-top)] no-print"
    >
      <div className={`pointer-events-auto mt-2 w-[min(92vw,520px)] overflow-hidden rounded-2xl border ${tone} shadow-lg backdrop-blur`}>
        <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium">
          {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          <span className="flex-1 truncate">
            {!online
              ? "أنت غير متصل — التطبيق يعمل من الكاش"
              : syncing
              ? "جاري مزامنة البيانات…"
              : "تم استعادة الاتصال"}
          </span>
          <button
            onClick={runSync}
            disabled={syncing || !online}
            className="flex items-center gap-1 rounded-full border border-white/20 bg-black/30 px-2.5 py-1 text-[11px] font-semibold transition hover:bg-black/50 disabled:opacity-50"
          >
            {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            تحديث الآن
          </button>
        </div>
        {(syncing || (online && progress > 0)) && (
          <div className="h-1 w-full bg-black/30">
            <div
              className="h-full bg-emerald-400 transition-[width] duration-150 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
