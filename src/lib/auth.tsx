import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

type Ctx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    // "Remember Me" behaviour:
    // - ON (default): session persists forever in localStorage (Supabase default).
    // - OFF: clear the persisted session when the tab/window closes so the
    //   user has to sign in again next visit. Manual sign-out always works.
    const handleHide = () => {
      try {
        const remember = localStorage.getItem("stein.rememberMe");
        if (remember === "0") {
          for (const key of Object.keys(localStorage)) {
            if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
              localStorage.removeItem(key);
            }
          }
        }
      } catch { /* ignore */ }
    };
    window.addEventListener("pagehide", handleHide);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("pagehide", handleHide);
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
