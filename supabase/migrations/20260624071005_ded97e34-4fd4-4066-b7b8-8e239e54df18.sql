
-- 1) Fix SECURITY DEFINER view: replace view with SECURITY DEFINER RPC that exposes only safe columns
DROP VIEW IF EXISTS public.distributor_products_view CASCADE;

CREATE OR REPLACE FUNCTION public.list_distributor_products()
RETURNS TABLE (
  id uuid,
  name text,
  serial_number text,
  color text,
  price numeric,
  image_url text,
  collection text,
  is_spare_part boolean,
  parent_product_id uuid,
  low_stock_threshold integer,
  available_stock integer,
  updated_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    p.serial_number,
    p.color,
    p.price,
    p.image_url,
    p.collection,
    p.is_spare_part,
    p.parent_product_id,
    p.low_stock_threshold,
    GREATEST(COALESCE(p.stock_quantity, 0) - COALESCE(p.safety_margin, 0), 0)::integer AS available_stock,
    p.updated_at,
    p.created_at
  FROM public.products p
  WHERE public.is_distributor();
$$;

REVOKE ALL ON FUNCTION public.list_distributor_products() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_distributor_products() TO authenticated;

-- 2) Tighten products SELECT policy to explicitly exclude distributors (cost columns protection)
DROP POLICY IF EXISTS "company products select" ON public.products;
CREATE POLICY "company products select"
  ON public.products
  FOR SELECT
  TO authenticated
  USING (public.can_access_user_data(user_id) AND NOT public.is_distributor());

-- 3) Tighten invoices-pdf storage read policy to exclude distributors
DROP POLICY IF EXISTS "invoices pdf company read" ON storage.objects;
CREATE POLICY "invoices pdf company read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'invoices-pdf'
    AND public.is_company_member()
    AND NOT public.is_distributor()
  );
