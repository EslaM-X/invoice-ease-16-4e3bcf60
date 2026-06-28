
-- 1) Restrict price_list_items SELECT to company members (excludes distributors)
DROP POLICY IF EXISTS "authenticated can view active price list" ON public.price_list_items;
CREATE POLICY "company members view active price list"
  ON public.price_list_items
  FOR SELECT
  TO authenticated
  USING (is_active = true AND public.is_company_member() AND NOT public.is_distributor());

-- 2) Tighten storage.objects INSERT policy on backups bucket to require daily/ path prefix
DROP POLICY IF EXISTS "admins write backups bucket" ON storage.objects;
CREATE POLICY "admins write backups bucket"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'backups'
    AND public.is_admin()
    AND name LIKE 'daily/%'
  );
