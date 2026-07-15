import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useIsSuperAdmin } from "@/lib/super-admin";

const IMPERSONATE_KEY = "access-studio:impersonate-user-id";

export type UiPrefs = {
  nav_hidden: string[];
  nav_order: string[];
  cards_hidden: string[];
  cards_order: string[];
  mobile_tabs: string[];
};

const EMPTY: UiPrefs = {
  nav_hidden: [],
  nav_order: [],
  cards_hidden: [],
  cards_order: [],
  mobile_tabs: [],
};

function toArr(v: any): string[] {
  return Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];
}

function normalize(row: any): UiPrefs {
  if (!row) return EMPTY;
  return {
    nav_hidden: toArr(row.nav_hidden),
    nav_order: toArr(row.nav_order),
    cards_hidden: toArr(row.cards_hidden),
    cards_order: toArr(row.cards_order),
    mobile_tabs: toArr(row.mobile_tabs),
  };
}

/** Get impersonated user id (super-admin preview-as-user). */
export function getImpersonateId(): string | null {
  if (typeof window === "undefined") return null;
  try { return sessionStorage.getItem(IMPERSONATE_KEY); } catch { return null; }
}

export function setImpersonateId(userId: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (userId) sessionStorage.setItem(IMPERSONATE_KEY, userId);
    else sessionStorage.removeItem(IMPERSONATE_KEY);
  } catch { /* ignore */ }
  // Reload so every hook re-reads the target user's prefs cleanly.
  window.location.reload();
}

/**
 * Reads the current effective UI prefs.
 * - Normal users: reads their own row.
 * - Super admins: reads the impersonated user's row when set, otherwise their own (unfiltered).
 * - Super admins always return EMPTY prefs so they see EVERYTHING when not impersonating.
 */
export function useUiPrefs() {
  const { user } = useAuth();
  const isSuper = useIsSuperAdmin();
  const impersonate = typeof window !== "undefined" ? getImpersonateId() : null;
  const targetId = impersonate || user?.id || null;

  const [prefs, setPrefs] = useState<UiPrefs>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  // Super admins WITHOUT impersonation see everything, always.
  const bypass = isSuper && !impersonate;

  useEffect(() => {
    if (!targetId || bypass) { setPrefs(EMPTY); setLoaded(true); return; }
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from("user_ui_preferences")
        .select("*")
        .eq("user_id", targetId)
        .maybeSingle();
      if (!cancel) { setPrefs(normalize(data)); setLoaded(true); }
    })();

    const ch = supabase
      .channel(`ui-prefs:${targetId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "user_ui_preferences", filter: `user_id=eq.${targetId}` },
        (payload) => { setPrefs(normalize((payload as any).new ?? null)); },
      )
      .subscribe();

    return () => { cancel = true; supabase.removeChannel(ch); };
  }, [targetId, bypass]);

  return useMemo(() => ({
    prefs,
    loaded,
    bypass,
    isImpersonating: !!impersonate,
    impersonateId: impersonate,
    /** Is nav key hidden for this user? */
    isNavHidden: (key: string) => !bypass && prefs.nav_hidden.includes(key),
    /** Is dashboard card hidden for this user? */
    isCardHidden: (key: string) => !bypass && prefs.cards_hidden.includes(key),
    /** Sort a list of keys by user's saved order; unknown keys preserve original order at the end. */
    sortByOrder: <T extends { key: string }>(list: T[], orderList: string[]): T[] => {
      if (bypass || orderList.length === 0) return list;
      const idx = new Map(orderList.map((k, i) => [k, i]));
      return [...list].sort((a, b) => {
        const ai = idx.has(a.key) ? (idx.get(a.key) as number) : 1e9;
        const bi = idx.has(b.key) ? (idx.get(b.key) as number) : 1e9;
        return ai - bi;
      });
    },
  }), [prefs, loaded, bypass, impersonate]);
}
