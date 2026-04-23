
-- Index for fast filtering by status (voided/completed) per user
CREATE INDEX IF NOT EXISTS idx_invoices_user_status_created
  ON public.invoices (user_id, status, created_at DESC);

-- =============================================================
-- update_invoice: atomic edit of an existing invoice
-- =============================================================
CREATE OR REPLACE FUNCTION public.update_invoice(
  _invoice_id uuid,
  _customer_id uuid,
  _discount numeric,
  _notes text,
  _language text,
  _items jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_invoice record;
  v_old_item record;
  v_item jsonb;
  v_product record;
  v_qty int;
  v_unit_price numeric;
  v_item_discount numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_discount numeric := COALESCE(_discount, 0);
  v_cust_id uuid := NULL;
  v_cust_name text := NULL;
  v_cust_phone text := NULL;
  v_cust_address text := NULL;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'NO_ITEMS' USING ERRCODE = '22023';
  END IF;
  IF v_discount < 0 THEN
    RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023';
  END IF;

  -- Lock invoice
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = _invoice_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  IF v_invoice.status = 'voided' THEN
    RAISE EXCEPTION 'INVOICE_VOIDED' USING ERRCODE = '22023';
  END IF;

  -- Customer snapshot
  IF _customer_id IS NOT NULL THEN
    SELECT id, name, phone, address
      INTO v_cust_id, v_cust_name, v_cust_phone, v_cust_address
    FROM public.customers
    WHERE id = _customer_id AND user_id = v_user_id;
    IF v_cust_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_CUSTOMER' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 1) Restore stock from existing items (lock products as we go)
  FOR v_old_item IN
    SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id
  LOOP
    IF v_old_item.product_id IS NOT NULL THEN
      PERFORM 1 FROM public.products WHERE id = v_old_item.product_id FOR UPDATE;
      UPDATE public.products
        SET stock_quantity = stock_quantity + v_old_item.quantity
        WHERE id = v_old_item.product_id;
      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id)
      VALUES (v_user_id, v_old_item.product_id, v_old_item.quantity,
              'edit-revert ' || v_invoice.invoice_number, _invoice_id);
    END IF;
  END LOOP;

  -- 2) Remove old items
  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;

  -- 3) Insert new items, validating + deducting stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    v_item_discount := COALESCE((v_item->>'discount')::numeric, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023';
    END IF;
    IF v_item_discount < 0 THEN
      RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023';
    END IF;

    IF (v_item->>'product_id') IS NOT NULL AND (v_item->>'product_id') <> '' THEN
      SELECT id, name, price, stock_quantity, serial_number, color
      INTO v_product
      FROM public.products
      WHERE id = (v_item->>'product_id')::uuid AND user_id = v_user_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_PRODUCT' USING ERRCODE = '22023';
      END IF;
      IF v_product.stock_quantity < v_qty THEN
        RAISE EXCEPTION 'OUT_OF_STOCK:%', v_product.name USING ERRCODE = '22023';
      END IF;

      v_unit_price := v_product.price;
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (
        invoice_id, product_id, product_name, serial_number, color,
        quantity, unit_price, discount, line_total
      ) VALUES (
        _invoice_id, v_product.id, v_product.name,
        NULLIF(v_item->>'serial_number',''),
        COALESCE(NULLIF(v_item->>'color',''), v_product.color),
        v_qty, v_unit_price, v_item_discount, v_line_total
      );

      UPDATE public.products
        SET stock_quantity = stock_quantity - v_qty
        WHERE id = v_product.id;

      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id)
      VALUES (v_user_id, v_product.id, -v_qty,
              'edit-resale ' || v_invoice.invoice_number, _invoice_id);
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
        COALESCE(NULLIF(v_item->>'product_name',''),'Item'),
        NULLIF(v_item->>'serial_number',''),
        NULLIF(v_item->>'color',''),
        v_qty, v_unit_price, v_item_discount, v_line_total
      );
    END IF;

    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  v_total := GREATEST(0, v_subtotal - v_discount);

  UPDATE public.invoices
  SET subtotal = v_subtotal,
      discount = v_discount,
      total = v_total,
      notes = NULLIF(_notes, ''),
      language = COALESCE(_language, language),
      customer_id = v_cust_id,
      customer_name = v_cust_name,
      customer_phone = v_cust_phone,
      customer_address = v_cust_address,
      updated_at = now()
  WHERE id = _invoice_id;

  RETURN _invoice_id;
END;
$$;

-- =============================================================
-- void_invoice: restore stock + mark as voided
-- =============================================================
CREATE OR REPLACE FUNCTION public.void_invoice(_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_invoice record;
  v_item record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = _invoice_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  IF v_invoice.status = 'voided' THEN
    RETURN _invoice_id;
  END IF;

  FOR v_item IN
    SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id
  LOOP
    IF v_item.product_id IS NOT NULL THEN
      PERFORM 1 FROM public.products WHERE id = v_item.product_id FOR UPDATE;
      UPDATE public.products
        SET stock_quantity = stock_quantity + v_item.quantity
        WHERE id = v_item.product_id;
      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id)
      VALUES (v_user_id, v_item.product_id, v_item.quantity,
              'void ' || v_invoice.invoice_number, _invoice_id);
    END IF;
  END LOOP;

  UPDATE public.invoices
    SET status = 'voided', updated_at = now()
    WHERE id = _invoice_id;

  RETURN _invoice_id;
END;
$$;

-- =============================================================
-- delete_invoice: restore stock then hard delete
-- =============================================================
CREATE OR REPLACE FUNCTION public.delete_invoice(_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_invoice record;
  v_item record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = _invoice_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  -- Only restore stock if not already voided
  IF v_invoice.status <> 'voided' THEN
    FOR v_item IN
      SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id
    LOOP
      IF v_item.product_id IS NOT NULL THEN
        PERFORM 1 FROM public.products WHERE id = v_item.product_id FOR UPDATE;
        UPDATE public.products
          SET stock_quantity = stock_quantity + v_item.quantity
          WHERE id = v_item.product_id;
        INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id)
        VALUES (v_user_id, v_item.product_id, v_item.quantity,
                'delete ' || v_invoice.invoice_number, _invoice_id);
      END IF;
    END LOOP;
  END IF;

  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;
  DELETE FROM public.invoices WHERE id = _invoice_id;

  RETURN _invoice_id;
END;
$$;
