
-- ============ BATCH 3a: discount on PO receipts (UI only) ============
ALTER TABLE public.po_receipts
  ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0;

-- ============ BATCH 3b: defective items tracker ============
CREATE TABLE IF NOT EXISTS public.defective_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  serial_number text,
  color text,
  quantity integer NOT NULL CHECK (quantity > 0),
  returned_quantity integer NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'out',  -- out | returned_partial | returned_full
  notes text,
  registered_by uuid,
  registered_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.defective_items TO authenticated;
GRANT ALL ON public.defective_items TO service_role;
ALTER TABLE public.defective_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "defective_items owner all" ON public.defective_items;
CREATE POLICY "defective_items owner all"
  ON public.defective_items FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS defective_items_user_idx ON public.defective_items(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS defective_items_product_idx ON public.defective_items(product_id);

CREATE TABLE IF NOT EXISTS public.defective_item_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defective_item_id uuid NOT NULL REFERENCES public.defective_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  notes text,
  actor_id uuid,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.defective_item_returns TO authenticated;
GRANT ALL ON public.defective_item_returns TO service_role;
ALTER TABLE public.defective_item_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "defective_item_returns owner all" ON public.defective_item_returns;
CREATE POLICY "defective_item_returns owner all"
  ON public.defective_item_returns FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS defective_item_returns_parent_idx ON public.defective_item_returns(defective_item_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS defective_items_touch_updated_at ON public.defective_items;
CREATE TRIGGER defective_items_touch_updated_at
  BEFORE UPDATE ON public.defective_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RPC: register a defective item (deducts from stock + logs)
CREATE OR REPLACE FUNCTION public.register_defective_item(
  _product_id uuid,
  _quantity integer,
  _reason text,
  _serial_number text DEFAULT NULL,
  _color text DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_product record;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;

  SELECT id, name, color, stock_quantity, user_id INTO v_product
  FROM public.products WHERE id = _product_id AND user_id = v_user;
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
    reason, notes, registered_by, registered_by_email
  ) VALUES (
    v_user, _product_id, v_product.name, _serial_number, COALESCE(_color, v_product.color),
    _quantity, _reason, _notes, v_user, v_email
  ) RETURNING id INTO v_id;

  INSERT INTO public.inventory_logs(user_id, product_id, change_qty, reason, actor_id, actor_email)
  VALUES (v_user, _product_id, -_quantity, 'defective-out: ' || COALESCE(_reason, ''), v_user, v_email);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_defective_item(uuid, integer, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_defective_item(uuid, integer, text, text, text, text) TO authenticated;

-- RPC: return a quantity of a defective item back to stock
CREATE OR REPLACE FUNCTION public.return_defective_item(
  _defective_id uuid,
  _quantity integer,
  _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_d record;
  v_remaining integer;
  v_new_returned integer;
  v_new_status text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;

  SELECT * INTO v_d FROM public.defective_items WHERE id = _defective_id AND user_id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Defective item not found'; END IF;

  v_remaining := v_d.quantity - v_d.returned_quantity;
  IF _quantity > v_remaining THEN
    RAISE EXCEPTION 'Cannot return % — only % remaining', _quantity, v_remaining;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user;

  v_new_returned := v_d.returned_quantity + _quantity;
  v_new_status := CASE WHEN v_new_returned >= v_d.quantity THEN 'returned_full' ELSE 'returned_partial' END;

  UPDATE public.products
    SET stock_quantity = stock_quantity + _quantity, updated_at = now()
    WHERE id = v_d.product_id;

  UPDATE public.defective_items
    SET returned_quantity = v_new_returned, status = v_new_status, updated_at = now()
    WHERE id = _defective_id;

  INSERT INTO public.defective_item_returns(
    defective_item_id, user_id, quantity, notes, actor_id, actor_email
  ) VALUES (_defective_id, v_user, _quantity, _notes, v_user, v_email);

  INSERT INTO public.inventory_logs(user_id, product_id, change_qty, reason, actor_id, actor_email)
  VALUES (v_user, v_d.product_id, _quantity, 'defective-return: ' || COALESCE(_notes, ''), v_user, v_email);
END;
$$;

REVOKE ALL ON FUNCTION public.return_defective_item(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_defective_item(uuid, integer, text) TO authenticated;
