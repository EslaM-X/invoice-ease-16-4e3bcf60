
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('email_send_state','email_unsubscribe_tokens','email_send_log','suppressed_emails')
      AND 'public' = ANY(roles)
  LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I TO service_role', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

ALTER POLICY "restricted po delete" ON public.purchase_orders TO authenticated;
ALTER POLICY "own scan sessions update" ON public.scan_sessions TO authenticated;
ALTER POLICY "own settings select" ON public.settings TO authenticated;
ALTER POLICY "own settings insert" ON public.settings TO authenticated;
ALTER POLICY "own settings update" ON public.settings TO authenticated;
ALTER POLICY "users view own roles" ON public.user_roles TO authenticated;

DROP POLICY IF EXISTS "Public read zoho images" ON storage.objects;
CREATE POLICY "Company members read zoho images"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'zoho-images' AND public.is_company_member());
