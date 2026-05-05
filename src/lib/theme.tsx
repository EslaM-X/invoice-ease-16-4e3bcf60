import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

type Theme = "light" | "dark";
export type AccentPreset = "gold" | "rose" | "emerald" | "sapphire" | "obsidian";

const ACCENTS: Record<AccentPreset, { accent: string; ring: string; label: string; swatch: string }> = {
  gold:     { accent: "oklch(0.78 0.11 82)",  ring: "oklch(0.72 0.12 82)",  label: "ذهبي شامبانيا", swatch: "#d4b370" },
  rose:     { accent: "oklch(0.72 0.14 18)",  ring: "oklch(0.66 0.15 18)",  label: "وردي نحاسي",    swatch: "#d97485" },
  emerald:  { accent: "oklch(0.68 0.13 158)", ring: "oklch(0.62 0.14 158)", label: "زمردي",         swatch: "#42b48a" },
  sapphire: { accent: "oklch(0.62 0.14 250)", ring: "oklch(0.56 0.15 250)", label: "أزرق ملكي",     swatch: "#5b7cd6" },
  obsidian: { accent: "oklch(0.45 0.02 60)",  ring: "oklch(0.4 0.02 60)",   label: "رمادي معدني",   swatch: "#6b6b6b" },
};

export const ACCENT_PRESETS = ACCENTS;

type Ctx = {
  theme: Theme; setTheme: (t: Theme) => void; toggle: () => void;
  accent: AccentPreset; setAccent: (a: AccentPreset) => void;
  syncing: boolean;
};

const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [accent, setAccentState] = useState<AccentPreset>("gold");
  const [syncing, setSyncing] = useState(false);
  const hydratedRef = useRef(false);

  // Initial: localStorage (fast paint)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("theme") as Theme | null;
    const initial: Theme = stored ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setThemeState(initial);
    const a = localStorage.getItem("accent") as AccentPreset | null;
    if (a && ACCENTS[a]) setAccentState(a);
  }, []);

  // Then hydrate from Supabase profile (overrides if present)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) { hydratedRef.current = true; return; }
        const { data } = await supabase
          .from("profiles")
          .select("theme_preference, accent_preference")
          .eq("user_id", user.id)
          .maybeSingle();
        if (cancelled) return;
        if (data?.theme_preference === "dark" || data?.theme_preference === "light") {
          setThemeState(data.theme_preference);
          localStorage.setItem("theme", data.theme_preference);
        }
        const a = data?.accent_preference as AccentPreset | undefined;
        if (a && ACCENTS[a]) {
          setAccentState(a);
          localStorage.setItem("accent", a);
        }
      } catch (e) {
        console.warn("[theme] hydrate failed", e);
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const c = ACCENTS[accent];
    document.documentElement.style.setProperty("--accent", c.accent);
    document.documentElement.style.setProperty("--ring", c.ring);
  }, [accent]);

  const persist = async (patch: { theme_preference?: Theme; accent_preference?: AccentPreset }) => {
    try {
      setSyncing(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("profiles").update(patch).eq("user_id", user.id);
    } catch (e) {
      console.warn("[theme] persist failed", e);
    } finally {
      setSyncing(false);
    }
  };

  const setTheme = (t: Theme) => {
    setThemeState(t);
    if (typeof window !== "undefined") localStorage.setItem("theme", t);
    void persist({ theme_preference: t });
  };
  const setAccent = (a: AccentPreset) => {
    setAccentState(a);
    if (typeof window !== "undefined") localStorage.setItem("accent", a);
    void persist({ accent_preference: a });
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark"), accent, setAccent, syncing }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be inside ThemeProvider");
  return ctx;
}
