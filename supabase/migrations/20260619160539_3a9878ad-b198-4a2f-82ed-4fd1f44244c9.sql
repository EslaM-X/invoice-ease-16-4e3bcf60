
-- 1) audit_log INSERT: require company membership
DROP POLICY IF EXISTS "company audit_log insert" ON public.audit_log;
CREATE POLICY "company audit_log insert" ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND actor_id = auth.uid() AND public.is_company_member());

-- 2) Drop dead/misleading SELECT policy on storage.objects for public bucket
DROP POLICY IF EXISTS "product images read for company members" ON storage.objects;

-- 3) Realtime: restrict scan_sessions topic subscriptions to the owner
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scan_sessions realtime owner only" ON realtime.messages;
CREATE POLICY "scan_sessions realtime owner only" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    CASE
      WHEN realtime.topic() LIKE 'scan_sessions%' THEN EXISTS (
        SELECT 1 FROM public.scan_sessions s
        WHERE s.user_id = auth.uid()
      )
      ELSE true
    END
  );
