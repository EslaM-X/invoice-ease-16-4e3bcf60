import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { clearPwaLog, readPwaLog, type PwaLogEntry } from "@/lib/pwa-diagnostics";

export const Route = createFileRoute("/diagnostics")({
  component: DiagnosticsPage,
  head: () => ({
    meta: [
      { title: "Diagnostics — Steinheim Suite" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function levelColor(level: PwaLogEntry["level"]) {
  if (level === "error") return "text-red-500";
  if (level === "warn") return "text-amber-500";
  return "text-muted-foreground";
}

function DiagnosticsPage() {
  const [entries, setEntries] = useState<PwaLogEntry[]>([]);
  const [now, setNow] = useState(Date.now());

  const refresh = () => setEntries(readPwaLog().slice().reverse());

  useEffect(() => {
    refresh();
    const interval = setInterval(() => {
      setNow(Date.now());
      refresh();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleClear = () => {
    clearPwaLog();
    refresh();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground" dir="ltr">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">PWA Diagnostics</h1>
            <p className="text-sm text-muted-foreground">
              آخر {entries.length} حدث للـ Service Worker والكاش — يُحدَّث تلقائيًا.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={refresh}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Refresh
            </button>
            <button
              onClick={handleCopy}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Copy JSON
            </button>
            <button
              onClick={handleClear}
              className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10"
            >
              Clear
            </button>
            <Link
              to="/"
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
            >
              Home
            </Link>
          </div>
        </div>

        <div className="mb-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
          <div>URL: {typeof window !== "undefined" ? window.location.href : "—"}</div>
          <div>UA: {typeof navigator !== "undefined" ? navigator.userAgent : "—"}</div>
          <div>Now: {new Date(now).toISOString()}</div>
        </div>

        {entries.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            لا توجد سجلات بعد. أعد تحميل الصفحة الرئيسية لتسجيل أحداث PWA.
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry, i) => (
              <li
                key={`${entry.ts}-${i}`}
                className="rounded-md border border-border bg-card p-3 font-mono text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-semibold ${levelColor(entry.level)}`}>
                    [{entry.level.toUpperCase()}] {entry.event}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(entry.ts).toISOString()}
                  </span>
                </div>
                {entry.detail && (
                  <pre className="mt-1 whitespace-pre-wrap break-all text-muted-foreground">
                    {entry.detail}
                  </pre>
                )}
                {entry.url && (
                  <div className="mt-1 truncate text-muted-foreground/80">{entry.url}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
