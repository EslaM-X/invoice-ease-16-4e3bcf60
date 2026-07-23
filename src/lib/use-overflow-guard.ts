import { useEffect, useRef, useState } from "react";

/**
 * Watches a scroll container (and the document) for unintended horizontal
 * overflow. Uses ResizeObserver with a debounce; when the container reports
 * scrollWidth > clientWidth + tolerance for N consecutive samples, it fires
 * `onBreach` and flips `breached` to true so callers can enter a simplified
 * fallback layout. Also logs viewport / container metrics for diagnosis.
 */
export function useOverflowGuard(
  ref: React.RefObject<HTMLElement | null>,
  opts: {
    label?: string;
    tolerance?: number;
    consecutive?: number;
    debounceMs?: number;
    onBreach?: (info: BreachInfo) => void;
    enabled?: boolean;
  } = {},
) {
  const {
    label = "team-chat",
    tolerance = 2,
    consecutive = 3,
    debounceMs = 150,
    onBreach,
    enabled = true,
  } = opts;
  const [breached, setBreached] = useState(false);
  const streakRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      try {
        const cw = el.clientWidth;
        const sw = el.scrollWidth;
        const docSw = document.documentElement.scrollWidth;
        const docCw = document.documentElement.clientWidth;
        const containerBad = sw - cw > tolerance;
        const docBad = docSw - docCw > tolerance;
        if (containerBad || docBad) {
          streakRef.current += 1;
          if (streakRef.current >= consecutive && !breached) {
            const info: BreachInfo = {
              label,
              containerScrollWidth: sw,
              containerClientWidth: cw,
              documentScrollWidth: docSw,
              documentClientWidth: docCw,
              viewport: {
                w: window.innerWidth,
                h: window.innerHeight,
                dpr: window.devicePixelRatio,
              },
              dir: (el.getAttribute("dir") as "rtl" | "ltr" | null) ?? null,
              at: new Date().toISOString(),
            };
            // eslint-disable-next-line no-console
            console.error(`[${label}] horizontal overflow breach`, info);
            setBreached(true);
            onBreach?.(info);
          }
        } else {
          streakRef.current = 0;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[${label}] overflow guard measure failed`, err);
      }
    };

    const schedule = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(measure, debounceMs);
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    ro.observe(document.documentElement);
    window.addEventListener("resize", schedule);
    schedule();

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [ref, label, tolerance, consecutive, debounceMs, onBreach, enabled, breached]);

  const reset = () => {
    streakRef.current = 0;
    setBreached(false);
  };

  return { breached, reset };
}

export type BreachInfo = {
  label: string;
  containerScrollWidth: number;
  containerClientWidth: number;
  documentScrollWidth: number;
  documentClientWidth: number;
  viewport: { w: number; h: number; dpr: number };
  dir: "rtl" | "ltr" | null;
  at: string;
};
