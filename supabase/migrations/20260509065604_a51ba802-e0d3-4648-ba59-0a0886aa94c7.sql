
-- 1. product-images: drop anon read; restrict to authenticated company members (public CDN URL still works)
DROP POLICY IF EXISTS "product images read for members or by direct url" ON storage.objects;
CREATE POLICY "product images read for company members"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'product-images' AND public.is_company_member());

-- 2. logos: restrict reads to authenticated company members
DROP POLICY IF EXISTS "logos public read" ON storage.objects;
CREATE POLICY "logos read for company members"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'logos' AND public.is_company_member());

-- Restrict logos write/update/delete to authenticated (was {public})
DROP POLICY IF EXISTS "logos user upload" ON storage.objects;
DROP POLICY IF EXISTS "logos user update" ON storage.objects;
DROP POLICY IF EXISTS "logos user delete" ON storage.objects;
CREATE POLICY "logos user upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'logos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "logos user update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'logos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "logos user delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'logos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 3. audit_log INSERT: enforce actor_id = auth.uid()
DROP POLICY IF EXISTS "company audit_log insert" ON public.audit_log;
CREATE POLICY "company audit_log insert" ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND actor_id = auth.uid());

-- 4. backups_log INSERT: admins only (service role bypasses RLS anyway)
DROP POLICY IF EXISTS "system insert backups" ON public.backups_log;
CREATE POLICY "admins insert backups" ON public.backups_log
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- 5. product_price_history INSERT: company members with access to the product
DROP POLICY IF EXISTS "system insert price history" ON public.product_price_history;
CREATE POLICY "company members insert price history" ON public.product_price_history
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_price_history.product_id
        AND public.can_access_user_data(p.user_id)
    )
  );

-- 6. invoice_system_notes_history INSERT: company members with access to the invoice
DROP POLICY IF EXISTS "system insert system notes history" ON public.invoice_system_notes_history;
CREATE POLICY "company members insert system notes history" ON public.invoice_system_notes_history
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_system_notes_history.invoice_id
        AND public.can_access_user_data(i.user_id)
    )
  );

-- 7. Revoke EXECUTE on internal SECURITY DEFINER helpers from anon/public
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_company_member() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_access_user_data(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_access_call_center() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_super_admin_email(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_allowed_company_email(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.create_invoice(uuid, numeric, text, text, jsonb, numeric) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.create_invoice(uuid, numeric, text, text, jsonb, numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.update_invoice(uuid, uuid, numeric, text, text, jsonb, numeric) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.update_invoice(uuid, uuid, numeric, text, text, jsonb, numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.delete_invoice(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.void_invoice(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.adjust_stock(uuid, integer, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.pair_scan_session(text) FROM anon, public;
