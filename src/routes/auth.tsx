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
import { Languages, Moon, Sun } from "lucide-react";
import brandLogo from "@/assets/steinheim-logo.png";
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
    <div className="relative min-h-screen overflow-hidden bg-[oklch(0.1_0.004_60)] text-[oklch(0.97_0.008_82)] flex items-center justify-center p-4">
      {/* Decorative gold mesh */}
      <div className="pointer-events-none absolute inset-0 opacity-60"
        style={{ backgroundImage: "radial-gradient(at 15% 10%, oklch(0.78 0.11 82 / 0.18) 0px, transparent 50%), radial-gradient(at 85% 80%, oklch(0.62 0.13 75 / 0.14) 0px, transparent 50%)" }} />
      <div className="absolute top-4 end-4 z-10 flex gap-2 no-print">
        <Button variant="ghost" size="icon" className="text-[oklch(0.97_0.008_82)] hover:bg-white/10" onClick={() => setLang(lang === "ar" ? "en" : "ar")} aria-label="lang">
          <Languages className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="text-[oklch(0.97_0.008_82)] hover:bg-white/10" onClick={toggle} aria-label="theme">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <img src={brandLogo} alt="Steinheim" className="mx-auto mb-3 h-20 w-auto select-none" draggable={false} />
          <div className="mx-auto h-px w-24 bg-gradient-to-r from-transparent via-[oklch(0.78_0.11_82)] to-transparent" />
          <p className="font-latin mt-4 text-[11px] font-medium uppercase tracking-[0.4em] text-[oklch(0.78_0.11_82)]">
            Invoice Suite
          </p>
          <p className="mt-2 text-sm text-white/60">{t("hero_subtitle")}</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[oklch(0.15_0.005_60)] p-6 text-[oklch(0.97_0.008_82)] shadow-elegant">
          <div className="mb-5 flex gap-1 rounded-lg bg-white/5 p-1">
            <button
              onClick={() => setMode("login")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                mode === "login"
                  ? "bg-[oklch(0.78_0.11_82)] text-[oklch(0.12_0.005_60)] shadow-sm"
                  : "text-white/70 hover:text-white"
              }`}
            >{t("login")}</button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                mode === "signup"
                  ? "bg-[oklch(0.78_0.11_82)] text-[oklch(0.12_0.005_60)] shadow-sm"
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
                  className="border-white/15 bg-white/5 text-white placeholder:text-white/40 focus-visible:ring-[oklch(0.78_0.11_82)]"
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
                className="border-white/15 bg-white/5 text-white placeholder:text-white/40 focus-visible:ring-[oklch(0.78_0.11_82)]"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-white/80">{t("password")}</Label>
                {mode === "login" && (
                  <button
                    type="button"
                    onClick={() => { setForgotEmail(email); setForgotOpen(true); }}
                    className="text-xs text-[oklch(0.78_0.11_82)] hover:underline"
                  >
                    {lang === "ar" ? "نسيت كلمة السر؟" : "Forgot password?"}
                  </button>
                )}
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
                className="border-white/15 bg-white/5 text-white placeholder:text-white/40 focus-visible:ring-[oklch(0.78_0.11_82)]"
              />
            </div>
            <Button
              type="submit"
              disabled={busy}
              className="w-full bg-[oklch(0.78_0.11_82)] text-[oklch(0.12_0.005_60)] hover:bg-[oklch(0.84_0.1_82)]"
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
  );
}
