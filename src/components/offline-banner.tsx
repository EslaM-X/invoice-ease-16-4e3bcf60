import { useEffect, useRef, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";

/**
 * Real online/offline detection.
 * `navigator.onLine` is unreliable (often returns false on captive networks,
 * VPNs, or after sleep). We additionally probe the Supabase URL every 15s
 * and on every browser online/offline event to confirm real connectivity.
 */

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
    // no-cors so we don't need CORS headers; opaque response = success
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

export function OfflineBanner() {
  const [online, setOnline] = useState<boolean>(true); // optimistic start
  const [showRecovered, setShowRecovered] = useState(false);
  const wasOnlineRef = useRef(true);

  useEffect(() => {
    let mounted = true;

    const update = (next: boolean) => {
      if (!mounted) return;
      setOnline(next);
      if (next && !wasOnlineRef.current) {
        setShowRecovered(true);
        setTimeout(() => mounted && setShowRecovered(false), 3000);
      }
      wasOnlineRef.current = next;
    };

    const check = async () => {
      // Skip probe if browser is sure we're offline (saves wakeups)
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        update(false);
        return;
      }
      const ok = await probe();
      update(ok);
    };

    // Initial check
    check();

    const iv = setInterval(check, PROBE_INTERVAL_MS);
    const onUp = () => check();
    const onDown = () => update(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) check();
    });

    return () => {
      mounted = false;
      clearInterval(iv);
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, []);

  if (online && !showRecovered) return null;

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-[env(safe-area-inset-top)] no-print"
    >
      <div
        className={`pointer-events-auto mt-2 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur transition-all ${
          online
            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
            : "border-amber-500/40 bg-amber-500/15 text-amber-300"
        }`}
      >
        {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
        <span>
          {online
            ? "تم استعادة الاتصال — جاري المزامنة"
            : "أنت غير متصل — يعمل التطبيق من الكاش، وستُحفظ الإجراءات وتُرسل لاحقًا"}
        </span>
      </div>
    </div>
  );
}
