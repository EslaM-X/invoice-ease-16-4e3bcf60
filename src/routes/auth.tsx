import { useState, useEffect, type FormEvent } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/lib/theme";
import { Languages, Moon, Sun, Eye, EyeOff, Fingerprint, ScanFace, ShieldCheck, Briefcase, Store, Monitor, KeyRound } from "lucide-react";
import brandLogo from "@/assets/steinheim-logo-white.png";
import { toast } from "sonner";
import {
  isPlatformAuthenticatorAvailable,
  listEnrolledAccounts,
  enrollBiometric,
  verifyBiometric,
  disableBiometric,
  updateStoredTokens,
} from "@/lib/biometric";

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
  const [accountType, setAccountType] = useState<"employee" | "distributor" | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [rememberMe, setRememberMe] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = localStorage.getItem("stein.rememberMe");
    return v === null ? true : v === "1";
  });
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState(false);
  const [enrolledEmail, setEnrolledEmail] = useState<string | null>(null);
  const [enrolledAccounts, setEnrolledAccounts] = useState<{ email: string; enrolledAt: number; credentialId: string }[]>([]);
  const [enrollPromptOpen, setEnrollPromptOpen] = useState(false);
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isApple = /iP(hone|ad|od)|Mac/i.test(ua);
  const isWindows = /Windows/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const BioIcon = isApple ? ScanFace : isWindows ? KeyRound : Fingerprint;
  const deviceLabel = isApple
    ? (lang === "ar" ? "Face ID / Touch ID" : "Face ID / Touch ID")
    : isWindows
      ? (lang === "ar" ? "Windows Hello" : "Windows Hello")
      : isAndroid
        ? (lang === "ar" ? "بصمة الإصبع" : "Fingerprint")
        : (lang === "ar" ? "البصمة / المفتاح الأمني" : "Biometric / Security Key");

  const refreshBioState = () => {
    const accounts = listEnrolledAccounts();
    setEnrolledAccounts(accounts);
    setBioEnrolled(accounts.length > 0);
    const em = accounts[0]?.email ?? null;
    setEnrolledEmail(em);
    if (em) setEmail(em);
  };

  useEffect(() => {
    let mounted = true;
    // Load enrolled accounts immediately so the biometric panel shows on
    // first render (don't wait for the async platform-auth check, which can
    // return false inside iframes / preview environments even when WebAuthn
    // works fine on the published app).
    refreshBioState();
    // Optimistically enable the biometric UI if WebAuthn exists at all,
    // then refine once the platform-auth probe resolves.
    if (typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined") {
      setBioSupported(true);
    }
    isPlatformAuthenticatorAvailable().then((ok) => {
      if (!mounted) return;
      // Keep it enabled if WebAuthn is present even if platform-auth probe
      // says no — the actual `navigator.credentials.get` call will decide.
      setBioSupported((prev) => prev || ok);
      refreshBioState();
    }).catch(() => { /* ignore */ });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("stein.rememberMe", rememberMe ? "1" : "0");
    }
  }, [rememberMe]);

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
    if (user && !enrollPromptOpen) navigate({ to: "/dashboard" });
  }, [user, navigate, enrollPromptOpen]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        if (!accountType) {
          toast.error(lang === "ar" ? "اختر نوع الحساب" : "Select account type");
          setBusy(false);
          return;
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { full_name: name, account_type: accountType },
          },
        });
        if (error) throw error;
        toast.success(lang === "ar"
          ? "تم إنشاء الحساب — في انتظار موافقة الإدارة"
          : "Account created — awaiting admin approval");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const sess = data.session;
        if (sess && bioSupported) {
          const currentEmail = sess.user.email ?? email;
          if (bioEnrolled && enrolledEmail === currentEmail) {
            updateStoredTokens({ access_token: sess.access_token, refresh_token: sess.refresh_token });
          } else {
            setEnrollPromptOpen(true);
          }
        }
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

  const handleBiometricLogin = async (forEmail?: string) => {
    setBusy(true);
    try {
      const tokens = await verifyBiometric(forEmail);
      const { data, error } = await supabase.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      });
      if (error) throw error;
      if (data.session) {
        updateStoredTokens({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        }, tokens.email);
        setEmail(tokens.email);
      }
    } catch (err: any) {
      const msg = err?.message || "";
      const isCancel = /NotAllowed|cancelled|canceled|aborted|timed? ?out/i.test(msg) || err?.name === "NotAllowedError";
      if (/expired|invalid|refresh/i.test(msg)) {
        toast.error(lang === "ar"
          ? "انتهت صلاحية الجلسة. الرجاء تسجيل الدخول بكلمة السر أو Google لتجديدها."
          : "Saved session expired. Please sign in with password or Google to refresh it.");
      } else if (isCancel) {
        toast.message(lang === "ar"
          ? "تم إلغاء التحقق — يمكنك تسجيل الدخول بكلمة السر بدلًا من ذلك."
          : "Verification cancelled — you can sign in with your password instead.");
      } else {
        toast.error(lang === "ar"
          ? `تعذّر التحقق بـ ${deviceLabel}. الرجاء استخدام كلمة السر.`
          : `${deviceLabel} verification failed. Please use your password.`);
      }
      // Make sure password field is focused for fallback
      setTimeout(() => {
        try { (document.getElementById("password") as HTMLInputElement | null)?.focus(); } catch { /* ignore */ }
      }, 50);
    } finally {
      setBusy(false);
    }
  };

  const handleEnableBiometric = async () => {
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const sess = data.session;
      if (!sess) throw new Error("No session");
      await enrollBiometric({
        email: sess.user.email ?? email,
        access_token: sess.access_token,
        refresh_token: sess.refresh_token,
      });
      refreshBioState();
      toast.success(lang === "ar" ? `تم تفعيل ${deviceLabel}` : `${deviceLabel} enabled`);
      setEnrollPromptOpen(false);
    } catch (err: any) {
      toast.error(err?.message ?? (lang === "ar" ? "فشل التفعيل" : "Enrollment failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleDisableBiometric = async (forEmail?: string) => {
    await disableBiometric(forEmail);
    refreshBioState();
    toast.success(lang === "ar" ? "تم إلغاء الدخول بالبصمة" : "Biometric disabled");
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

          {mode === "login" && bioSupported && bioEnrolled && (
            <div className="mb-5 rounded-xl border border-[oklch(0.86_0.01_250_/_0.45)] bg-gradient-to-br from-[oklch(0.86_0.01_250_/_0.18)] to-[oklch(0.86_0.01_250_/_0.05)] p-4 shadow-[0_10px_40px_-15px_oklch(0.86_0.01_250_/_0.5)]">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[oklch(0.86_0.01_250_/_0.2)] text-[oklch(0.86_0.01_250)] ring-1 ring-[oklch(0.86_0.01_250_/_0.4)]">
                  <BioIcon className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold text-white">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-emerald-400/30" />
                    {lang === "ar"
                      ? `${deviceLabel} مُفعّل على هذا الجهاز`
                      : `${deviceLabel} is enabled on this device`}
                  </p>
                  <p className="text-xs text-white/60">
                    {lang === "ar"
                      ? `${enrolledAccounts.length} حساب${enrolledAccounts.length > 1 ? "ات" : ""} مسجل${enrolledAccounts.length > 1 ? "ة" : ""}`
                      : `${enrolledAccounts.length} account${enrolledAccounts.length > 1 ? "s" : ""} enrolled`}
                  </p>
                </div>
              </div>

              <ul className="mb-3 space-y-1.5">
                {enrolledAccounts.map((acc, i) => {
                  const isCurrent = acc.email === enrolledEmail;
                  return (
                    <li
                      key={acc.credentialId}
                      className={`group flex items-center gap-2 rounded-lg border p-2 transition ${
                        isCurrent
                          ? "border-[oklch(0.86_0.01_250_/_0.5)] bg-white/10"
                          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleBiometricLogin(acc.email)}
                        disabled={busy}
                        className="flex flex-1 items-center gap-2 text-start"
                      >
                        <BioIcon className="h-4 w-4 shrink-0 text-[oklch(0.86_0.01_250)]" />
                        <span className="min-w-0 flex-1 truncate text-xs text-white" dir="ltr">{acc.email}</span>
                        {isCurrent && (
                          <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            {lang === "ar" ? "افتراضي" : "default"}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDisableBiometric(acc.email)}
                        className="rounded p-1 text-[10px] text-white/40 opacity-0 hover:text-white group-hover:opacity-100"
                        title={lang === "ar" ? "إلغاء التفعيل لهذا الحساب" : "Remove biometric for this account"}
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>

              <Button
                type="button"
                onClick={() => handleBiometricLogin(enrolledEmail ?? undefined)}
                disabled={busy}
                className="w-full bg-[oklch(0.86_0.01_250)] text-[oklch(0.15_0.003_250)] hover:bg-[oklch(0.91_0.008_250)]"
              >
                <BioIcon className="me-2 h-5 w-5" />
                {lang === "ar"
                  ? `الدخول بـ ${deviceLabel}${enrolledEmail ? ` كـ ${enrolledEmail}` : ""}`
                  : `Sign in with ${deviceLabel}${enrolledEmail ? ` as ${enrolledEmail}` : ""}`}
              </Button>
            </div>
          )}

          {mode === "login" && bioSupported && !bioEnrolled && (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70">
                {isWindows ? <Monitor className="h-4 w-4" /> : <BioIcon className="h-4 w-4" />}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-white/85">
                  {lang === "ar"
                    ? `${deviceLabel} مدعوم على هذا الجهاز`
                    : `${deviceLabel} is supported on this device`}
                </p>
                <p className="mt-0.5">
                  {lang === "ar"
                    ? "سجّل الدخول مرة واحدة بكلمة السر وسنعرض لك خيار التفعيل."
                    : "Sign in once with your password and we'll offer to enable it."}
                </p>
              </div>
            </div>
          )}


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
            {mode === "signup" && (
              <div className="space-y-2">
                <Label className="text-white/80">
                  {lang === "ar" ? "نوع الحساب" : "Account type"}
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { v: "employee", icon: Briefcase, ar: "موظف في الشركة", en: "Company employee" },
                    { v: "distributor", icon: Store, ar: "موزّع", en: "Distributor" },
                  ] as const).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setAccountType(o.v)}
                      className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center text-xs transition ${
                        accountType === o.v
                          ? "border-[oklch(0.86_0.01_250)] bg-white/10"
                          : "border-white/15 bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      <o.icon className="h-5 w-5 text-[oklch(0.86_0.01_250)]" />
                      <span>{lang === "ar" ? o.ar : o.en}</span>
                    </button>
                  ))}
                </div>
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
            {mode === "login" && (
              <div className="flex items-center justify-between text-sm">
                <label className="flex cursor-pointer select-none items-center gap-2 text-white/80">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded border-white/30 bg-white/10 accent-[oklch(0.86_0.01_250)]"
                  />
                  {lang === "ar" ? "تذكّرني" : "Remember me"}
                </label>
                {bioEnrolled && (
                  <button
                    type="button"
                    onClick={() => handleDisableBiometric()}
                    className="text-xs text-white/50 hover:text-white"
                  >
                    {lang === "ar" ? "إلغاء البصمة" : "Disable biometric"}
                  </button>
                )}
              </div>
            )}
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
                className="border-white/15 bg-white/5 text-white placeholder:text-white/40 focus-visible:ring-[oklch(0.86_0.01_250)]"
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
                className="flex-1 bg-[oklch(0.86_0.01_250)] text-[oklch(0.15_0.003_250)] hover:bg-[oklch(0.91_0.008_250)]"
              >
                {lang === "ar" ? "إرسال" : "Send"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {enrollPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEnrollPromptOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-[oklch(0.15_0.003_250)] p-6 text-white shadow-elegant"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[oklch(0.86_0.01_250_/_0.15)] text-[oklch(0.86_0.01_250)]">
                <BioIcon className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">
                  {lang === "ar" ? `تفعيل ${deviceLabel}` : `Enable ${deviceLabel}`}
                </h2>
                <p className="text-xs text-white/60">
                  {lang === "ar" ? "دخول أسرع وأكثر أمانًا" : "Faster, more secure sign-in"}
                </p>
              </div>
            </div>
            <p className="flex items-start gap-2 text-sm text-white/70">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[oklch(0.86_0.01_250)]" />
              <span>
                {lang === "ar"
                  ? "في المرة القادمة سجّل الدخول مباشرة باستخدام بصمتك أو وجهك على هذا الجهاز."
                  : "Next time, sign in instantly with your fingerprint or face on this device."}
              </span>
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                onClick={() => setEnrollPromptOpen(false)}
              >
                {lang === "ar" ? "ليس الآن" : "Not now"}
              </Button>
              <Button
                type="button"
                disabled={busy}
                className="flex-1 bg-[oklch(0.86_0.01_250)] text-[oklch(0.15_0.003_250)] hover:bg-[oklch(0.91_0.008_250)]"
                onClick={handleEnableBiometric}
              >
                {lang === "ar" ? "تفعيل" : "Enable"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
