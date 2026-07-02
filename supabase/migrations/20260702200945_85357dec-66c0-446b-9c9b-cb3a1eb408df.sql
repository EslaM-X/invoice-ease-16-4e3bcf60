
-- Task manager: role-based
CREATE OR REPLACE FUNCTION public.is_task_manager()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'task_manager'::app_role);
$$;

-- PO delete: role-based
DROP POLICY IF EXISTS "restricted po delete" ON public.purchase_orders;
CREATE POLICY "restricted po delete" ON public.purchase_orders
  FOR DELETE
  USING (public.has_role(auth.uid(), 'po_deleter'::app_role));

-- Simplify scan_sessions update policy (remove tautological self-reference)
DROP POLICY IF EXISTS "own scan sessions update" ON public.scan_sessions;
CREATE POLICY "own scan sessions update" ON public.scan_sessions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
