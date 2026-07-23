// Lightweight perf profiler for chat interactions.
// Enable via the in-app overlay (see ChatPerfOverlay) or in the console with:
//   localStorage.chat_perf = "1"

const ENABLED_KEY = "chat_perf";

const enabledFromStorage = (): boolean => {
  try {
    return typeof window !== "undefined" && window.localStorage?.getItem(ENABLED_KEY) === "1";
  } catch { return false; }
};

let enabledCache: boolean | null = null;
const enabled = (): boolean => {
  if (enabledCache !== null) return enabledCache;
  enabledCache = enabledFromStorage();
  return enabledCache;
};

/** Toggle profiling on/off at runtime. Persists across reloads. */
export function setPerfEnabled(next: boolean): void {
  enabledCache = next;
  try {
    if (typeof window !== "undefined") {
      if (next) window.localStorage?.setItem(ENABLED_KEY, "1");
      else window.localStorage?.removeItem(ENABLED_KEY);
    }
  } catch { /* ignore */ }
  if (!next) {
    rolling.clear();
    notify();
  }
}

export type PerfSample = { count: number; total: number; max: number };
const rolling = new Map<string, PerfSample>();
let flushTimer: number | null = null;

type Listener = (snapshot: Map<string, PerfSample>) => void;
const listeners = new Set<Listener>();

function notify() {
  const snap = new Map(rolling);
  for (const cb of listeners) {
    try { cb(snap); } catch { /* ignore listener errors */ }
  }
}

/** Subscribe to live perf updates for UI overlays. Returns an unsubscribe fn. */
export function subscribePerf(cb: Listener): () => void {
  listeners.add(cb);
  cb(new Map(rolling));
  return () => { listeners.delete(cb); };
}

/** Snapshot the current rolling metrics. */
export function getPerfSnapshot(): Map<string, PerfSample> {
  return new Map(rolling);
}

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
    notify();
    // Keep the samples so the overlay can display them; clear after 8s of quiet
    window.setTimeout(() => { if (flushTimer == null) { rolling.clear(); notify(); } }, 8000);
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
