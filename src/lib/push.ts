// Public VAPID key (safe to expose). Matches VAPID_PRIVATE_KEY in secrets.
export const VAPID_PUBLIC_KEY =
  "BHumFqOZX7fwwzh_QV0I9Tj0ku0MdXV23IWNtrezc-MFeoD8PJhRoX8dkXbHC0b3CLKGjBOWIawo-okPLjKmBjg";

export const SOUND_PRESETS = [
  { value: "default", label: "افتراضي" },
  { value: "chime", label: "نغمة" },
  { value: "ding", label: "رنين خفيف" },
  { value: "alert", label: "تنبيه" },
  { value: "custom", label: "نغمة مخصصة من جهازي" },
  { value: "none", label: "بدون صوت" },
] as const;

export const VIBRATION_PRESETS = [
  { value: "default", label: "افتراضي" },
  { value: "short", label: "قصير" },
  { value: "long", label: "طويل" },
  { value: "pulse", label: "نبضات متتالية" },
  { value: "off", label: "بدون اهتزاز" },
] as const;

export type SoundPreset = (typeof SOUND_PRESETS)[number]["value"];
export type VibrationPreset = (typeof VIBRATION_PRESETS)[number]["value"];

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Play a custom uploaded ringtone (mp3/wav/ogg/m4a). Falls back silently on error.
export function playCustomSound(url: string, volume = 0.9): Promise<void> {
  return new Promise((resolve) => {
    if (!url || typeof window === "undefined") return resolve();
    try {
      const audio = new Audio(url);
      audio.volume = Math.min(1, Math.max(0, volume));
      audio.crossOrigin = "anonymous";
      audio.play().then(() => {
        audio.onended = () => resolve();
        // safety stop after 8s
        setTimeout(() => { try { audio.pause(); } catch {} resolve(); }, 8000);
      }).catch(() => resolve());
    } catch {
      resolve();
    }
  });
}

// Synthesize a short, pleasant alert with WebAudio — no audio assets needed.
export function playSoundPreset(preset: SoundPreset, customUrl?: string | null) {
  if (preset === "none" || typeof window === "undefined") return;
  if (preset === "custom" && customUrl) {
    void playCustomSound(customUrl);
    return;
  }
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    type Note = { f: number; t: number; d: number; type?: OscillatorType; vol?: number };
    const presets: Record<Exclude<SoundPreset, "none" | "custom">, Note[]> = {
      default: [
        { f: 880, t: 0, d: 0.12 },
        { f: 1320, t: 0.13, d: 0.18 },
      ],
      chime: [
        { f: 1046, t: 0, d: 0.18 },
        { f: 1318, t: 0.18, d: 0.18 },
        { f: 1568, t: 0.36, d: 0.28 },
      ],
      ding: [
        { f: 1760, t: 0, d: 0.25, type: "sine" },
      ],
      alert: [
        { f: 740, t: 0, d: 0.12, type: "square", vol: 0.18 },
        { f: 740, t: 0.18, d: 0.12, type: "square", vol: 0.18 },
        { f: 740, t: 0.36, d: 0.18, type: "square", vol: 0.18 },
      ],
    };
    const notes = presets[preset as Exclude<SoundPreset, "none" | "custom">] ?? presets.default;
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type ?? "sine";
      osc.frequency.value = n.f;
      const vol = n.vol ?? 0.22;
      gain.gain.setValueAtTime(0, now + n.t);
      gain.gain.linearRampToValueAtTime(vol, now + n.t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + n.t);
      osc.stop(now + n.t + n.d + 0.02);
    }
    setTimeout(() => ctx.close(), 1500);
  } catch {
    // ignore audio errors (autoplay restrictions etc.)
  }
}
