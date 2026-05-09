import { useEffect, useState } from "react";
import {
  bumpEntryCount,
  shouldShowLuxurySplash,
  markLuxurySplashShown,
} from "@/lib/entry-counter";

/**
 * Luxury splash screen — appears after the user has opened the app more
 * than 5 times. Black background with silver/platinum logo type and a
 * shimmer sweep. Self-dismisses after ~2.4s. Tap to skip.
 */
export function LuxurySplash() {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    bumpEntryCount();
    if (!shouldShowLuxurySplash()) return;
    markLuxurySplashShown();
    setVisible(true);
    const t1 = window.setTimeout(() => setClosing(true), 2100);
    const t2 = window.setTimeout(() => setVisible(false), 2700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      role="presentation"
      onClick={() => {
        setClosing(true);
        setTimeout(() => setVisible(false), 500);
      }}
      className="fixed inset-0 z-[9999] flex items-center justify-center cursor-pointer select-none"
      style={{
        background:
          "radial-gradient(ellipse at center, #1a1a1c 0%, #0a0a0b 55%, #000 100%)",
        animation: closing
          ? "lux-fade-out 500ms cubic-bezier(0.22, 1, 0.36, 1) forwards"
          : "lux-fade-in 600ms cubic-bezier(0.22, 1, 0.36, 1) both",
      }}
    >
      {/* faint silver vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 30%, rgba(220,225,235,0.08), transparent 70%)",
        }}
      />

      {/* corner hairlines */}
      <div className="pointer-events-none absolute inset-6 border border-white/[0.06] rounded-sm" />

      <div className="relative flex flex-col items-center gap-6 px-8">
        {/* eyebrow */}
        <span
          className="text-[0.7rem] tracking-[0.5em] font-medium"
          style={{
            color: "rgba(220,225,235,0.55)",
            animation: "lux-rise 700ms 80ms cubic-bezier(0.22,1,0.36,1) both",
          }}
        >
          MAISON · EST. 2024
        </span>

        {/* wordmark */}
        <h1
          className="font-display text-center"
          style={{
            fontSize: "clamp(2.6rem, 7vw, 5.5rem)",
            lineHeight: 1,
            letterSpacing: "-0.02em",
            fontWeight: 500,
            background:
              "linear-gradient(135deg, #ffffff 0%, #d8dde4 35%, #8a8f99 55%, #f4f6f9 75%, #b8bdc6 100%)",
            backgroundSize: "200% 100%",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            WebkitTextFillColor: "transparent",
            animation:
              "lux-rise 900ms 150ms cubic-bezier(0.22,1,0.36,1) both, lux-shimmer 2.6s 400ms ease-in-out 1",
            filter:
              "drop-shadow(0 4px 30px rgba(255,255,255,0.08)) drop-shadow(0 0 1px rgba(255,255,255,0.25))",
          }}
        >
          STEINHEIM
        </h1>

        {/* silver hairline */}
        <div
          className="h-px w-40"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(220,225,235,0.7), transparent)",
            animation:
              "lux-line 1100ms 350ms cubic-bezier(0.22,1,0.36,1) both",
          }}
        />

        {/* sub-tagline */}
        <p
          className="text-center"
          style={{
            color: "rgba(220,225,235,0.65)",
            fontSize: "0.78rem",
            letterSpacing: "0.35em",
            textTransform: "uppercase",
            animation: "lux-rise 900ms 500ms cubic-bezier(0.22,1,0.36,1) both",
          }}
        >
          SUITE · LUXURY MANAGEMENT
        </p>
      </div>

      {/* loading dot */}
      <div
        className="absolute bottom-12 left-1/2 -translate-x-1/2 flex gap-1.5"
        style={{
          animation: "lux-rise 900ms 700ms cubic-bezier(0.22,1,0.36,1) both",
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block h-1 w-1 rounded-full"
            style={{
              background: "rgba(220,225,235,0.6)",
              animation: `lux-dot 1.2s ${i * 180}ms ease-in-out infinite`,
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes lux-fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes lux-fade-out { from { opacity: 1 } to { opacity: 0 } }
        @keyframes lux-rise {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes lux-line {
          from { opacity: 0; transform: scaleX(0.2); }
          to { opacity: 1; transform: scaleX(1); }
        }
        @keyframes lux-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes lux-dot {
          0%, 100% { opacity: 0.25; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-3px); }
        }
        @media (prefers-reduced-motion: reduce) {
          [role="presentation"] *, [role="presentation"] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
