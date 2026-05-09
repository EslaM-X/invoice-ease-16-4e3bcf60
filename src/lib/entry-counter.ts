// Tracks how many times the user opened the app, and decides when
// the luxury splash should be shown (after 5+ opens, once per session).

const COUNT_KEY = "steinheim_entry_count";
const SESSION_KEY = "steinheim_splash_session_shown";
const THRESHOLD = 5;

export function bumpEntryCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    const cur = Number(localStorage.getItem(COUNT_KEY) || "0") || 0;
    const next = cur + 1;
    localStorage.setItem(COUNT_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

export function shouldShowLuxurySplash(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const count = Number(localStorage.getItem(COUNT_KEY) || "0") || 0;
    if (count <= THRESHOLD) return false;
    // once per browser tab session
    if (sessionStorage.getItem(SESSION_KEY) === "1") return false;
    return true;
  } catch {
    return false;
  }
}

export function markLuxurySplashShown() {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* noop */
  }
}
