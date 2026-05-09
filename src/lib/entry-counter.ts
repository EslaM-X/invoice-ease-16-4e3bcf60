// Controls when the luxury splash screen appears.
// 1) Once per browser tab session at first app open.
// 2) On demand (e.g. after 5+ wrong password attempts) via triggerLuxurySplash().

const SESSION_OPENED_KEY = "steinheim_session_splash_shown";
const PWD_FAIL_KEY = "steinheim_pwd_fail_count";
export const PWD_FAIL_THRESHOLD = 5;
export const LUXURY_SPLASH_EVENT = "steinheim:luxury-splash";

export function shouldShowOnSessionStart(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (sessionStorage.getItem(SESSION_OPENED_KEY) === "1") return false;
    sessionStorage.setItem(SESSION_OPENED_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export function triggerLuxurySplash() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LUXURY_SPLASH_EVENT));
}

export function bumpPasswordFailure(): number {
  if (typeof window === "undefined") return 0;
  try {
    const cur = Number(localStorage.getItem(PWD_FAIL_KEY) || "0") || 0;
    const next = cur + 1;
    localStorage.setItem(PWD_FAIL_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

export function resetPasswordFailures() {
  try {
    localStorage.removeItem(PWD_FAIL_KEY);
  } catch {
    /* noop */
  }
}
