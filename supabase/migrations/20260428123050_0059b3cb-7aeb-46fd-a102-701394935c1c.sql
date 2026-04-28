-- Add collection field to products to organize by collection (JOY/UP/ART/QUATRO)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS collection text;

-- Validation trigger: only allow approved values or null (kept flexible — future collections can be added)
CREATE OR REPLACE FUNCTION public.validate_product_collection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.collection IS NOT NULL THEN
    NEW.collection := upper(btrim(NEW.collection));
    IF length(NEW.collection) = 0 THEN
      NEW.collection := NULL;
    ELSIF NEW.collection NOT IN ('JOY','UP','ART','QUATRO') THEN
      RAISE EXCEPTION 'INVALID_COLLECTION: %', NEW.collection USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_product_collection ON public.products;
CREATE TRIGGER trg_validate_product_collection
BEFORE INSERT OR UPDATE OF collection ON public.products
FOR EACH ROW EXECUTE FUNCTION public.validate_product_collection();

-- Index for fast filtering by collection
CREATE INDEX IF NOT EXISTS idx_products_collection ON public.products(collection);
CREATE INDEX IF NOT EXISTS idx_products_user_collection ON public.products(user_id, collection);