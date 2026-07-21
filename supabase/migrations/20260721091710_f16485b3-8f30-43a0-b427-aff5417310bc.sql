CREATE OR REPLACE FUNCTION public.can_access_user_data(_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    auth.uid() = _owner_id
    OR public.is_admin()
    OR (
      EXISTS (SELECT 1 FROM public.company_members WHERE user_id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.company_members WHERE user_id = _owner_id)
    )
$function$;