
-- ========== Fix 1: role-based inventory admin (no more hardcoded emails) ==========
CREATE TABLE IF NOT EXISTS public.inventory_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.inventory_admins TO authenticated;
GRANT ALL ON public.inventory_admins TO service_role;
ALTER TABLE public.inventory_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage inventory admins" ON public.inventory_admins;
CREATE POLICY "admins manage inventory admins" ON public.inventory_admins
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "self can see own inventory admin row" ON public.inventory_admins;
CREATE POLICY "self can see own inventory admin row" ON public.inventory_admins
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

INSERT INTO public.inventory_admins (user_id)
SELECT id FROM auth.users
WHERE lower(email) IN ('k.elsharbatly@steinheim-eg.com','e.hesham@steinheim-eg.com')
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_inventory_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.inventory_admins WHERE user_id = auth.uid())
      OR public.is_admin();
$$;

-- ========== Fix 2: hide sensitive HR approval columns from broad company visibility ==========
-- Row-level policies still gate row access; column privileges here ensure that
-- even when a company member can read a peer's profile row, the sensitive HR
-- fields are not exposed via PostgREST.
REVOKE SELECT (approval_notes, approved_by, approved_at) ON public.profiles FROM authenticated;
REVOKE SELECT (approval_notes, approved_by, approved_at) ON public.profiles FROM anon;

-- Owner-scoped helper so a user can still see their own approval note
-- (e.g. rejection reason in the account-status screen).
CREATE OR REPLACE FUNCTION public.get_my_approval_state()
RETURNS TABLE (account_type text, approval_status text, approval_notes text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.account_type, p.approval_status, p.approval_notes
  FROM public.profiles p
  WHERE p.user_id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.get_my_approval_state() TO authenticated;

-- Admin-only helper so approval history remains visible to admins in future UIs.
CREATE OR REPLACE FUNCTION public.get_profile_approval_admin(_user_id uuid)
RETURNS TABLE (approval_status text, approval_notes text, approved_by uuid, approved_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.approval_status, p.approval_notes, p.approved_by, p.approved_at
  FROM public.profiles p
  WHERE p.user_id = _user_id
    AND public.is_admin();
$$;
GRANT EXECUTE ON FUNCTION public.get_profile_approval_admin(uuid) TO authenticated;
