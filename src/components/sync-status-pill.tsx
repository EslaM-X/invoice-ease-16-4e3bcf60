import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Cloud, CloudOff, CloudUpload, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { getLastSync, formatRelativeTime } from "@/lib/sync-state";
import { getPendingCount } from "@/lib/offline-db";

/**
 * Tiny floating pill at bottom-end of every page showing last sync time + pending count.
 * - Updates live (every 10s) and on outbox/sync events.
 * - Responsive: shrinks to icon-only on small screens.
 * - AR/EN aware.
 */
export function SyncStatusPill() {
  const { lang } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [lastSync, setLast] = useState<number | null>(null);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [, force] = useState(0);

  useEffect(() => {
    setMounted(true);
    setOnline(navigator.onLine);
    let alive = true;
    const refresh = async () => {
      if (!alive) return;
      setLast(getLastSync());
      setPending(await getPendingCount());
    };
    refresh();
    const onSync = () => refresh();
    const onOutbox = () => refresh();
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("app:last-sync", onSync);
    window.addEventListener("app:sync-success", onSync);
    window.addEventListener("app:outbox-changed", onOutbox);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    // Re-render every 10s so relative time stays fresh
    const tick = setInterval(() => force((n) => n + 1), 10_000);
    const refreshIv = setInterval(refresh, 15_000);
    return () => {
      alive = false;
      window.removeEventListener("app:last-sync", onSync);
      window.removeEventListener("app:sync-success", onSync);
      window.removeEventListener("app:outbox-changed", onOutbox);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(tick);
      clearInterval(refreshIv);
    };
  }, []);

  const effectiveOnline = online;
  const Icon = useMemo(() => (!effectiveOnline ? CloudOff : pending > 0 ? CloudUpload : Cloud), [effectiveOnline, pending]);
  if (!mounted) return null;
  const tone = !effectiveOnline
    ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
    : pending > 0
    ? "border-sky-500/40 bg-sky-500/15 text-sky-200"
    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";

  const labelMain = !effectiveOnline
    ? lang === "ar" ? "غير متصل" : "Offline"
    : pending > 0
    ? lang === "ar" ? `${pending} قيد الرفع` : `${pending} pending`
    : lang === "ar" ? "متزامن" : "Synced";

  const tip = lang === "ar"
    ? `آخر مزامنة: ${formatRelativeTime(lastSync, "ar")}`
    : `Last sync: ${formatRelativeTime(lastSync, "en")}`;

  const href = pending > 0 ? "/pending-operations" : "/diagnostics";

  return (
    <Link
      to={href}
      title={tip}
      aria-label={tip}
      className={`no-print fixed bottom-3 z-40 flex items-center gap-1.5 rounded-full border ${tone} px-2.5 py-1 text-[10px] font-medium shadow-md backdrop-blur transition hover:scale-105 hover:shadow-lg sm:bottom-4 sm:text-[11px] ${
        // bottom-end so it sits opposite the chat/help in both LTR & RTL
        "end-3 sm:end-4"
      }`}
      style={{ insetInlineEnd: "0.75rem" }}
    >
      {pending > 0 && effectiveOnline ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      <span className="hidden sm:inline">{labelMain}</span>
      <span className="text-foreground/55 hidden md:inline">·</span>
      <span className="hidden md:inline text-[10px] opacity-80">
        {formatRelativeTime(lastSync, lang as any)}
      </span>
    </Link>
  );
}
