import { useTheme, ACCENT_PRESETS, type AccentPreset } from "@/lib/theme";
import { Sun, Moon, Check } from "lucide-react";

export function AppearanceSettings() {
  const { theme, toggle, accent, setAccent } = useTheme();
  return (
    <div className="card-premium rounded-2xl border bg-card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold">المظهر والثيم</h3>
        <button
          onClick={toggle}
          className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs hover:bg-accent/40"
          aria-label="toggle theme"
        >
          {theme === "dark" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
          <span>{theme === "dark" ? "ليلي" : "نهاري"}</span>
        </button>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">يتم الحفظ تلقائيًا لهذا المتصفح وتجاوز كل الجلسات.</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(Object.keys(ACCENT_PRESETS) as AccentPreset[]).map((key) => {
          const c = ACCENT_PRESETS[key];
          const active = accent === key;
          return (
            <button
              key={key}
              onClick={() => setAccent(key)}
              className={`group flex flex-col items-center gap-2 rounded-xl border p-3 transition tap-scale ${
                active ? "border-primary/60 bg-accent/10 shadow-sm" : "hover:bg-accent/5"
              }`}
              aria-pressed={active}
            >
              <span
                className="relative h-8 w-8 rounded-full ring-1 ring-border"
                style={{ background: c.swatch }}
              >
                {active && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <Check className="h-4 w-4 text-white drop-shadow" />
                  </span>
                )}
              </span>
              <span className="text-[11px] font-medium">{c.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
