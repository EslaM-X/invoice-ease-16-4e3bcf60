import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/lib/theme";
import { Languages, Moon, Sun, Eye, EyeOff } from "lucide-react";
import brandLogo from "@/assets/steinheim-logo-white.png";
import { toast } from "sonner";
import { useEffect } from "react";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");

  const handleForgot = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success(lang === "ar" ? "تم إرسال رابط إعادة التعيين إلى بريدك" : "Reset link sent to your email");
      setForgotOpen(false);
      setForgotEmail("");
    } catch (err: any) {
      toast.error(err?.message ?? t("error_occurred"));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (user) navigate({ to: "/dashboard" });
  }, [user, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { full_name: name },
          },
        });
        if (error) throw error;
        toast.success(t("saved"));
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      toast.error(err?.message ?? t("error_occurred"));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    try {
      const res = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/dashboard`,
      });
      if (res.error) throw res.error;
    } catch (err: any) {
      toast.error(err?.message ?? t("error_occurred"));
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0b0b0c] text-[oklch(0.97_0.005_250)]">
      {/* Layered platinum background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(ellipse at 50% -10%, oklch(0.86 0.01 250 / 0.18) 0px, transparent 55%), radial-gradient(ellipse at 10% 110%, oklch(0.72 0.01 250 / 0.14) 0px, transparent 50%), radial-gradient(ellipse at 90% 90%, oklch(0.6 0.008 250 / 0.12) 0px, transparent 50%)" }} />
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "linear-gradient(oklch(0.86 0.01 250) 1px, transparent 1px), linear-gradient(90deg, oklch(0.86 0.01 250) 1px, transparent 1px)", backgroundSize: "56px 56px" }} />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[oklch(0.86_0.01_250_/_0.6)] to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[oklch(0.86_0.01_250_/_0.4)] to-transparent" />
      </div>

      <div className="absolute top-3 end-3 z-20 flex gap-2 no-print sm:top-4 sm:end-4">
        <Button variant="ghost" size="icon" className="text-white/90 hover:bg-white/10" onClick={() => setLang(lang === "ar" ? "en" : "ar")} aria-label="lang">
          <Languages className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="text-white/90 hover:bg-white/10" onClick={toggle} aria-label="theme">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>

      <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 items-center gap-8 px-4 py-12 sm:gap-10 sm:px-6 sm:py-14 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:px-10 lg:py-10">
        {/* Brand showcase */}
        <div className="order-1 flex flex-col items-center text-center lg:order-none lg:items-start lg:text-start">
          <div className="relative w-full max-w-sm sm:max-w-md lg:max-w-none">
            <div className="absolute -inset-8 rounded-full bg-[radial-gradient(circle,oklch(0.86_0.01_250_/_0.22),transparent_65%)] blur-2xl sm:-inset-10" />
            <div className="relative rounded-3xl border border-[oklch(0.86_0.01_250_/_0.22)] bg-gradient-to-b from-[#141416] to-[#0b0b0c] p-5 shadow-[0_30px_80px_-20px_oklch(0.86_0.01_250_/_0.28)] sm:p-7 lg:p-8">
              <div className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/5" />
              <div className="pointer-events-none absolute -top-px left-6 right-6 h-px bg-gradient-to-r from-transparent via-[oklch(0.86_0.01_250)] to-transparent" />
              <img
                src={brandLogo}
                alt="Steinheim"
                className="relative mx-auto h-32 w-auto select-none object-contain drop-shadow-[0_18px_50px_oklch(0.86_0.01_250_/_0.45)] sm:h-44 md:h-52 lg:h-64"
                draggable={false}
              />
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3 sm:mt-8">
            <span className="h-px w-8 bg-gradient-to-r from-transparent to-[oklch(0.86_0.01_250)] sm:w-10" />
            <p className="font-latin text-[10px] font-semibold uppercase tracking-[0.45em] text-[oklch(0.86_0.01_250)] sm:text-[11px] sm:tracking-[0.55em]">
              {lang === "ar" ? "منصة الموزعين" : "Distributors Platform"}
            </p>
            <span className="h-px w-8 bg-gradient-to-l from-transparent to-[oklch(0.86_0.01_250)] sm:w-10" />
          </div>

          <h1 className="mt-4 max-w-md bg-gradient-to-b from-white to-[oklch(0.86_0.01_250)] bg-clip-text text-2xl font-semibold leading-tight text-transparent sm:mt-5 sm:text-4xl lg:text-5xl">
            {lang === "ar" ? "إدارة احترافية. شبكة موزعين أوسع." : "Professional management. A wider distributor network."}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/60 sm:mt-4 sm:text-base">
            {lang === "ar"
              ? "نظام موحد لإدارة الفواتير والمخزون والعملاء والموزعين بدقة وسرعة."
              : "A unified system to manage invoices, inventory, customers and distributors with precision and speed."}
          </p>
        </div>

        {/* Auth card */}
        <div className="order-2 w-full max-w-md justify-self-center lg:justify-self-end">
        <div className="relative rounded-2xl border border-[oklch(0.86_0.01_250_/_0.2)] bg-[oklch(0.13_0.003_250_/_0.85)] p-5 text-white shadow-[0_25px_70px_-25px_oklch(0_0_0_/_0.8)] backdrop-blur-xl sm:p-7">
          <div className="pointer-events-none absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-[oklch(0.86_0.01_250)] to-transparent" />
          <div className="mb-5 flex gap-1 rounded-lg bg-white/5 p-1">
            <button
              onClick={() => setMode("login")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                mode === "login"
                  ? "bg-[oklch(0.86_0.01_250)] text-[oklch(0.15_0.003_250)] shadow-sm"
                  : "text-white/70 hover:text-white"
              }`}
            >{t("login")}</button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                mode === "signup"
                  ? "bg-[oklch(0.86_0.01_250)] text-[oklch(0.15_0.003_250)] shadow-sm"
                  : "text-white/70 hover:text-white"
              }`}
            >{t("signup")}</button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-white/80">{t("full_name")}</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="border-white/15 bg-white/5 text-white placeholder:text-white/40 focus-visible:ring-[oklch(0.86_0.01_250)]"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-white/80">{t("email")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border-white/15 bg-white/5 text-white placeholder:text-white/40 focus-visible:ring-[oklch(0.86_0.01_250)]"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-white/80">{t("password")}</Label>
                {mode === "login" && (
                  <button
                    type="button"
                    onClick={() => { setForgotEmail(email); setForgotOpen(true); }}
                    className="text-xs text-[oklch(0.86_0.01_250)] hover:underline"
                  >
                    {lang === "ar" ? "نسيت كلمة السر؟" : "Forgot password?"}
                  </button>
                )}
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                  className="border-white/15 bg-white/5 pe-10 text-white placeholder:text-white/40 focus-visible:ring-[oklch(0.86_0.01_250)]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-white/60 hover:text-white"
                  aria-label={showPassword ? (lang === "ar" ? "إخفاء" : "Hide") : (lang === "ar" ? "إظهار" : "Show")}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              disabled={busy}
              className="w-full bg-[oklch(0.86_0.01_250)] text-[oklch(0.15_0.003_250)] hover:bg-[oklch(0.91_0.008_250)]"
            >
              {mode === "login" ? t("login") : t("signup")}
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs text-white/50">{t("or")}</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          <Button
            variant="outline"
            className="w-full border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            onClick={handleGoogle}
            disabled={busy}
          >
            <svg className="me-2 h-4 w-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            {t("continue_with_google")}
          </Button>

          <p className="mt-5 text-center text-sm text-white/50">
            <Link to="/" className="hover:text-white">←</Link>
          </p>
        </div>
        </div>
      </div>

      {forgotOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setForgotOpen(false)}>
          <form
            onSubmit={handleForgot}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-[oklch(0.15_0.003_250)] p-6 text-white shadow-elegant"
          >
            <h2 className="text-lg font-semibold">
              {lang === "ar" ? "إعادة تعيين كلمة السر" : "Reset password"}
            </h2>
            <p className="text-sm text-white/60">
              {lang === "ar"
                ? "أدخل بريدك وسنرسل لك رابطاً لإعادة تعيين كلمة السر."
                : "Enter your email and we'll send you a reset link."}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email" className="text-white/80">{t("email")}</Label>
              <Input
                id="forgot-email"
                type="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                required
                className="border-white/15 bg-white/5 text-white placeholder:text-white/40 focus-visible:ring-[oklch(0.78_0.11_82)]"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                onClick={() => setForgotOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={busy}
                className="flex-1 bg-[oklch(0.78_0.11_82)] text-[oklch(0.12_0.005_60)] hover:bg-[oklch(0.84_0.1_82)]"
              >
                {lang === "ar" ? "إرسال" : "Send"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
