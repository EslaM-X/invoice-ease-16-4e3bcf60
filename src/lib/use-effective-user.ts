import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useAuth } from "@/lib/auth";
import { useIsSuperAdmin } from "@/lib/super-admin";
import { getImpersonateId } from "@/lib/use-ui-prefs";
import { loadUserPreviewContext } from "@/lib/access-studio.functions";

export type EffectiveUser = {
  id: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  roles: string[];
  loading: boolean;
  isPreviewing: boolean;
  previewUserId: string | null;
  actualUser: User | null;
};

function metaName(user: User | null): string | null {
  const meta = (user as any)?.user_metadata ?? {};
  return meta.display_name ?? meta.full_name ?? meta.name ?? null;
}

function metaAvatar(user: User | null): string | null {
  const meta = (user as any)?.user_metadata ?? {};
  return meta.avatar_url ?? meta.picture ?? meta.avatar ?? null;
}

export function useEffectiveUser(): EffectiveUser {
  const { user, loading: authLoading } = useAuth();
  const isActualSuper = useIsSuperAdmin();
  const [previewUserId, setPreviewUserId] = useState<string | null>(() => getImpersonateId());
  const [preview, setPreview] = useState<{
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
    roles: string[];
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    const sync = () => setPreviewUserId(getImpersonateId());
    window.addEventListener("storage", sync);
    window.addEventListener("app:impersonation-changed", sync as EventListener);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("app:impersonation-changed", sync as EventListener);
    };
  }, []);

  const shouldPreview = !!user && isActualSuper && !!previewUserId;

  useEffect(() => {
    if (!shouldPreview || !previewUserId) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    loadUserPreviewContext({ data: { user_id: previewUserId } } as any)
      .then((ctx: any) => {
        if (cancelled) return;
        setPreview({
          email: ctx?.email ?? null,
          display_name: ctx?.display_name ?? null,
          avatar_url: ctx?.avatar_url ?? null,
          roles: Array.isArray(ctx?.roles) ? ctx.roles.map(String) : [],
        });
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => { cancelled = true; };
  }, [shouldPreview, previewUserId, user?.id]);

  return useMemo(() => {
    if (shouldPreview) {
      return {
        id: previewUserId,
        email: preview?.email ?? null,
        displayName: preview?.display_name ?? preview?.email?.split("@")[0] ?? null,
        avatarUrl: preview?.avatar_url ?? null,
        roles: preview?.roles ?? [],
        loading: previewLoading,
        isPreviewing: true,
        previewUserId,
        actualUser: user,
      };
    }

    return {
      id: user?.id ?? null,
      email: user?.email ?? null,
      displayName: metaName(user) ?? user?.email?.split("@")[0] ?? null,
      avatarUrl: metaAvatar(user),
      roles: [],
      loading: authLoading,
      isPreviewing: false,
      previewUserId: null,
      actualUser: user,
    };
  }, [authLoading, preview, previewLoading, previewUserId, shouldPreview, user]);
}