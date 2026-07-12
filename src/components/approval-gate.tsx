import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, Clock, XCircle, Briefcase, Store } from "lucide-react";
import { toast } from "sonner";

type Profile = {
  account_type: "employee" | "distributor" | null;
  approval_status: "pending" | "approved" | "rejected";
  approval_notes: string | null;
};

export function ApprovalGate({ children }: { children: ReactNode }) {
  const { user, signOut, loading: authLoading } = useAuth();
  const { lang } = useI18n();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picked, setPicked] = useState<"employee" | "distributor" | null>(null);

  const load = async (_uid: string) => {
    setLoading(true);
    const { data } = await (supabase.rpc as any)("get_my_approval_state");
    const row = Array.isArray(data) ? data[0] : null;
    setProfile((row as Profile | null) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) { setProfile(null); return; }
    load(user.id);
    // Realtime: refresh when admin approves
    const ch = supabase
      .channel(`approval-${user.id}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `user_id=eq.${user.id}` },
        () => load(user.id))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  if (authLoading || !user) return <>{children}</>;
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  // If no profile exists yet, treat as pending but allow the UI to show the type picker
  const activeProfile = profile || { account_type: null, approval_status: "pending", approval_notes: null };
  if (activeProfile.approval_status === "approved") {
    return <DistributorRouteGuard accountType={activeProfile.account_type}>{children}</DistributorRouteGuard>;
  }

  const saveType = async () => {
    if (!picked || !user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ account_type: picked })
      .eq("user_id", user.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(lang === "ar" ? "تم الإرسال للأدمن" : "Sent to admin");
    load(user.id);
  };

  const needsType = activeProfile.approval_status === "pending" && !activeProfile.account_type;
  const rejected = activeProfile.approval_status === "rejected";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b0c] p-4 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[oklch(0.15_0.003_250)] p-6 shadow-elegant">
        <div className="mb-4 flex items-center gap-3">
          <div className={`flex h-12 w-12 items-center justify-center rounded-full ${rejected ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400"}`}>
            {rejected ? <XCircle className="h-6 w-6" /> : needsType ? <ShieldCheck className="h-6 w-6" /> : <Clock className="h-6 w-6" />}
          </div>
          <div>
            <h2 className="text-lg font-semibold">
              {rejected
                ? (lang === "ar" ? "تم رفض الطلب" : "Request rejected")
                : needsType
                ? (lang === "ar" ? "أكمل بياناتك" : "Complete your profile")
                : (lang === "ar" ? "حسابك قيد المراجعة" : "Account pending approval")}
            </h2>
            <p className="text-xs text-white/60">{user.email}</p>
          </div>
        </div>

        {rejected ? (
          <p className="mb-4 text-sm text-white/70">
            {activeProfile.approval_notes
              || (lang === "ar"
                ? "تم رفض طلبك من الإدارة. تواصل مع المسؤول لمزيد من التفاصيل."
                : "Your request was rejected. Please contact the admin for details.")}
          </p>
        ) : needsType ? (
          <>
            <p className="mb-3 text-sm text-white/70">
              {lang === "ar"
                ? "اختر نوع حسابك ثم انتظر موافقة الإدارة."
                : "Select your account type, then wait for admin approval."}
            </p>
            <div className="mb-4 grid grid-cols-2 gap-3">
              {([
                { v: "employee", icon: Briefcase, ar: "موظف في الشركة", en: "Company employee" },
                { v: "distributor", icon: Store, ar: "موزّع", en: "Distributor" },
              ] as const).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setPicked(o.v)}
                  className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition ${
                    picked === o.v
                      ? "border-[oklch(0.86_0.01_250)] bg-white/10"
                      : "border-white/15 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <o.icon className="h-6 w-6 text-[oklch(0.86_0.01_250)]" />
                  <span className="text-sm">{lang === "ar" ? o.ar : o.en}</span>
                </button>
              ))}
            </div>
            <Button
              onClick={saveType}
              disabled={!picked || saving}
              className="w-full bg-[oklch(0.86_0.01_250)] text-[oklch(0.15_0.003_250)] hover:bg-[oklch(0.91_0.008_250)]"
            >
              {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              {lang === "ar" ? "إرسال الطلب" : "Submit request"}
            </Button>
          </>
        ) : (
          <p className="mb-4 text-sm text-white/70">
            {lang === "ar"
              ? `طلبك (${activeProfile.account_type === "employee" ? "موظف" : "موزّع"}) في انتظار موافقة الإدارة. سيتم تفعيل الحساب فور الموافقة.`
              : `Your request (${activeProfile.account_type}) is awaiting admin approval. Access will be granted once approved.`}
          </p>
        )}

        <Button
          variant="outline"
          onClick={signOut}
          className="mt-3 w-full border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
        >
          {lang === "ar" ? "تسجيل الخروج" : "Sign out"}
        </Button>
      </div>
    </div>
  );
}

function DistributorRouteGuard({ accountType, children }: { accountType: string | null; children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isDist, setIsDist] = useState<boolean | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) { setIsDist(false); return; }
    if (accountType !== "distributor") { setIsDist(false); return; }
    let cancel = false;
    (supabase.from as any)("distributors").select("id,is_active").eq("user_id", user.id).maybeSingle()
      .then(({ data }: any) => { if (!cancel) setIsDist(!!data?.is_active); });
    return () => { cancel = true; };
  }, [user?.id, accountType]);

  useEffect(() => {
    if (isDist !== true) return;
    const p = location.pathname;
    const allowed = p === "/distributor" || p.startsWith("/distributor/") || p === "/auth" || p === "/reset-password";
    if (!allowed) navigate({ to: "/distributor", replace: true });
  }, [isDist, location.pathname, navigate]);

  if (isDist === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <>{children}</>;
}
