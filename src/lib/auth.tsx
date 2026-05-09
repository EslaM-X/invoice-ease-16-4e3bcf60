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

const TAB_ALIVE_KEY = "stein.tabAlive";

function purgeSupabaseStorage() {
  try {
    const matches = (k: string) =>
      k.startsWith("sb-") ||
      k.startsWith("supabase.") ||
      k === "supabase.auth.token" ||
      k.includes("-auth-token");
    for (const store of [localStorage, sessionStorage]) {
      for (const key of Object.keys(store)) {
        if (matches(key)) store.removeItem(key);
      }
    }
    // Best-effort: drop Supabase IndexedDB stores too.
    if (typeof indexedDB !== "undefined" && (indexedDB as any).databases) {
      (indexedDB as any).databases().then((dbs: { name?: string }[]) => {
        for (const db of dbs ?? []) {
          if (db.name && (db.name.startsWith("supabase") || db.name.includes("auth-token"))) {
            indexedDB.deleteDatabase(db.name);
          }
        }
      }).catch(() => {});
    }
  } catch { /* ignore */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // One-time forced sign-out so all existing accounts re-authenticate
    // (used to roll out biometric enrolment to current users).
    try {
      const FORCE_KEY = "stein.forceSignout.v";
      const TARGET = "2026-05-09-bio";
      if (localStorage.getItem(FORCE_KEY) !== TARGET) {
        purgeSupabaseStorage();
        // keep biometric enrolment if any — so users can sign in with it
        localStorage.setItem(FORCE_KEY, TARGET);
        void supabase.auth.signOut();
      }
    } catch { /* ignore */ }

    // "Remember Me" behaviour:
    // - ON (default): session persists in localStorage (Supabase default).
    // - OFF: clear any persisted Supabase auth state both when the tab/window
    //   closes AND on a fresh page load that wasn't reached from the same
    //   browsing session. A `sessionStorage` marker proves the current tab is
    //   the same one that signed in; if it's missing on load, we know the
    //   browser was closed (or this is a brand-new tab) and we wipe tokens
    //   before Supabase tries to restore them.
    const remember = (() => {
      try { return localStorage.getItem("stein.rememberMe"); } catch { return null; }
    })();
    if (remember === "0") {
      try {
        const alive = sessionStorage.getItem(TAB_ALIVE_KEY);
        if (!alive) purgeSupabaseStorage();
        sessionStorage.setItem(TAB_ALIVE_KEY, "1");
      } catch { /* ignore */ }
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const handleHide = () => {
      try {
        if (localStorage.getItem("stein.rememberMe") === "0") {
          purgeSupabaseStorage();
        }
      } catch { /* ignore */ }
    };
    window.addEventListener("pagehide", handleHide);
    window.addEventListener("beforeunload", handleHide);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("pagehide", handleHide);
      window.removeEventListener("beforeunload", handleHide);
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut({ scope: "local" });
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
