import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Languages, Moon, Sun, FileText, ScanLine, Boxes, BarChart3, ArrowLeft, ArrowRight } from "lucide-react";
import steinheimLogo from "@/assets/steinheim-logo.png";

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
    <div className="min-h-screen bg-background gradient-mesh">
      <header className="sticky top-0 z-30 glass border-b border-border/40">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2.5">
            <img src={steinheimLogo} alt="Steinheim" className="h-8 w-auto max-w-[120px] object-contain" />
            <span className="text-sm font-semibold tracking-tight">{t("app_name")}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" onClick={() => setLang(lang === "ar" ? "en" : "ar")}><Languages className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" onClick={toggle}>{theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button>
            <Link to="/auth"><Button size="sm" className="rounded-full px-4">{t("login")}</Button></Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 pt-16 pb-20 text-center sm:pt-24 sm:pb-24">
        <div
          className="animate-hero-up mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3.5 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur sm:mb-8"
          style={{ animationDelay: "0ms" }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          {lang === "ar" ? "إنشاء فاتورة في أقل من ٣٠ ثانية" : "Create an invoice in under 30 seconds"}
        </div>
        <h1 className="text-balance text-5xl leading-[1.05] tracking-tight sm:text-7xl md:text-8xl lg:text-[8.5rem]">
          <span
            className="animate-hero-title font-display inline-block bg-clip-text text-transparent"
            style={{
              animationDelay: "120ms",
              backgroundImage: "linear-gradient(135deg, var(--foreground) 0%, var(--brand-gold-deep) 60%, var(--brand-gold) 100%)",
            }}
          >
            Steinheim
          </span>
        </h1>
        <p
          className="animate-hero-up mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:mt-6 sm:text-lg"
          style={{ animationDelay: "320ms" }}
        >
          {t("hero_subtitle")}
        </p>
        <div
          className="animate-hero-up mt-8 flex items-center justify-center gap-3 sm:mt-10"
          style={{ animationDelay: "460ms" }}
        >
          <Link to="/auth">
            <Button size="lg" className="gap-2 rounded-full px-7 shadow-glow">
              {t("signup")} <Arrow className="h-4 w-4" />
            </Button>
          </Link>
        </div>

        <div className="mx-auto mt-20 grid max-w-4xl gap-3 sm:mt-24 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { Icon: FileText, label: lang === "ar" ? "فواتير ذكية" : "Smart invoices" },
            { Icon: ScanLine, label: lang === "ar" ? "مسح QR" : "QR scanning" },
            { Icon: Boxes, label: lang === "ar" ? "مخزون فوري" : "Live inventory" },
            { Icon: BarChart3, label: lang === "ar" ? "تقارير" : "Reports" },
          ].map(({ Icon, label }, i) => (
            <div
              key={label}
              className="animate-hero-up group rounded-2xl border border-border/60 bg-card/60 p-5 text-start backdrop-blur transition hover:border-border hover:shadow-md"
              style={{ animationDelay: `${600 + i * 90}ms` }}
            >
              <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div className="text-sm font-semibold">{label}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
