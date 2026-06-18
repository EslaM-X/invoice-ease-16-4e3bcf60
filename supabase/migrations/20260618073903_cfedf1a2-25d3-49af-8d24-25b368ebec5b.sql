
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
             WHERE schemaname='public' AND tablename='profiles' AND cmd='UPDATE'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Users can update own profile (non-approval fields)"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND (
    public.has_role(auth.uid(), 'admin')
    OR (
      approval_status    IS NOT DISTINCT FROM (SELECT p.approval_status  FROM public.profiles p WHERE p.user_id = profiles.user_id)
      AND approved_by    IS NOT DISTINCT FROM (SELECT p.approved_by     FROM public.profiles p WHERE p.user_id = profiles.user_id)
      AND approved_at    IS NOT DISTINCT FROM (SELECT p.approved_at     FROM public.profiles p WHERE p.user_id = profiles.user_id)
      AND approval_notes IS NOT DISTINCT FROM (SELECT p.approval_notes  FROM public.profiles p WHERE p.user_id = profiles.user_id)
    )
  )
);

CREATE POLICY "Admins can update any profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
             WHERE schemaname='public' AND tablename='fulfillment_audit_log' AND cmd='SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.fulfillment_audit_log', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Company members can view fulfillment audit log"
ON public.fulfillment_audit_log
FOR SELECT
TO authenticated
USING (public.can_access_user_data(user_id));
