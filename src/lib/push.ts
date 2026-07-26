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

/**
 * Play an iPhone-style ring loop (inspired by "Opening / Reflection" —
 * gentle marimba-like bells). Returns a stop function.
 *
 * Synthesized entirely with WebAudio (no audio assets, no licensed samples).
 * The pattern loops every ~3.6s and gracefully stops on demand.
 */
export function playIphoneRingLoop(): () => void {
  if (typeof window === "undefined") return () => {};
  let stopped = false;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let interval: number | null = null;

  const ensureCtx = () => {
    if (ctx) return ctx;
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
      if (!Ctx) return null;
      ctx = new Ctx();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      return ctx;
    } catch { return null; }
  };

  // A "bell" — FM-ish stack: fundamental + partial + short attack chirp.
  const bell = (freq: number, offset: number, dur: number, gain = 1) => {
    const c = ctx!;
    const t0 = c.currentTime + offset;
    const partials: Array<[number, number]> = [
      [freq, 0.5 * gain],
      [freq * 2.01, 0.28 * gain],
      [freq * 3.02, 0.13 * gain],
      [freq * 4.7, 0.08 * gain],
    ];
    for (const [f, amp] of partials) {
      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(amp, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(master!);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
  };

  // Melodic phrase reminiscent of the iPhone "Opening" arpeggio.
  // Notes (Hz): E5 G5 B5 E6 D6 B5 · E5 G5 B5 E6 — ascending, then a soft resolve.
  const phrase = () => {
    if (stopped || !ctx) return;
    const notes = [
      { f: 659.25, t: 0.00, d: 0.42, g: 0.9 }, // E5
      { f: 783.99, t: 0.16, d: 0.42, g: 0.9 }, // G5
      { f: 987.77, t: 0.32, d: 0.44, g: 0.95 }, // B5
      { f: 1318.5, t: 0.48, d: 0.60, g: 1.0 }, // E6
      { f: 1174.7, t: 0.90, d: 0.42, g: 0.85 }, // D6
      { f: 987.77, t: 1.06, d: 0.55, g: 0.85 }, // B5
      // second bar — softer
      { f: 659.25, t: 1.75, d: 0.36, g: 0.75 }, // E5
      { f: 987.77, t: 1.92, d: 0.36, g: 0.75 }, // B5
      { f: 1318.5, t: 2.10, d: 0.70, g: 0.90 }, // E6 (resolve)
    ];
    for (const n of notes) bell(n.f, n.t, n.d, n.g);
  };

  const start = () => {
    const c = ensureCtx();
    if (!c) return;
    // Some browsers start the context suspended until a gesture.
    if ((c as any).state === "suspended") { try { void c.resume(); } catch {} }
    phrase();
    interval = window.setInterval(phrase, 3600);
  };

  start();

  return () => {
    stopped = true;
    if (interval) window.clearInterval(interval);
    interval = null;
    try {
      if (master && ctx) {
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      }
      setTimeout(() => { try { ctx?.close(); } catch {} }, 300);
    } catch { /* ignore */ }
  };
}
