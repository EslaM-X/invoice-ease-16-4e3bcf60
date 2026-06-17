
-- 1) item_type column on defective_items
ALTER TABLE public.defective_items
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'defective';

ALTER TABLE public.defective_items
  DROP CONSTRAINT IF EXISTS defective_items_item_type_check;
ALTER TABLE public.defective_items
  ADD CONSTRAINT defective_items_item_type_check
  CHECK (item_type IN ('defective','sample','display','loan'));

-- 2) Extend register_defective_item with _item_type
CREATE OR REPLACE FUNCTION public.register_defective_item(
  _product_id uuid,
  _quantity integer,
  _reason text,
  _serial_number text DEFAULT NULL,
  _color text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _item_type text DEFAULT 'defective'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_product record;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
  IF _item_type IS NULL OR _item_type NOT IN ('defective','sample','display','loan') THEN
    _item_type := 'defective';
  END IF;

  SELECT id, name, color, stock_quantity, user_id INTO v_product
  FROM public.products WHERE id = _product_id AND user_id = v_user FOR UPDATE;
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
    v_user, _product_id, v_product.name, _serial_number, COALESCE(_color, v_product.color),
    _quantity, _reason, _notes, v_user, v_email, _item_type
  ) RETURNING id INTO v_id;

  INSERT INTO public.inventory_logs(user_id, product_id, change, reason, actor_id, actor_email)
  VALUES (v_user, _product_id, -_quantity, _item_type || '-out: ' || COALESCE(_reason, ''), v_user, v_email);

  RETURN v_id;
END;
$function$;

-- 3) Approve + grant all roles to k.elsharbatly@steinheim-eg.com
DO $$
DECLARE v_uid uuid;
BEGIN
  SELECT user_id INTO v_uid FROM public.profiles WHERE email='k.elsharbatly@steinheim-eg.com' LIMIT 1;
  IF v_uid IS NULL THEN RAISE NOTICE 'User not found'; RETURN; END IF;

  UPDATE public.profiles
    SET approval_status='approved', approved_at=COALESCE(approved_at, now())
    WHERE user_id = v_uid;

  INSERT INTO public.user_roles(user_id, role)
  SELECT v_uid, r::app_role
  FROM unnest(ARRAY['admin','manager','cashier','call_center','purchasing','cfo','user']) AS r
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;
