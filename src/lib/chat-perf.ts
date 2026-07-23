// Lightweight perf profiler for chat interactions.
// Enable in the browser console with: localStorage.chat_perf = "1"
// Then in dev-tools you'll see grouped timings and Performance API marks.

const ENABLED_KEY = "chat_perf";
const enabled = (): boolean => {
  try {
    return typeof window !== "undefined" && window.localStorage?.getItem(ENABLED_KEY) === "1";
  } catch { return false; }
};

type Sample = { count: number; total: number; max: number };
const rolling = new Map<string, Sample>();
let flushTimer: number | null = null;

function scheduleFlush() {
  if (typeof window === "undefined") return;
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    if (!enabled() || rolling.size === 0) return;
    // eslint-disable-next-line no-console
    console.groupCollapsed(`%c[chat-perf] ${rolling.size} metric(s)`, "color:#d4af37;font-weight:bold");
    for (const [k, s] of rolling) {
      const avg = s.total / s.count;
      // eslint-disable-next-line no-console
      console.log(`${k}: avg=${avg.toFixed(2)}ms  max=${s.max.toFixed(2)}ms  n=${s.count}`);
    }
    // eslint-disable-next-line no-console
    console.groupEnd();
    rolling.clear();
  }, 2000);
}

/** Measure a synchronous block. Returns whatever the fn returns. */
export function measure<T>(name: string, fn: () => T): T {
  if (!enabled()) return fn();
  const t0 = performance.now();
  try { return fn(); } finally {
    const dt = performance.now() - t0;
    const s = rolling.get(name) ?? { count: 0, total: 0, max: 0 };
    s.count += 1; s.total += dt; if (dt > s.max) s.max = dt;
    rolling.set(name, s);
    try { performance.mark(`${name}:${t0.toFixed(0)}`); } catch { /* ignore */ }
    scheduleFlush();
  }
}

/** Record a raw duration in ms. */
export function record(name: string, ms: number): void {
  if (!enabled()) return;
  const s = rolling.get(name) ?? { count: 0, total: 0, max: 0 };
  s.count += 1; s.total += ms; if (ms > s.max) s.max = ms;
  rolling.set(name, s);
  scheduleFlush();
}

/** Frame-budget helper: returns true when the given fn ran within one frame. */
export function withinFrameBudget<T>(name: string, budgetMs: number, fn: () => T): T {
  if (!enabled()) return fn();
  const out = measure(name, fn);
  const s = rolling.get(name);
  if (s && s.max > budgetMs) {
    // eslint-disable-next-line no-console
    console.warn(`[chat-perf] ${name} exceeded ${budgetMs}ms budget (max=${s.max.toFixed(1)}ms)`);
  }
  return out;
}

export function isPerfEnabled(): boolean { return enabled(); }
