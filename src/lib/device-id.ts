/**
 * Stable per-browser/per-device identifier stored in localStorage.
 * Used to remember once-and-for-all which devices have already granted
 * push permission, so the mandatory banner never re-prompts on the same
 * device unless the browser state actually changed.
 */
const KEY_DEVICE = "lovable_device_id_v1";
const KEY_PUSH = "lovable_push_enabled_v1";

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(KEY_DEVICE);
    if (!id) {
      id =
        (crypto as any)?.randomUUID?.() ??
        `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(KEY_DEVICE, id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

export function getDeviceLabel(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  const platform =
    (navigator as any).userAgentData?.platform ||
    (navigator as any).platform ||
    "";
  // e.g. "Chrome 128 · macOS"
  const browser =
    /Edg\/(\d+)/.exec(ua)?.[0] ??
    /OPR\/(\d+)/.exec(ua)?.[0] ??
    /Chrome\/(\d+)/.exec(ua)?.[0] ??
    /Firefox\/(\d+)/.exec(ua)?.[0] ??
    /Version\/(\d+).*Safari/.exec(ua)?.[0] ??
    "Browser";
  return `${browser} · ${platform || "Web"}`;
}

export type LocalPushRecord = {
  enabled_at: string;
  endpoint: string;
  device_id: string;
};

export function readLocalPush(): LocalPushRecord | null {
  try {
    const raw = localStorage.getItem(KEY_PUSH);
    if (!raw) return null;
    return JSON.parse(raw) as LocalPushRecord;
  } catch {
    return null;
  }
}

export function writeLocalPush(rec: LocalPushRecord) {
  try {
    localStorage.setItem(KEY_PUSH, JSON.stringify(rec));
  } catch { /* ignore */ }
}

export function clearLocalPush() {
  try {
    localStorage.removeItem(KEY_PUSH);
  } catch { /* ignore */ }
}
