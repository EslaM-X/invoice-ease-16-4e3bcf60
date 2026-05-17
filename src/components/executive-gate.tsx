import { type ReactNode, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useIsExecutive } from "@/lib/use-executive";
import { useI18n } from "@/lib/i18n";

/**
 * Restricts a page to the four executive accounts.
 * Non-executives are bounced back to /dashboard.
 */
export function ExecutiveGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const isExecutive = useIsExecutive();
  const navigate = useNavigate();
  const { lang } = useI18n();

  useEffect(() => {
    if (!loading && user && !isExecutive) {
      navigate({ to: "/dashboard" });
    }
  }, [loading, user, isExecutive, navigate]);

  if (loading) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">…</div>;
  }
  if (!isExecutive) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        {lang === "ar" ? "غير مصرح لك بعرض هذه الصفحة." : "You do not have access to this page."}
      </div>
    );
  }
  return <>{children}</>;
}
