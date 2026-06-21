
-- 1) Consolidate duplicate chat-voice-notes policies
DROP POLICY IF EXISTS "voice notes owner delete" ON storage.objects;
DROP POLICY IF EXISTS "voice notes room members read" ON storage.objects;
DROP POLICY IF EXISTS "voice notes room members upload" ON storage.objects;

-- 2) product-images: require path-based ownership on write/update/delete
DROP POLICY IF EXISTS "company members upload product images" ON storage.objects;
DROP POLICY IF EXISTS "company members update product images" ON storage.objects;
DROP POLICY IF EXISTS "company members delete product images" ON storage.objects;

CREATE POLICY "product images owner or admin upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND is_company_member()
    AND ((auth.uid())::text = (storage.foldername(name))[1] OR is_admin())
  );

CREATE POLICY "product images owner or admin update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (owner = auth.uid() OR is_admin())
  )
  WITH CHECK (
    bucket_id = 'product-images'
    AND (owner = auth.uid() OR is_admin())
  );

CREATE POLICY "product images owner or admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (owner = auth.uid() OR is_admin())
  );

-- 3) invoices-pdf: require path-based ownership on write/update/delete
DROP POLICY IF EXISTS "invoices pdf company insert" ON storage.objects;
DROP POLICY IF EXISTS "invoices pdf company update" ON storage.objects;
DROP POLICY IF EXISTS "invoices pdf company delete" ON storage.objects;

CREATE POLICY "invoices pdf owner or admin insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'invoices-pdf'
    AND is_company_member()
    AND ((auth.uid())::text = (storage.foldername(name))[1] OR is_admin())
  );

CREATE POLICY "invoices pdf owner or admin update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'invoices-pdf'
    AND (owner = auth.uid() OR is_admin())
  )
  WITH CHECK (
    bucket_id = 'invoices-pdf'
    AND (owner = auth.uid() OR is_admin())
  );

CREATE POLICY "invoices pdf owner or admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'invoices-pdf'
    AND (owner = auth.uid() OR is_admin())
  );

-- 4) whatsapp-media: require path-based ownership on write/update/delete
DROP POLICY IF EXISTS "wa media company insert" ON storage.objects;
DROP POLICY IF EXISTS "wa media company update" ON storage.objects;
DROP POLICY IF EXISTS "wa media company delete" ON storage.objects;

CREATE POLICY "wa media owner or admin insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'whatsapp-media'
    AND is_company_member()
    AND ((auth.uid())::text = (storage.foldername(name))[1] OR is_admin())
  );

CREATE POLICY "wa media owner or admin update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'whatsapp-media'
    AND (owner = auth.uid() OR is_admin())
  )
  WITH CHECK (
    bucket_id = 'whatsapp-media'
    AND (owner = auth.uid() OR is_admin())
  );

CREATE POLICY "wa media owner or admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'whatsapp-media'
    AND (owner = auth.uid() OR is_admin())
  );
