
-- Tighten audit_log SELECT: only admins see all rows; users see only their own actions.
DROP POLICY IF EXISTS "company audit_log select" ON public.audit_log;
CREATE POLICY "audit_log select admin or self"
ON public.audit_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR auth.uid() = actor_id);

-- Harden scan_sessions UPDATE: prevent changing ownership or pair_code post-creation.
DROP POLICY IF EXISTS "own scan sessions update" ON public.scan_sessions;
CREATE POLICY "own scan sessions update"
ON public.scan_sessions
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND pair_code = (SELECT s.pair_code FROM public.scan_sessions s WHERE s.id = scan_sessions.id)
  AND user_id  = (SELECT s.user_id  FROM public.scan_sessions s WHERE s.id = scan_sessions.id)
);
