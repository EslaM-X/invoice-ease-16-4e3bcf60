import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Languages, Moon, Sun, FileText, ScanLine, Boxes, BarChart3, ArrowLeft, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({ component: Landing });

function Landing() {
  const { user, loading } = useAuth();
  const { t, lang, setLang, dir } = useI18n();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate({ to: "/dashboard" });
  }, [loading, user, navigate]);

  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;

  return (
    <div className="min-h-screen gradient-subtle">
      <header className="flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-primary shadow-glow">
            <FileText className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-bold">{t("app_name")}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setLang(lang === "ar" ? "en" : "ar")}><Languages className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={toggle}>{theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button>
          <Link to="/auth"><Button>{t("login")}</Button></Link>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 pt-12 pb-20 text-center">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
          ✨ {lang === "ar" ? "نظام احترافي بـ ٣٠ ثانية لكل فاتورة" : "Pro invoicing under 30 seconds"}
        </div>
        <h1 className="text-balance text-4xl font-extrabold tracking-tight sm:text-6xl">
          {lang === "ar" ? "إدارة فواتيرك ومخزونك" : "Run invoicing & inventory"}
          <br />
          <span className="bg-gradient-to-l from-primary to-purple-500 bg-clip-text text-transparent">
            {lang === "ar" ? "بسرعة واحترافية" : "fast and beautifully"}
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">{t("hero_subtitle")}</p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link to="/auth">
            <Button size="lg" className="gap-2 shadow-glow">
              {t("signup")} <Arrow className="h-4 w-4" />
            </Button>
          </Link>
        </div>

        <div className="mx-auto mt-16 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { Icon: FileText, label: lang === "ar" ? "فواتير ذكية" : "Smart invoices" },
            { Icon: ScanLine, label: lang === "ar" ? "مسح QR" : "QR scanning" },
            { Icon: Boxes, label: lang === "ar" ? "مخزون فوري" : "Live inventory" },
            { Icon: BarChart3, label: lang === "ar" ? "تقارير ذكية" : "Reports & exports" },
          ].map(({ Icon, label }) => (
            <div key={label} className="rounded-2xl border bg-card p-5 text-start shadow-sm transition hover:shadow-md">
              <Icon className="mb-3 h-6 w-6 text-primary" />
              <div className="font-semibold">{label}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
