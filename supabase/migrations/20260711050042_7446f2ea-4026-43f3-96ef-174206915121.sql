
-- 1) app_updates: restrict SELECT to company members (not all authenticated, e.g. distributors)
DROP POLICY IF EXISTS "Authenticated users can view updates" ON public.app_updates;
CREATE POLICY "Company members can view updates"
  ON public.app_updates FOR SELECT
  TO authenticated
  USING (public.is_company_member());

-- 2) product-images: strictly require folder = auth.uid() for INSERT (no admin bypass on write path)
DROP POLICY IF EXISTS "product images owner or admin upload" ON storage.objects;
CREATE POLICY "product images owner upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND public.is_company_member()
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );
