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
  const [rtStatus, setRtStatus] = useState<"live" | "reconnecting" | "failed">("live");
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
    // Realtime health, emitted by the subscription layer in @/lib/realtime.
    const onRealtime = (e: Event) => {
      const status = (e as CustomEvent).detail?.status as string | undefined;
      if (status === "reconnecting") setRtStatus("reconnecting");
      else if (status === "failed") setRtStatus("failed");
      else if (status === "reconnected") setRtStatus("live");
    };
    window.addEventListener("app:last-sync", onSync);
    window.addEventListener("app:sync-success", onSync);
    window.addEventListener("app:outbox-changed", onOutbox);
    window.addEventListener("app:realtime-status", onRealtime as EventListener);
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
      window.removeEventListener("app:realtime-status", onRealtime as EventListener);
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
      className={`no-print fixed bottom-1 z-40 flex items-center gap-[2px] rounded-full border ${tone} px-[3px] py-[1px] text-[6px] font-medium shadow-sm backdrop-blur transition hover:scale-105 hover:shadow-md sm:bottom-1.5 sm:gap-0.5 sm:px-1 sm:py-[2px] sm:text-[7px] md:text-[8px]`}
      style={{ insetInlineEnd: "0.25rem" }}
    >
      {pending > 0 && effectiveOnline ? (
        <Loader2 className="h-1.5 w-1.5 sm:h-2 sm:w-2 animate-spin" />
      ) : (
        <Icon className="h-1.5 w-1.5 sm:h-2 sm:w-2" />
      )}
      <span className="hidden md:inline">{labelMain}</span>
      <span className="text-foreground/55 hidden xl:inline">·</span>
      <span className="hidden xl:inline text-[7px] opacity-80">
        {formatRelativeTime(lastSync, lang as any)}
      </span>
    </Link>
  );
}
