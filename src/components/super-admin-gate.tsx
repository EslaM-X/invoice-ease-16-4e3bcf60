import { type ReactNode, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useIsSuperAdmin } from "@/lib/super-admin";

export function SuperAdminGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const isSuper = useIsSuperAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user && !isSuper) navigate({ to: "/dashboard" });
  }, [loading, user, isSuper, navigate]);

  if (loading) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">…</div>;
  }
  if (!isSuper) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Forbidden — super admins only.
      </div>
    );
  }
  return <>{children}</>;
}
