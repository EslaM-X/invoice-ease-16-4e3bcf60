import { useEffect, useState } from "react";
import {
  PWA_ASSET_VERSION,
  fetchLatestVersion,
  readVersionState,
  subscribeVersionState,
  type PwaVersionState,
} from "@/lib/pwa-version";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";

function formatTime(ts: number | null, lang: string): string {
  if (!ts) return "—";
  try {
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-US", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString();
  }
}

function timeAgo(ts: number | null, lang: string): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const sec = Math.max(1, Math.floor(diff / 1000));
  if (sec < 60) return lang === "ar" ? `منذ ${sec} ثانية` : `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return lang === "ar" ? `منذ ${min} دقيقة` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return lang === "ar" ? `منذ ${hr} ساعة` : `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return lang === "ar" ? `منذ ${day} يوم` : `${day}d ago`;
}

export function PwaDiagnosticsPanel() {
  const { t, lang } = useI18n();
  const [state, setState] = useState<PwaVersionState>(() => readVersionState());
  const [checking, setChecking] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => subscribeVersionState(setState), []);
  useEffect(() => {
    // Repaint relative timestamps every 10s.
    const id = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const runCheck = async () => {
    setChecking(true);
    try {
      // Ask the active SW for its version, and check the server for a newer one.
      navigator.serviceWorker?.controller?.postMessage({ type: "PING" });
      const reg = await navigator.serviceWorker?.getRegistration?.();
      await Promise.all([reg?.update?.(), fetchLatestVersion()]);
    } finally {
      setChecking(false);
    }
  };

  const pending = state.updatePending;
  const currentLabel = lang === "ar" ? "النسخة الحالية" : "Current version";
  const latestLabel = lang === "ar" ? "آخر نسخة مكتشفة" : "Latest detected";
  const lastCheckLabel = lang === "ar" ? "آخر تحقق" : "Last checked";
  const activatedLabel = lang === "ar" ? "آخر تنشيط" : "Last activated";
  const assetLabel = lang === "ar" ? "إصدار الأصول" : "Asset build tag";

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{lang === "ar" ? "تشخيص النسخة" : "Version diagnostics"}</h3>
          <p className="text-xs text-muted-foreground">
            {lang === "ar"
              ? "يعرض النسخة الفعّالة على هذا الجهاز وآخر نسخة نشرتها. مفيد لمعرفة إن كان التحديث وصل."
              : "Shows what version this device is running vs the latest deploy so you can confirm updates land."}
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-2 rounded-full" onClick={runCheck} disabled={checking}>
          <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
          {lang === "ar" ? "تحقق الآن" : "Check now"}
        </Button>
      </div>

      <div
        className={`mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
          pending
            ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        }`}
      >
        {pending ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        <span>
          {pending
            ? lang === "ar"
              ? "توجد نسخة أحدث — سيتم التحديث تلقائيًا خلال ثوانٍ."
              : "A newer version is waiting — it will apply automatically in seconds."
            : lang === "ar"
              ? "الجهاز يعمل بأحدث نسخة."
              : "This device is on the latest version."}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <Row label={currentLabel} value={state.currentVersion ?? "—"} mono />
        <Row label={latestLabel} value={state.latestVersion ?? "—"} mono />
        <Row label={assetLabel} value={PWA_ASSET_VERSION} mono />
        <Row
          label={lastCheckLabel}
          value={`${timeAgo(state.lastCheckedAt, lang)} · ${formatTime(state.lastCheckedAt, lang)}`}
        />
        <Row
          label={activatedLabel}
          value={`${timeAgo(state.lastActivatedAt, lang)} · ${formatTime(state.lastActivatedAt, lang)}`}
        />
      </dl>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border bg-background/40 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`truncate ${mono ? "font-mono text-xs" : ""}`} dir="ltr" title={value}>
        {value}
      </dd>
    </div>
  );
}
