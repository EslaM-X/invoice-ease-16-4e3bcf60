
-- 1) Receipt counter: monotonically increments per user per invoice creation, never decrements on edits/voids
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS receipt_number bigint;

CREATE TABLE IF NOT EXISTS public.user_counters (
  user_id uuid PRIMARY KEY,
  receipt_seq bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own counter select" ON public.user_counters
  FOR SELECT USING (auth.uid() = user_id);

-- 2) Invoice events timeline (created / edited / voided / deleted-attempt)
CREATE TABLE IF NOT EXISTS public.invoice_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('created','edited','voided','restored')),
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_events_invoice ON public.invoice_events(invoice_id, created_at);

ALTER TABLE public.invoice_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own invoice events select" ON public.invoice_events
  FOR SELECT USING (auth.uid() = user_id);

-- 3) Update create_invoice to allocate receipt_number atomically and log creation event
CREATE OR REPLACE FUNCTION public.create_invoice(_customer_id uuid, _discount numeric, _notes text, _language text, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_invoice_id uuid;
  v_invoice_number text;
  v_receipt_no bigint;
  v_seq int;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_discount numeric := COALESCE(_discount, 0);
  v_cust_id uuid := NULL;
  v_cust_name text := NULL;
  v_cust_phone text := NULL;
  v_cust_address text := NULL;
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

  IF _customer_id IS NOT NULL THEN
    SELECT id, name, phone, address
      INTO v_cust_id, v_cust_name, v_cust_phone, v_cust_address
    FROM public.customers
    WHERE id = _customer_id AND user_id = v_user_id;
    IF v_cust_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_CUSTOMER' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Allocate monotonic receipt number atomically
  INSERT INTO public.user_counters (user_id, receipt_seq)
    VALUES (v_user_id, 1)
  ON CONFLICT (user_id) DO UPDATE
    SET receipt_seq = public.user_counters.receipt_seq + 1,
        updated_at = now()
  RETURNING receipt_seq INTO v_receipt_no;

  SELECT COUNT(*) + 1 INTO v_seq
  FROM public.invoices
  WHERE user_id = v_user_id
    AND date_trunc('year', created_at) = date_trunc('year', now());
  v_invoice_number := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 5, '0');

  INSERT INTO public.invoices (
    user_id, invoice_number, receipt_number,
    customer_id, customer_name, customer_phone, customer_address,
    subtotal, discount, total, notes, language, status
  ) VALUES (
    v_user_id, v_invoice_number, v_receipt_no,
    v_cust_id, v_cust_name, v_cust_phone, v_cust_address,
    0, v_discount, 0, NULLIF(_notes, ''), COALESCE(_language, 'ar'), 'completed'
  ) RETURNING id INTO v_invoice_id;

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
        v_invoice_id, v_product.id, v_product.name,
        NULLIF(v_item->>'serial_number',''),
        COALESCE(NULLIF(v_item->>'color',''), v_product.color),
        v_qty, v_unit_price, v_item_discount, v_line_total
      );

      UPDATE public.products
      SET stock_quantity = stock_quantity - v_qty
      WHERE id = v_product.id;

      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id)
      VALUES (v_user_id, v_product.id, -v_qty, 'sale ' || v_invoice_number, v_invoice_id);
    ELSE
      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (
        invoice_id, product_id, product_name, serial_number, color,
        quantity, unit_price, discount, line_total
      ) VALUES (
        v_invoice_id, NULL,
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
  SET subtotal = v_subtotal, total = v_total
  WHERE id = v_invoice_id;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (v_invoice_id, v_user_id, 'created',
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(_items), 'receipt_no', v_receipt_no));

  RETURN v_invoice_id;
END;
$function$;

-- 4) Backfill receipt_number for existing invoices (per user, by created_at order)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT user_id FROM public.invoices WHERE receipt_number IS NULL LOOP
    WITH ordered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
      FROM public.invoices
      WHERE user_id = r.user_id AND receipt_number IS NULL
    )
    UPDATE public.invoices i
      SET receipt_number = ordered.rn
      FROM ordered WHERE i.id = ordered.id;

    INSERT INTO public.user_counters (user_id, receipt_seq)
      SELECT r.user_id, COALESCE(MAX(receipt_number), 0) FROM public.invoices WHERE user_id = r.user_id
    ON CONFLICT (user_id) DO UPDATE
      SET receipt_seq = GREATEST(public.user_counters.receipt_seq, EXCLUDED.receipt_seq);
  END LOOP;
END $$;

-- 5) Log edit events from update_invoice
CREATE OR REPLACE FUNCTION public.update_invoice(_invoice_id uuid, _customer_id uuid, _discount numeric, _notes text, _language text, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'NO_ITEMS' USING ERRCODE = '22023'; END IF;
  IF v_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = _invoice_id AND user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF v_invoice.status = 'voided' THEN RAISE EXCEPTION 'INVOICE_VOIDED' USING ERRCODE = '22023'; END IF;

  IF _customer_id IS NOT NULL THEN
    SELECT id, name, phone, address INTO v_cust_id, v_cust_name, v_cust_phone, v_cust_address
    FROM public.customers WHERE id = _customer_id AND user_id = v_user_id;
    IF v_cust_id IS NULL THEN RAISE EXCEPTION 'INVALID_CUSTOMER' USING ERRCODE = '22023'; END IF;
  END IF;

  FOR v_old_item IN SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
    IF v_old_item.product_id IS NOT NULL THEN
      PERFORM 1 FROM public.products WHERE id = v_old_item.product_id FOR UPDATE;
      UPDATE public.products SET stock_quantity = stock_quantity + v_old_item.quantity WHERE id = v_old_item.product_id;
      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id)
      VALUES (v_user_id, v_old_item.product_id, v_old_item.quantity, 'edit-revert ' || v_invoice.invoice_number, _invoice_id);
    END IF;
  END LOOP;

  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    v_item_discount := COALESCE((v_item->>'discount')::numeric, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023'; END IF;
    IF v_item_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

    IF (v_item->>'product_id') IS NOT NULL AND (v_item->>'product_id') <> '' THEN
      SELECT id, name, price, stock_quantity, serial_number, color INTO v_product
      FROM public.products WHERE id = (v_item->>'product_id')::uuid AND user_id = v_user_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PRODUCT' USING ERRCODE = '22023'; END IF;
      IF v_product.stock_quantity < v_qty THEN RAISE EXCEPTION 'OUT_OF_STOCK:%', v_product.name USING ERRCODE = '22023'; END IF;

      v_unit_price := v_product.price;
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (_invoice_id, v_product.id, v_product.name, NULLIF(v_item->>'serial_number',''),
              COALESCE(NULLIF(v_item->>'color',''), v_product.color), v_qty, v_unit_price, v_item_discount, v_line_total);

      UPDATE public.products SET stock_quantity = stock_quantity - v_qty WHERE id = v_product.id;
      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id)
      VALUES (v_user_id, v_product.id, -v_qty, 'edit-resale ' || v_invoice.invoice_number, _invoice_id);
    ELSE
      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (_invoice_id, NULL, COALESCE(NULLIF(v_item->>'product_name',''),'Item'),
              NULLIF(v_item->>'serial_number',''), NULLIF(v_item->>'color',''), v_qty, v_unit_price, v_item_discount, v_line_total);
    END IF;

    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  v_total := GREATEST(0, v_subtotal - v_discount);

  UPDATE public.invoices
  SET subtotal = v_subtotal, discount = v_discount, total = v_total,
      notes = NULLIF(_notes, ''), language = COALESCE(_language, language),
      customer_id = v_cust_id, customer_name = v_cust_name,
      customer_phone = v_cust_phone, customer_address = v_cust_address,
      updated_at = now()
  WHERE id = _invoice_id;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (_invoice_id, v_user_id, 'edited',
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(_items),
                       'previous_total', v_invoice.total));

  RETURN _invoice_id;
END;
$function$;

-- 6) Log void events
CREATE OR REPLACE FUNCTION public.void_invoice(_invoice_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_invoice record;
  v_item record;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = _invoice_id AND user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF v_invoice.status = 'voided' THEN RETURN _invoice_id; END IF;

  FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      PERFORM 1 FROM public.products WHERE id = v_item.product_id FOR UPDATE;
      UPDATE public.products SET stock_quantity = stock_quantity + v_item.quantity WHERE id = v_item.product_id;
      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id)
      VALUES (v_user_id, v_item.product_id, v_item.quantity, 'void ' || v_invoice.invoice_number, _invoice_id);
    END IF;
  END LOOP;

  UPDATE public.invoices SET status = 'voided', updated_at = now() WHERE id = _invoice_id;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (_invoice_id, v_user_id, 'voided', jsonb_build_object('total', v_invoice.total));

  RETURN _invoice_id;
END;
$function$;
