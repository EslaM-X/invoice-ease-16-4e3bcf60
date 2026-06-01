import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type AppRole = "admin" | "manager" | "cashier" | "call_center" | "purchasing" | "cfo" | "user";

/**
 * Returns the current user's roles + helpers. Cached per session.
 * Admin always wins. Falls back to "user" if no role assigned.
 */
export function useRole() {
  const { user } = useAuth();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setRoles([]);
      setLoading(false);
      return;
    }
    let cancel = false;
    setLoading(true);
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .then(({ data }) => {
        if (cancel) return;
        const list = (data ?? []).map((r: any) => r.role as AppRole);
        setRoles(list.length ? list : ["user"]);
        setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [user]);

  // Email-based overrides: specific accounts get unconditional access to
  // certain feature areas regardless of their assigned roles.
  const email = (user?.email ?? "").trim().toLowerCase();
  const CALL_CENTER_FULL_ACCESS = new Set(["f.hesham@steinheim-eg.com"]);
  const hasCallCenterOverride = CALL_CENTER_FULL_ACCESS.has(email);

  const isAdmin = roles.includes("admin");
  const isManager = isAdmin || roles.includes("manager") || hasCallCenterOverride;
  const isCashier = isAdmin || roles.includes("cashier");
  const isCallCenter = isAdmin || roles.includes("call_center") || hasCallCenterOverride;
  const isPurchasing = isAdmin || roles.includes("purchasing");
  const isCFO = isAdmin || roles.includes("cfo");

  return { roles, isAdmin, isManager, isCashier, isCallCenter, isPurchasing, isCFO, loading };
}
