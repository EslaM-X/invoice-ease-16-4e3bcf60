-- Price history table for products (cost_price + price)
CREATE TABLE IF NOT EXISTS public.product_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  field text NOT NULL CHECK (field IN ('cost_price','price')),
  old_value numeric,
  new_value numeric,
  changed_by uuid,
  changed_by_email text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pph_product ON public.product_price_history(product_id, changed_at DESC);

ALTER TABLE public.product_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members read price history"
  ON public.product_price_history FOR SELECT TO authenticated
  USING (public.is_company_member() OR EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_price_history.product_id
      AND public.can_access_user_data(p.user_id)
  ));

CREATE POLICY "system insert price history"
  ON public.product_price_history FOR INSERT TO authenticated
  WITH CHECK (true);

-- Trigger: log every change to cost_price / price
CREATE OR REPLACE FUNCTION public.log_product_price_changes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  END IF;

  IF NEW.cost_price IS DISTINCT FROM OLD.cost_price THEN
    INSERT INTO public.product_price_history(product_id, field, old_value, new_value, changed_by, changed_by_email)
    VALUES (NEW.id, 'cost_price', OLD.cost_price, NEW.cost_price, v_uid, v_email);
  END IF;

  IF NEW.price IS DISTINCT FROM OLD.price THEN
    INSERT INTO public.product_price_history(product_id, field, old_value, new_value, changed_by, changed_by_email)
    VALUES (NEW.id, 'price', OLD.price, NEW.price, v_uid, v_email);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_product_price_changes ON public.products;
CREATE TRIGGER trg_log_product_price_changes
AFTER UPDATE OF cost_price, price ON public.products
FOR EACH ROW EXECUTE FUNCTION public.log_product_price_changes();