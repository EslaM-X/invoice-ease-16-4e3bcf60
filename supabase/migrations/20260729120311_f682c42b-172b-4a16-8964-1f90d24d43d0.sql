CREATE OR REPLACE FUNCTION public.add_invoice_items(
  _invoice_id uuid,
  _items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_email text;
  v_invoice record;
  v_item jsonb;
  v_product record;
  v_qty int;
  v_unit_price numeric;
  v_item_discount numeric;
  v_line_total numeric;
  v_serial_number text;
  v_color text;
  v_product_name text;
  v_new_item_id uuid;
  v_new_subtotal numeric := 0;
  v_new_total numeric := 0;
  v_added int := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'NO_ITEMS' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = _invoice_id AND public.can_access_user_data(user_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  IF v_invoice.status = 'voided' THEN
    RAISE EXCEPTION 'INVOICE_VOIDED' USING ERRCODE = '22023';
  END IF;
  IF v_invoice.status = 'draft' THEN
    RAISE EXCEPTION 'INVOICE_IS_DRAFT_USE_UPDATE' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    v_item_discount := COALESCE((v_item->>'discount')::numeric, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023';
    END IF;
    IF v_item_discount < 0 THEN
      RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023';
    END IF;

    IF (v_item->>'product_id') IS NOT NULL AND (v_item->>'product_id') <> '' THEN
      SELECT id, name, price, stock_quantity, serial_number, color, user_id
      INTO v_product
      FROM public.products
      WHERE id = (v_item->>'product_id')::uuid
        AND public.can_access_user_data(user_id)
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_PRODUCT' USING ERRCODE = '22023';
      END IF;

      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_product.price, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_serial_number := NULLIF(v_item->>'serial_number', '');
      v_color := NULLIF(v_item->>'color', '');
      v_product_name := COALESCE(NULLIF(v_item->>'product_name',''), v_product.name, 'Item');
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (
        invoice_id, product_id, product_name, serial_number, color,
        quantity, unit_price, discount, line_total
      ) VALUES (
        _invoice_id, v_product.id, v_product_name, v_serial_number,
        COALESCE(v_color, v_product.color), v_qty, v_unit_price, v_item_discount, v_line_total
      ) RETURNING id INTO v_new_item_id;

      PERFORM public.cover_invoice_item(
        _invoice_id, v_new_item_id, v_product.id, v_qty,
        v_user_id, v_actor_email, 'add-to-invoice', v_invoice.invoice_number
      );
    ELSE
      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (
        invoice_id, product_id, product_name, serial_number, color,
        quantity, unit_price, discount, line_total
      ) VALUES (
        _invoice_id, NULL,
        COALESCE(NULLIF(v_item->>'product_name',''), 'Item'),
        NULLIF(v_item->>'serial_number',''),
        NULLIF(v_item->>'color',''),
        v_qty, v_unit_price, v_item_discount, v_line_total
      );
    END IF;
    v_added := v_added + 1;
  END LOOP;

  -- Recompute totals from ALL current items
  SELECT COALESCE(SUM(line_total), 0) INTO v_new_subtotal
  FROM public.invoice_items WHERE invoice_id = _invoice_id;
  v_new_total := GREATEST(0, v_new_subtotal - COALESCE(v_invoice.discount, 0));

  UPDATE public.invoices
  SET subtotal = v_new_subtotal,
      total = v_new_total,
      updated_at = now(),
      updated_by = v_user_id,
      updated_by_email = v_actor_email
  WHERE id = _invoice_id;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (
    _invoice_id, v_user_id, 'items_added',
    jsonb_build_object(
      'added_count', v_added,
      'previous_total', v_invoice.total,
      'new_total', v_new_total,
      'actor_email', v_actor_email
    )
  );

  RETURN _invoice_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.add_invoice_items(uuid, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.add_invoice_items(uuid, jsonb) FROM anon, PUBLIC;