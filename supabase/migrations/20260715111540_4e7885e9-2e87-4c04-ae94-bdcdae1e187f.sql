-- Fix infinite recursion on profiles UPDATE policy.
-- The WITH CHECK subqueries SELECT FROM profiles, which re-triggers the SELECT policies during UPDATE evaluation and recurses.
-- The trigger prevent_profile_approval_self_edit already prevents non-admins from changing approval fields, so RLS can be simplified.
DROP POLICY IF EXISTS "Users can update own profile (non-approval fields)" ON public.profiles;

CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);