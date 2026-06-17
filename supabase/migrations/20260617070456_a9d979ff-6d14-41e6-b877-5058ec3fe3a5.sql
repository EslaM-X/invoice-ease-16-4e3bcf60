
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

DROP POLICY IF EXISTS "anyone read price list images" ON storage.objects;
CREATE POLICY "authenticated read price list images"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'price-list-images');
