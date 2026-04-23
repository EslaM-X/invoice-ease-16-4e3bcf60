-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON public.invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product_id ON public.invoice_items(product_id);
CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON public.invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON public.invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON public.invoices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_product_id ON public.inventory_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_user_id ON public.inventory_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_products_user_id ON public.products(user_id);

-- Prevent negative stock at the database layer
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_stock_non_negative;
ALTER TABLE public.products ADD CONSTRAINT products_stock_non_negative CHECK (stock_quantity >= 0);

-- Atomic, server-side invoice creation
CREATE OR REPLACE FUNCTION public.create_invoice(
  _customer_id uuid,
  _discount numeric,
  _notes text,
  _language text,
  _items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_invoice_id uuid;
  v_invoice_number text;
  v_seq int;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_discount numeric := COALESCE(_discount, 0);
  v_customer record;
  v_item jsonb;
  v_product record;
  v_qty int;
  v_unit_price numeric;
  v_item_discount numeric;
  v_line_total numeric;
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

  -- Customer snapshot (validated to belong to user if provided)
  IF _customer_id IS NOT NULL THEN
    SELECT id, name, phone, address INTO v_customer
    FROM public.customers
    WHERE id = _customer_id AND user_id = v_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_CUSTOMER' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Generate invoice number (per-user yearly sequence)
  SELECT COUNT(*) + 1 INTO v_seq
  FROM public.invoices
  WHERE user_id = v_user_id
    AND date_trunc('year', created_at) = date_trunc('year', now());
  v_invoice_number := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 5, '0');

  -- Create the invoice shell
  INSERT INTO public.invoices (
    user_id, invoice_number, customer_id, customer_name, customer_phone, customer_address,
    subtotal, discount, total, notes, language, status
  ) VALUES (
    v_user_id, v_invoice_number, v_customer.id, v_customer.name, v_customer.phone, v_customer.address,
    0, v_discount, 0, NULLIF(_notes, ''), COALESCE(_language, 'ar'), 'completed'
  ) RETURNING id INTO v_invoice_id;

  -- Process each item: lock product row, validate stock, snapshot price, deduct, log
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
      -- Lock the product row to prevent concurrent overselling
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

      -- Snapshot the price from the database (NOT from the client)
      v_unit_price := v_product.price;
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (
        invoice_id, product_id, product_name, serial_number, color,
        quantity, unit_price, discount, line_total
      ) VALUES (
        v_invoice_id, v_product.id, v_product.name,
        NULLIF(v_item->>'serial_number', ''),
        COALESCE(NULLIF(v_item->>'color', ''), v_product.color),
        v_qty, v_unit_price, v_item_discount, v_line_total
      );

      UPDATE public.products
      SET stock_quantity = stock_quantity - v_qty
      WHERE id = v_product.id;

      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id)
      VALUES (v_user_id, v_product.id, -v_qty, 'sale ' || v_invoice_number, v_invoice_id);
    ELSE
      -- Free-form item (no linked product); accept client price but server still computes line total
      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (
        invoice_id, product_id, product_name, serial_number, color,
        quantity, unit_price, discount, line_total
      ) VALUES (
        v_invoice_id, NULL,
        COALESCE(NULLIF(v_item->>'product_name', ''), 'Item'),
        NULLIF(v_item->>'serial_number', ''),
        NULLIF(v_item->>'color', ''),
        v_qty, v_unit_price, v_item_discount, v_line_total
      );
    END IF;

    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  v_total := GREATEST(0, v_subtotal - v_discount);

  UPDATE public.invoices
  SET subtotal = v_subtotal, total = v_total
  WHERE id = v_invoice_id;

  RETURN v_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice(uuid, numeric, text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.create_invoice(uuid, numeric, text, text, jsonb) TO authenticated;