import { useEffect, useState } from "react";
import { Activity, X } from "lucide-react";
import {
  isPerfEnabled,
  setPerfEnabled,
  subscribePerf,
  type PerfSample,
} from "@/lib/chat-perf";

/**
 * Floating in-app profiler toggle for chat.
 * - Persists the enabled state in localStorage (same key as chat-perf).
 * - Shows a small overlay with the top metrics (avg / max / n).
 * - Zero cost when disabled: doesn't subscribe or render the overlay body.
 */
export function ChatPerfOverlay() {
  const [enabled, setEnabled] = useState<boolean>(() => isPerfEnabled());
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Array<[string, PerfSample]>>([]);

  useEffect(() => {
    if (!enabled) return;
    const unsub = subscribePerf((snap) => {
      const list = Array.from(snap.entries())
        .sort((a, b) => b[1].max - a[1].max)
        .slice(0, 8);
      setRows(list);
    });
    return unsub;
  }, [enabled]);

  const toggle = () => {
    const next = !enabled;
    setPerfEnabled(next);
    setEnabled(next);
    if (next) setOpen(true);
    else setRows([]);
  };

  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-[60] flex flex-col items-start gap-2 sm:bottom-4 sm:left-4">
      {enabled && open && (
        <div className="pointer-events-auto max-w-[calc(100vw-24px)] rounded-xl border border-white/10 bg-black/85 p-3 font-mono text-[11px] text-white shadow-2xl backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="font-sans text-xs font-semibold text-[#d4af37]">chat-perf</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white"
              aria-label="Hide"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {rows.length === 0 ? (
            <div className="text-white/50">no samples yet — interact with the chat…</div>
          ) : (
            <table className="w-full min-w-[240px] border-separate border-spacing-y-0.5">
              <thead>
                <tr className="text-white/40">
                  <th className="text-start font-normal">metric</th>
                  <th className="text-end font-normal">avg</th>
                  <th className="text-end font-normal">max</th>
                  <th className="text-end font-normal">n</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([name, s]) => {
                  const avg = s.total / Math.max(1, s.count);
                  const hot = s.max > 16;
                  return (
                    <tr key={name} className={hot ? "text-amber-300" : "text-white/90"}>
                      <td className="truncate pr-2" title={name}>{name}</td>
                      <td className="text-end tabular-nums">{avg.toFixed(1)}</td>
                      <td className="text-end tabular-nums">{s.max.toFixed(1)}</td>
                      <td className="text-end tabular-nums">{s.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={enabled ? () => setOpen((o) => !o) : toggle}
        onDoubleClick={toggle}
        className={`pointer-events-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-lg backdrop-blur transition-colors ${
          enabled
            ? "border-[#d4af37]/40 bg-black/70 text-[#d4af37] hover:bg-black/85"
            : "border-white/15 bg-black/50 text-white/70 hover:bg-black/70"
        }`}
        title={enabled ? "Perf on — click to toggle overlay, double-click to disable" : "Enable chat perf profiling"}
      >
        <Activity className="h-3 w-3" />
        {enabled ? "perf" : "perf off"}
      </button>
    </div>
  );
}

export default ChatPerfOverlay;
