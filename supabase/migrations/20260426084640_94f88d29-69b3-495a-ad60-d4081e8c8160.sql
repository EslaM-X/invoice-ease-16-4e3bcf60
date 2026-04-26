
-- Fix infinite recursion on company_members policy by using a SECURITY DEFINER function
DROP POLICY IF EXISTS "members can view team" ON public.company_members;

CREATE POLICY "members can view team"
ON public.company_members
FOR SELECT
TO authenticated
USING (public.is_company_member() OR auth.uid() = user_id);
