// Lightweight PWA / Service Worker diagnostic log.
// Stores the last N events in localStorage so they survive reloads and can
// be inspected from any device by opening /diagnostics.

export type PwaLogLevel = "info" | "warn" | "error";

export interface PwaLogEntry {
  ts: number;
  level: PwaLogLevel;
  event: string;
  detail?: string;
  url?: string;
  ua?: string;
}

const STORAGE_KEY = "pwa_diagnostics_log_v1";
const MAX_ENTRIES = 100;

function safeStringify(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function readPwaLog(): PwaLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearPwaLog() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function logPwaEvent(level: PwaLogLevel, event: string, detail?: unknown) {
  if (typeof window === "undefined") return;
  try {
    const entries = readPwaLog();
    entries.push({
      ts: Date.now(),
      level,
      event,
      detail: safeStringify(detail),
      url: window.location.href,
      ua: window.navigator.userAgent,
    });
    const trimmed = entries.slice(-MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore quota / privacy errors */
  }
}
