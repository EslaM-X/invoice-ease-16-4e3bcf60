// Version registry — tracks the SW version currently controlling the page,
// the latest version detected on the server, and when we last checked.
// Powers the diagnostics panel in Settings.

const STORAGE_KEY = "pwa_version_state_v1";

export interface PwaVersionState {
  currentVersion: string | null;   // version reported by the active SW (PONG / SW_ACTIVATED)
  latestVersion: string | null;    // version parsed from /sw.js on last check
  lastCheckedAt: number | null;    // ms since epoch of last /sw.js fetch
  lastActivatedAt: number | null;  // ms since epoch of last SW activation
  updatePending: boolean;          // true when latest !== current
}

const DEFAULT_STATE: PwaVersionState = {
  currentVersion: null,
  latestVersion: null,
  lastCheckedAt: null,
  lastActivatedAt: null,
  updatePending: false,
};

const VERSION_REGEX = /SW_VERSION\s*=\s*["'`]([^"'`]+)["'`]/;

type Listener = (state: PwaVersionState) => void;
const listeners = new Set<Listener>();

function safeRead(): PwaVersionState {
  if (typeof window === "undefined") return { ...DEFAULT_STATE };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function safeWrite(state: PwaVersionState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / privacy errors */
  }
}

export function readVersionState(): PwaVersionState {
  return safeRead();
}

export function subscribeVersionState(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(patch: Partial<PwaVersionState>) {
  const next = { ...safeRead(), ...patch };
  next.updatePending = Boolean(
    next.currentVersion && next.latestVersion && next.currentVersion !== next.latestVersion,
  );
  safeWrite(next);
  listeners.forEach((l) => {
    try { l(next); } catch { /* ignore */ }
  });
}

export function recordCurrentVersion(version: string | null) {
  if (!version) return;
  update({ currentVersion: version });
}

export function recordActivation(version: string | null) {
  update({
    currentVersion: version ?? safeRead().currentVersion,
    lastActivatedAt: Date.now(),
  });
}

/**
 * Fetches /sw.js bypassing the HTTP cache and extracts SW_VERSION.
 * Returns the parsed version string (or null on failure) and updates state.
 */
export async function fetchLatestVersion(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const cacheBuster = Date.now();
  try {
    const res = await fetch(`/sw.js?cb=${cacheBuster}`, {
      cache: "no-store",
      credentials: "omit",
    });
    if (!res.ok) {
      update({ lastCheckedAt: Date.now() });
      return null;
    }
    const text = await res.text();
    const match = text.match(VERSION_REGEX);
    const latest = match?.[1] ?? null;
    update({ latestVersion: latest, lastCheckedAt: Date.now() });
    return latest;
  } catch {
    update({ lastCheckedAt: Date.now() });
    return null;
  }
}
