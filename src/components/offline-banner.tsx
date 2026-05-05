import { useEffect, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";

/** Floating online/offline status banner. Auto-hides 3s after coming back online. */
export function OfflineBanner() {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [showRecovered, setShowRecovered] = useState(false);

  useEffect(() => {
    const up = () => {
      setOnline(true);
      setShowRecovered(true);
      setTimeout(() => setShowRecovered(false), 3000);
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  if (online && !showRecovered) return null;

  return (
    <div
      role="status"
      className={`pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-[env(safe-area-inset-top)] no-print`}
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
