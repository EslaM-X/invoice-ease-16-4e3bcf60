import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/lib/realtime";

export type TeamProfile = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type Cache = {
  byEmail: Map<string, TeamProfile>;
  byId: Map<string, TeamProfile>;
};

let cache: Cache = { byEmail: new Map(), byId: new Map() };
const listeners = new Set<() => void>();

async function refresh() {
  const { data } = await supabase.from("profiles").select("user_id, email, display_name, avatar_url");
  const byEmail = new Map<string, TeamProfile>();
  const byId = new Map<string, TeamProfile>();
  (data ?? []).forEach((p: any) => {
    const tp: TeamProfile = {
      user_id: p.user_id,
      email: p.email,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
    };
    if (p.email) byEmail.set(p.email.toLowerCase(), tp);
    byId.set(p.user_id, tp);
  });
  cache = { byEmail, byId };
  listeners.forEach((l) => l());
}

let initialized = false;

/** Subscribe to the team profiles cache. Loads once and refreshes on profile changes. */
export function useTeamProfiles() {
  const [, force] = useState(0);

  useEffect(() => {
    const tick = () => force((n) => n + 1);
    listeners.add(tick);
    if (!initialized) {
      initialized = true;
      refresh();
    }
    return () => {
      listeners.delete(tick);
    };
  }, []);

  // Refresh cache on any profile change (avatar updates, new members, etc.)
  useRealtimeTable("profiles", () => {
    refresh();
  });

  return {
    byEmail: (email?: string | null) =>
      email ? cache.byEmail.get(email.toLowerCase()) ?? null : null,
    byId: (id?: string | null) => (id ? cache.byId.get(id) ?? null : null),
  };
}

/** Get the current user's profile row (creates if missing). */
export async function getOrCreateMyProfile(userId: string, email: string | null) {
  const { data: existing } = await supabase
    .from("profiles")
    .select("user_id, email, display_name, avatar_url")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return existing;

  const displayName = email?.split("@")[0] ?? null;
  const { data: created, error } = await supabase
    .from("profiles")
    .insert({ user_id: userId, email, display_name: displayName })
    .select()
    .maybeSingle();
  if (error?.code === "23505") {
    const { data: racedExisting } = await supabase
      .from("profiles")
      .select("user_id, email, display_name, avatar_url")
      .eq("user_id", userId)
      .maybeSingle();
    return racedExisting;
  }
  if (error) throw error;
  return created;
}

export async function updateMyAvatar(userId: string, avatar_url: string | null) {
  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url })
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();
  if (updateError) throw updateError;
  if (updated) {
    await refresh();
    return;
  }

  const { data: userResp } = await supabase.auth.getUser();
  const email = userResp.user?.email ?? null;
  const displayName =
    userResp.user?.user_metadata?.full_name ??
    userResp.user?.user_metadata?.name ??
    email?.split("@")[0] ??
    null;

  const { error: insertError } = await supabase
    .from("profiles")
    .insert({ user_id: userId, email, display_name: displayName, avatar_url });

  if (insertError?.code === "23505") {
    const { error: retryError } = await supabase
      .from("profiles")
      .update({ avatar_url })
      .eq("user_id", userId);
    if (retryError) throw retryError;
  } else if (insertError) {
    throw insertError;
  }

  await refresh();
}
