DROP POLICY IF EXISTS "distributor updates own profile" ON public.distributors;
CREATE POLICY "distributor updates own profile"
ON public.distributors
FOR UPDATE
TO authenticated
USING (user_id = auth.uid() AND is_active = true)
WITH CHECK (user_id = auth.uid() AND is_active = true);