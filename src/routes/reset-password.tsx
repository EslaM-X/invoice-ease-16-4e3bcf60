import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import brandLogo from "@/assets/steinheim-logo-white.png";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [show1, setShow1] = useState(false);
  const [show2, setShow2] = useState(false);

  useEffect(() => {
    // Supabase puts the recovery session into the URL hash and sets the session automatically.
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) setReady(true);
    };
    check();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error(lang === "ar" ? "كلمة السر يجب أن تكون 6 أحرف على الأقل" : "Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      toast.error(lang === "ar" ? "كلمتا السر غير متطابقتين" : "Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success(lang === "ar" ? "تم تحديث كلمة السر بنجاح" : "Password updated successfully");
      await supabase.auth.signOut();
      navigate({ to: "/auth" });
    } catch (err: any) {
      toast.error(err?.message ?? t("error_occurred"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[oklch(0.1_0.004_60)] text-[oklch(0.97_0.008_82)] flex items-center justify-center p-4">
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <img src={brandLogo} alt="Steinheim" className="mx-auto mb-4 h-28 w-auto select-none object-contain drop-shadow-[0_8px_28px_oklch(0.78_0.11_82_/_0.35)]" draggable={false} />
          <p className="font-latin mt-4 text-[11px] font-medium uppercase tracking-[0.4em] text-[oklch(0.78_0.11_82)]">
            Invoice Suite
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[oklch(0.15_0.005_60)] p-6 shadow-elegant">
          <h1 className="mb-1 text-lg font-semibold">
            {lang === "ar" ? "تعيين كلمة سر جديدة" : "Set a new password"}
          </h1>
          <p className="mb-5 text-sm text-white/60">
            {ready
              ? (lang === "ar" ? "اختر كلمة سر قوية لحسابك." : "Choose a strong password for your account.")
              : (lang === "ar" ? "في انتظار التحقق من الرابط..." : "Verifying the link...")}
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pw" className="text-white/80">
                {lang === "ar" ? "كلمة السر الجديدة" : "New password"}
              </Label>
              <div className="relative">
                <Input
                  id="pw"
                  type={show1 ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                  disabled={!ready}
                  className="border-white/15 bg-white/5 pe-10 text-white focus-visible:ring-[oklch(0.78_0.11_82)]"
                />
                <button
                  type="button"
                  onClick={() => setShow1((v) => !v)}
                  className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-white/60 hover:text-white"
                >
                  {show1 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw2" className="text-white/80">
                {lang === "ar" ? "تأكيد كلمة السر" : "Confirm password"}
              </Label>
              <div className="relative">
                <Input
                  id="pw2"
                  type={show2 ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  minLength={6}
                  required
                  disabled={!ready}
                  className="border-white/15 bg-white/5 pe-10 text-white focus-visible:ring-[oklch(0.78_0.11_82)]"
                />
                <button
                  type="button"
                  onClick={() => setShow2((v) => !v)}
                  className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-white/60 hover:text-white"
                >
                  {show2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              disabled={busy || !ready}
              className="w-full bg-[oklch(0.78_0.11_82)] text-[oklch(0.12_0.005_60)] hover:bg-[oklch(0.84_0.1_82)]"
            >
              {lang === "ar" ? "حفظ كلمة السر" : "Save password"}
            </Button>
          </form>
          <p className="mt-5 text-center text-sm">
            <Link to="/auth" className="text-white/60 hover:text-white">
              {lang === "ar" ? "العودة لتسجيل الدخول" : "Back to login"}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
