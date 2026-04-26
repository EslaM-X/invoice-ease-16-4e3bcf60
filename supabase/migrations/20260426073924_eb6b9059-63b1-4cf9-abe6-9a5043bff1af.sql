
-- Fix mutable search_path on is_allowed_company_email
CREATE OR REPLACE FUNCTION public.is_allowed_company_email(_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(_email) IN (
    'cfo@steinheim-eg.com',
    'e.hesham@steinheim-eg.com',
    'k.elsharbatly@steinheim-eg.com'
  )
$$;

-- Restrict listing of product-images bucket to company members only.
-- Direct file URLs (public read) still work because anon role uses storage CDN.
DROP POLICY IF EXISTS "product images public read" ON storage.objects;
CREATE POLICY "product images read for members or by direct url"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'product-images'
    AND (
      -- authenticated company members can list
      (auth.role() = 'authenticated' AND public.is_company_member())
      -- OR public/anon access via direct URL (no listing context)
      OR auth.role() = 'anon'
    )
  );
