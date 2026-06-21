
-- Loosen defective_items/defective_item_returns RLS to company-wide
DROP POLICY IF EXISTS "defective_items owner all" ON public.defective_items;
DROP POLICY IF EXISTS "defective_item_returns owner all" ON public.defective_item_returns;

CREATE POLICY "defective_items company read"
  ON public.defective_items FOR SELECT TO authenticated
  USING (public.is_company_member());
CREATE POLICY "defective_items company insert"
  ON public.defective_items FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member());
CREATE POLICY "defective_items company update"
  ON public.defective_items FOR UPDATE TO authenticated
  USING (public.is_company_member()) WITH CHECK (public.is_company_member());

CREATE POLICY "defective_item_returns company read"
  ON public.defective_item_returns FOR SELECT TO authenticated
  USING (public.is_company_member());
CREATE POLICY "defective_item_returns company insert"
  ON public.defective_item_returns FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member());

-- Update register_defective_item to allow any company member to register against any product
CREATE OR REPLACE FUNCTION public.register_defective_item(
  _product_id uuid, _quantity integer, _reason text,
  _serial_number text DEFAULT NULL, _color text DEFAULT NULL,
  _notes text DEFAULT NULL, _item_type text DEFAULT 'defective'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_product record;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_company_member() THEN RAISE EXCEPTION 'Not a company member'; END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
  IF _item_type IS NULL OR _item_type NOT IN ('defective','sample','display','loan') THEN
    _item_type := 'defective';
  END IF;

  SELECT id, name, color, stock_quantity, user_id INTO v_product
  FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF v_product.stock_quantity < _quantity THEN
    RAISE EXCEPTION 'Insufficient stock: % available, % requested', v_product.stock_quantity, _quantity;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user;

  UPDATE public.products
    SET stock_quantity = stock_quantity - _quantity, updated_at = now()
    WHERE id = _product_id;

  INSERT INTO public.defective_items(
    user_id, product_id, product_name, serial_number, color, quantity,
    reason, notes, registered_by, registered_by_email, item_type
  ) VALUES (
    v_product.user_id, _product_id, v_product.name, _serial_number, COALESCE(_color, v_product.color),
    _quantity, _reason, _notes, v_user, v_email, _item_type
  ) RETURNING id INTO v_id;

  INSERT INTO public.inventory_logs(user_id, product_id, change, reason, actor_id, actor_email)
  VALUES (v_product.user_id, _product_id, -_quantity, _item_type || '-out: ' || COALESCE(_reason, ''), v_user, v_email);

  RETURN v_id;
END;
$$;

-- sample_returns header
CREATE TABLE public.sample_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notes text,
  registered_by uuid,
  registered_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.sample_returns TO authenticated;
GRANT ALL ON public.sample_returns TO service_role;
ALTER TABLE public.sample_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sample_returns company read"
  ON public.sample_returns FOR SELECT TO authenticated
  USING (public.is_company_member());
CREATE POLICY "sample_returns company insert"
  ON public.sample_returns FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member() AND registered_by = auth.uid());

-- sample_return_items: each row triggers stock-return for that defective item
CREATE TABLE public.sample_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.sample_returns(id) ON DELETE CASCADE,
  defective_item_id uuid NOT NULL REFERENCES public.defective_items(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.sample_return_items TO authenticated;
GRANT ALL ON public.sample_return_items TO service_role;
ALTER TABLE public.sample_return_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sample_return_items company read"
  ON public.sample_return_items FOR SELECT TO authenticated
  USING (public.is_company_member());
CREATE POLICY "sample_return_items company insert"
  ON public.sample_return_items FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member());

CREATE INDEX idx_sample_return_items_return_id ON public.sample_return_items(return_id);
CREATE INDEX idx_sample_return_items_defective_item_id ON public.sample_return_items(defective_item_id);

-- Trigger: on insert, bump returned_quantity + status, add back to product stock, mirror to defective_item_returns + inventory_logs
CREATE OR REPLACE FUNCTION public.apply_sample_return_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_di record;
  v_user uuid := auth.uid();
  v_email text;
  v_new_returned int;
  v_new_status text;
BEGIN
  SELECT * INTO v_di FROM public.defective_items WHERE id = NEW.defective_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Defective item not found'; END IF;
  v_new_returned := v_di.returned_quantity + NEW.quantity;
  IF v_new_returned > v_di.quantity THEN
    RAISE EXCEPTION 'Return exceeds outstanding quantity (% > %)', v_new_returned, v_di.quantity;
  END IF;
  v_new_status := CASE WHEN v_new_returned >= v_di.quantity THEN 'returned_full' ELSE 'returned_partial' END;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user;

  UPDATE public.defective_items
    SET returned_quantity = v_new_returned, status = v_new_status, updated_at = now()
    WHERE id = NEW.defective_item_id;

  UPDATE public.products
    SET stock_quantity = stock_quantity + NEW.quantity, updated_at = now()
    WHERE id = v_di.product_id;

  INSERT INTO public.defective_item_returns(defective_item_id, user_id, quantity, notes, actor_id, actor_email)
    VALUES (NEW.defective_item_id, v_di.user_id, NEW.quantity, NULL, v_user, v_email);

  INSERT INTO public.inventory_logs(user_id, product_id, change, reason, actor_id, actor_email)
    VALUES (v_di.user_id, v_di.product_id, NEW.quantity, 'sample-return', v_user, v_email);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apply_sample_return_item
  AFTER INSERT ON public.sample_return_items
  FOR EACH ROW EXECUTE FUNCTION public.apply_sample_return_item();

-- Realtime publication
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.sample_returns; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.sample_return_items; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.defective_items; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.defective_item_returns; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
