import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type CurrentAvatar = {
  url: string | null;
  name: string | null;
  initial: string;
  loading: boolean;
};

function pickMetaAvatar(user: any): string | null {
  const m = user?.user_metadata || {};
  return m.avatar_url || m.picture || m.avatar || null;
}

function pickMetaName(user: any): string | null {
  const m = user?.user_metadata || {};
  return m.display_name || m.full_name || m.name || null;
}

function computeInitial(name: string | null, user: any): string {
  const src = (name || pickMetaName(user) || user?.email || "U").toString().trim();
  return (src.charAt(0) || "U").toUpperCase();
}

function withCacheBuster(url: string | null, version: string | number | null): string | null {
  if (!url) return null;
  if (!version) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(String(version))}`;
}

/**
 * Reads the current user's avatar from user_metadata (instant, no network),
 * then hydrates from public.profiles and stays in sync via realtime.
 * Auto-upserts avatar_url from metadata → profiles on first load if missing.
 */
export function useCurrentAvatar(): CurrentAvatar {
  const { user } = useAuth();
  const uid = user?.id;
  const metaUrl = pickMetaAvatar(user);
  const metaName = pickMetaName(user);

  const [profileUrl, setProfileUrl] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [version, setVersion] = useState<string | number | null>(null);
  const [loading, setLoading] = useState<boolean>(!metaUrl);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;

    const fetchProfile = async () => {
      const { data } = await (supabase as any)
        .from("profiles")
        .select("avatar_url, display_name, updated_at")
        .eq("user_id", uid)
        .maybeSingle();
      if (cancelled) return;
      const row = data || {};
      setProfileUrl(row.avatar_url ?? null);
      setProfileName(row.display_name ?? null);
      setVersion(row.updated_at ?? null);
      setLoading(false);

      // Auto-upsert avatar from metadata → profiles when row exists but avatar is empty
      if (row && !row.avatar_url && metaUrl) {
        (supabase as any)
          .from("profiles")
          .upsert(
            { user_id: uid, avatar_url: metaUrl, email: user?.email ?? null },
            { onConflict: "user_id" },
          )
          .then(() => {
            if (!cancelled) setProfileUrl(metaUrl);
          });
      }
    };

    fetchProfile();

    const channel = (supabase as any)
      .channel(`avatar-profile-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles", filter: `user_id=eq.${uid}` },
        (payload: any) => {
          const row = payload?.new ?? payload?.record;
          if (!row) return;
          setProfileUrl(row.avatar_url ?? null);
          setProfileName(row.display_name ?? null);
          setVersion(row.updated_at ?? Date.now());
        },
      )
      .subscribe();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "USER_UPDATED" || event === "TOKEN_REFRESHED") fetchProfile();
    });

    return () => {
      cancelled = true;
      try { (supabase as any).removeChannel?.(channel); } catch { /* noop */ }
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const rawUrl = profileUrl ?? metaUrl ?? null;
  const url = withCacheBuster(rawUrl, version);
  const name = profileName ?? metaName ?? null;
  return { url, name, initial: computeInitial(name, user), loading };
}
