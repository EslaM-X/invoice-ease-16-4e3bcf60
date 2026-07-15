
ALTER TABLE public.invoice_po_reservations ALTER COLUMN po_id DROP NOT NULL;
ALTER TABLE public.invoice_po_reservations ALTER COLUMN po_item_id DROP NOT NULL;
ALTER TABLE public.invoice_po_reservations DROP CONSTRAINT IF EXISTS invoice_po_reservations_status_check;
ALTER TABLE public.invoice_po_reservations ADD CONSTRAINT invoice_po_reservations_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'fulfilled'::text, 'cancelled'::text, 'needs_order'::text]));

CREATE INDEX IF NOT EXISTS invoice_po_reservations_needs_order_idx
  ON public.invoice_po_reservations (product_id) WHERE status = 'needs_order';

CREATE OR REPLACE FUNCTION public.cover_invoice_item(
  _invoice_id uuid, _invoice_item_id uuid, _product_id uuid, _qty int,
  _actor_id uuid, _actor_email text, _reason text, _invoice_number text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_product record;
  v_stock_take int;
  v_shortfall int;
  v_po_item record;
  v_take int;
BEGIN
  IF _product_id IS NULL OR _qty <= 0 THEN RETURN; END IF;
  SELECT id, user_id, stock_quantity INTO v_product FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_stock_take := LEAST(_qty, GREATEST(v_product.stock_quantity, 0));
  v_shortfall  := _qty - v_stock_take;

  IF v_stock_take > 0 THEN
    UPDATE public.products SET stock_quantity = stock_quantity - v_stock_take WHERE id = v_product.id;
    INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id, actor_id, actor_email)
    VALUES (v_product.user_id, v_product.id, -v_stock_take, _reason || ' ' || COALESCE(_invoice_number,''), _invoice_id, _actor_id, _actor_email);
  END IF;

  IF v_shortfall > 0 THEN
    FOR v_po_item IN
      SELECT poi.id AS po_item_id, poi.po_id,
             GREATEST(0, poi.quantity - COALESCE(poi.received_qty,0))
               - COALESCE((SELECT SUM(quantity) FROM public.invoice_po_reservations r
                             WHERE r.po_item_id = poi.id AND r.status = 'active'), 0) AS avail
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders po ON po.id = poi.po_id
      WHERE poi.product_id = v_product.id
        AND po.status IN ('ordered','shipped','in_warehouse')
      ORDER BY COALESCE(po.shipped_at, po.expected_arrival_at, po.created_at) ASC NULLS LAST
    LOOP
      EXIT WHEN v_shortfall <= 0;
      IF v_po_item.avail <= 0 THEN CONTINUE; END IF;
      v_take := LEAST(v_shortfall, v_po_item.avail);
      INSERT INTO public.invoice_po_reservations
        (invoice_id, invoice_item_id, product_id, po_id, po_item_id, quantity, status, created_by, created_by_email)
      VALUES
        (_invoice_id, _invoice_item_id, v_product.id, v_po_item.po_id, v_po_item.po_item_id, v_take, 'active', _actor_id, _actor_email);
      v_shortfall := v_shortfall - v_take;
    END LOOP;
  END IF;

  IF v_shortfall > 0 THEN
    INSERT INTO public.invoice_po_reservations
      (invoice_id, invoice_item_id, product_id, po_id, po_item_id, quantity, status, created_by, created_by_email)
    VALUES
      (_invoice_id, _invoice_item_id, v_product.id, NULL, NULL, v_shortfall, 'needs_order', _actor_id, _actor_email);
  END IF;
END;
$$;

-- create_invoice (7-arg)
CREATE OR REPLACE FUNCTION public.create_invoice(
  _customer_id uuid, _discount numeric, _notes text, _language text, _items jsonb,
  _paid_amount numeric DEFAULT NULL::numeric, _system_notes text DEFAULT NULL::text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_email text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_receipt_no bigint;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_discount numeric := COALESCE(_discount, 0);
  v_paid numeric;
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
  v_serial_number text;
  v_color text;
  v_product_name text;
  v_new_item_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'NO_ITEMS' USING ERRCODE = '22023'; END IF;
  IF v_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_user_id;

  IF _customer_id IS NOT NULL THEN
    SELECT id, name, phone, address INTO v_cust_id, v_cust_name, v_cust_phone, v_cust_address
    FROM public.customers WHERE id = _customer_id AND public.can_access_user_data(user_id);
    IF v_cust_id IS NULL THEN RAISE EXCEPTION 'INVALID_CUSTOMER' USING ERRCODE = '22023'; END IF;
  END IF;

  INSERT INTO public.company_counters (id, receipt_seq) VALUES ('default', 1)
  ON CONFLICT (id) DO UPDATE SET receipt_seq = public.company_counters.receipt_seq + 1, updated_at = now()
  RETURNING receipt_seq INTO v_receipt_no;

  INSERT INTO public.user_counters (user_id, receipt_seq) VALUES (v_user_id, 1)
  ON CONFLICT (user_id) DO UPDATE SET receipt_seq = public.user_counters.receipt_seq + 1, updated_at = now();

  v_invoice_number := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_receipt_no::text, 5, '0');

  INSERT INTO public.invoices (
    user_id, invoice_number, receipt_number, customer_id, customer_name, customer_phone, customer_address,
    subtotal, discount, total, notes, system_notes, language, status, created_by, created_by_email
  ) VALUES (
    v_user_id, v_invoice_number, v_receipt_no, v_cust_id, v_cust_name, v_cust_phone, v_cust_address,
    0, v_discount, 0, NULLIF(_notes,''), NULLIF(_system_notes,''), COALESCE(_language,'ar'), 'completed',
    v_user_id, v_actor_email
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    v_item_discount := COALESCE((v_item->>'discount')::numeric, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023'; END IF;
    IF v_item_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

    IF (v_item->>'product_id') IS NOT NULL AND (v_item->>'product_id') <> '' THEN
      SELECT id, name, price, stock_quantity, serial_number, color, user_id INTO v_product
      FROM public.products WHERE id = (v_item->>'product_id')::uuid AND public.can_access_user_data(user_id) FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PRODUCT' USING ERRCODE = '22023'; END IF;

      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_product.price, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_serial_number := NULLIF(v_item->>'serial_number', '');
      v_color := NULLIF(v_item->>'color', '');
      v_product_name := COALESCE(NULLIF(v_item->>'product_name', ''), v_product.name, 'Item');
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (v_invoice_id, v_product.id, v_product_name, v_serial_number, COALESCE(v_color, v_product.color), v_qty, v_unit_price, v_item_discount, v_line_total)
      RETURNING id INTO v_new_item_id;

      PERFORM public.cover_invoice_item(v_invoice_id, v_new_item_id, v_product.id, v_qty, v_user_id, v_actor_email, 'sale', v_invoice_number);
    ELSE
      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;
      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (v_invoice_id, NULL, COALESCE(NULLIF(v_item->>'product_name',''),'Item'),
              NULLIF(v_item->>'serial_number',''), NULLIF(v_item->>'color',''), v_qty, v_unit_price, v_item_discount, v_line_total);
    END IF;

    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  v_total := GREATEST(0, v_subtotal - v_discount);
  IF _paid_amount IS NULL THEN v_paid := 0; ELSE v_paid := GREATEST(0, LEAST(_paid_amount, v_total)); END IF;

  UPDATE public.invoices SET subtotal = v_subtotal, discount = v_discount, total = v_total, paid_amount = v_paid WHERE id = v_invoice_id;

  IF v_paid > 0 THEN
    INSERT INTO public.payments (invoice_id, user_id, amount, method, notes, paid_at, created_by, created_by_email)
    VALUES (v_invoice_id, v_user_id, v_paid, 'cash', 'دفعة أولى عند إنشاء الفاتورة', now(), v_user_id, v_actor_email);
  END IF;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (v_invoice_id, v_user_id, 'created',
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(_items),
                       'receipt_no', v_receipt_no, 'actor_email', v_actor_email, 'paid_amount', v_paid));

  RETURN v_invoice_id;
END;
$function$;

-- create_invoice (10-arg extended)
CREATE OR REPLACE FUNCTION public.create_invoice(
  _customer_id uuid, _discount numeric, _notes text, _language text, _items jsonb,
  _paid_amount numeric DEFAULT NULL::numeric, _system_notes text DEFAULT NULL::text,
  _sales_channel text DEFAULT NULL::text, _sales_event_id uuid DEFAULT NULL::uuid, _customer_category text DEFAULT NULL::text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_email text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_receipt_no bigint;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_discount numeric := COALESCE(_discount, 0);
  v_paid numeric;
  v_cust_id uuid := NULL;
  v_cust_name text := NULL;
  v_cust_phone text := NULL;
  v_cust_address text := NULL;
  v_cust_category text := NULL;
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
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'NO_ITEMS' USING ERRCODE = '22023'; END IF;
  IF v_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_user_id;

  IF _customer_id IS NOT NULL THEN
    SELECT id, name, phone, address, category
      INTO v_cust_id, v_cust_name, v_cust_phone, v_cust_address, v_cust_category
    FROM public.customers WHERE id = _customer_id AND public.can_access_user_data(user_id);
    IF v_cust_id IS NULL THEN RAISE EXCEPTION 'INVALID_CUSTOMER' USING ERRCODE = '22023'; END IF;
  END IF;

  INSERT INTO public.company_counters (id, receipt_seq) VALUES ('default', 1)
  ON CONFLICT (id) DO UPDATE SET receipt_seq = public.company_counters.receipt_seq + 1, updated_at = now()
  RETURNING receipt_seq INTO v_receipt_no;

  INSERT INTO public.user_counters (user_id, receipt_seq) VALUES (v_user_id, 1)
  ON CONFLICT (user_id) DO UPDATE SET receipt_seq = public.user_counters.receipt_seq + 1, updated_at = now();

  v_invoice_number := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_receipt_no::text, 5, '0');

  INSERT INTO public.invoices (
    user_id, invoice_number, receipt_number, customer_id, customer_name, customer_phone, customer_address,
    customer_category, sales_channel, sales_event_id,
    subtotal, discount, total, notes, system_notes, language, status, created_by, created_by_email
  ) VALUES (
    v_user_id, v_invoice_number, v_receipt_no, v_cust_id, v_cust_name, v_cust_phone, v_cust_address,
    COALESCE(NULLIF(_customer_category,''), v_cust_category), NULLIF(_sales_channel,''), _sales_event_id,
    0, v_discount, 0, NULLIF(_notes,''), NULLIF(_system_notes,''), COALESCE(_language,'ar'), 'completed',
    v_user_id, v_actor_email
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    v_item_discount := COALESCE((v_item->>'discount')::numeric, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023'; END IF;
    IF v_item_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

    IF (v_item->>'product_id') IS NOT NULL AND (v_item->>'product_id') <> '' THEN
      SELECT id, name, price, stock_quantity, serial_number, color, user_id INTO v_product
      FROM public.products WHERE id = (v_item->>'product_id')::uuid AND public.can_access_user_data(user_id) FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PRODUCT' USING ERRCODE = '22023'; END IF;

      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_product.price, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_serial_number := NULLIF(v_item->>'serial_number', '');
      v_color := NULLIF(v_item->>'color', '');
      v_product_name := COALESCE(NULLIF(v_item->>'product_name', ''), v_product.name, 'Item');
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (v_invoice_id, v_product.id, v_product_name, v_serial_number, COALESCE(v_color, v_product.color), v_qty, v_unit_price, v_item_discount, v_line_total)
      RETURNING id INTO v_new_item_id;

      PERFORM public.cover_invoice_item(v_invoice_id, v_new_item_id, v_product.id, v_qty, v_user_id, v_actor_email, 'sale', v_invoice_number);
    ELSE
      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;
      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (v_invoice_id, NULL, COALESCE(NULLIF(v_item->>'product_name',''),'Item'),
              NULLIF(v_item->>'serial_number',''), NULLIF(v_item->>'color',''), v_qty, v_unit_price, v_item_discount, v_line_total);
    END IF;

    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  v_total := GREATEST(0, v_subtotal - v_discount);
  IF _paid_amount IS NULL THEN v_paid := 0; ELSE v_paid := GREATEST(0, LEAST(_paid_amount, v_total)); END IF;

  UPDATE public.invoices SET subtotal = v_subtotal, discount = v_discount, total = v_total, paid_amount = v_paid WHERE id = v_invoice_id;

  IF v_paid > 0 THEN
    INSERT INTO public.payments (invoice_id, user_id, amount, method, notes, paid_at, created_by, created_by_email)
    VALUES (v_invoice_id, v_user_id, v_paid, 'cash', 'دفعة أولى عند إنشاء الفاتورة', now(), v_user_id, v_actor_email);
  END IF;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (v_invoice_id, v_user_id, 'created',
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(_items),
                       'receipt_no', v_receipt_no, 'actor_email', v_actor_email, 'paid_amount', v_paid));

  RETURN v_invoice_id;
END;
$function$;

-- update_invoice (8-arg)
CREATE OR REPLACE FUNCTION public.update_invoice(
  _invoice_id uuid, _customer_id uuid, _discount numeric, _notes text, _language text, _items jsonb,
  _paid_amount numeric DEFAULT NULL::numeric, _system_notes text DEFAULT NULL::text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_email text;
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
  v_paid numeric;
  v_payments_sum numeric;
  v_discount numeric := COALESCE(_discount, 0);
  v_cust_id uuid := NULL;
  v_cust_name text := NULL;
  v_cust_phone text := NULL;
  v_cust_address text := NULL;
  v_serial_number text;
  v_color text;
  v_product_name text;
  v_new_item_id uuid;
  v_active_res int;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'NO_ITEMS' USING ERRCODE = '22023'; END IF;
  IF v_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = _invoice_id AND public.can_access_user_data(user_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF v_invoice.status = 'voided' THEN RAISE EXCEPTION 'INVOICE_VOIDED' USING ERRCODE = '22023'; END IF;

  IF _customer_id IS NOT NULL THEN
    SELECT id, name, phone, address INTO v_cust_id, v_cust_name, v_cust_phone, v_cust_address
    FROM public.customers WHERE id = _customer_id AND public.can_access_user_data(user_id);
    IF v_cust_id IS NULL THEN RAISE EXCEPTION 'INVALID_CUSTOMER' USING ERRCODE = '22023'; END IF;
  END IF;

  FOR v_old_item IN SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
    IF v_old_item.product_id IS NOT NULL THEN
      SELECT COALESCE(SUM(quantity),0) INTO v_active_res
        FROM public.invoice_po_reservations
        WHERE invoice_item_id = v_old_item.id AND status IN ('active','needs_order');
      PERFORM 1 FROM public.products WHERE id = v_old_item.product_id FOR UPDATE;
      IF (v_old_item.quantity - v_active_res) > 0 THEN
        UPDATE public.products SET stock_quantity = stock_quantity + (v_old_item.quantity - v_active_res) WHERE id = v_old_item.product_id;
        INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id, actor_id, actor_email)
        SELECT p.user_id, v_old_item.product_id, (v_old_item.quantity - v_active_res), 'edit-revert ' || v_invoice.invoice_number, _invoice_id, v_user_id, v_actor_email
        FROM public.products p WHERE p.id = v_old_item.product_id;
      END IF;
    END IF;
  END LOOP;

  DELETE FROM public.invoice_po_reservations WHERE invoice_id = _invoice_id AND status IN ('active','needs_order');
  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    v_item_discount := COALESCE((v_item->>'discount')::numeric, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023'; END IF;
    IF v_item_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

    IF (v_item->>'product_id') IS NOT NULL AND (v_item->>'product_id') <> '' THEN
      SELECT id, name, price, stock_quantity, serial_number, color, user_id INTO v_product
      FROM public.products WHERE id = (v_item->>'product_id')::uuid AND public.can_access_user_data(user_id) FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PRODUCT' USING ERRCODE = '22023'; END IF;

      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_product.price, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_serial_number := NULLIF(v_item->>'serial_number', '');
      v_color := NULLIF(v_item->>'color', '');
      v_product_name := COALESCE(NULLIF(v_item->>'product_name', ''), v_product.name, 'Item');
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (_invoice_id, v_product.id, v_product_name, v_serial_number, COALESCE(v_color, v_product.color), v_qty, v_unit_price, v_item_discount, v_line_total)
      RETURNING id INTO v_new_item_id;

      PERFORM public.cover_invoice_item(_invoice_id, v_new_item_id, v_product.id, v_qty, v_user_id, v_actor_email, 'edit-resale', v_invoice.invoice_number);
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

  SELECT COALESCE(SUM(amount),0) INTO v_payments_sum FROM public.payments WHERE invoice_id = _invoice_id;
  IF _paid_amount IS NULL THEN
    v_paid := LEAST(v_payments_sum, v_total);
  ELSE
    v_paid := GREATEST(0, LEAST(_paid_amount, v_total));
    IF v_paid <> v_payments_sum THEN
      INSERT INTO public.payments (invoice_id, user_id, amount, method, notes, paid_at, created_by, created_by_email)
      VALUES (_invoice_id, v_user_id, GREATEST(0, v_paid - v_payments_sum), 'other',
              'تسوية تعديل الفاتورة', now(), v_user_id, v_actor_email);
      SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.payments WHERE invoice_id = _invoice_id;
      v_paid := LEAST(v_paid, v_total);
    END IF;
  END IF;

  UPDATE public.invoices
  SET subtotal = v_subtotal, discount = v_discount, total = v_total, paid_amount = v_paid,
      notes = NULLIF(_notes, ''), system_notes = COALESCE(NULLIF(_system_notes,''), system_notes),
      language = COALESCE(_language, language),
      customer_id = v_cust_id, customer_name = v_cust_name,
      customer_phone = v_cust_phone, customer_address = v_cust_address,
      updated_at = now(), updated_by = v_user_id, updated_by_email = v_actor_email
  WHERE id = _invoice_id;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (_invoice_id, v_user_id, 'edited',
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(_items),
                       'previous_total', v_invoice.total, 'actor_email', v_actor_email, 'paid_amount', v_paid));

  RETURN _invoice_id;
END;
$function$;

-- update_invoice (11-arg)
CREATE OR REPLACE FUNCTION public.update_invoice(
  _invoice_id uuid, _customer_id uuid, _discount numeric, _notes text, _language text, _items jsonb,
  _paid_amount numeric DEFAULT NULL::numeric, _system_notes text DEFAULT NULL::text,
  _sales_channel text DEFAULT NULL::text, _sales_event_id uuid DEFAULT NULL::uuid, _customer_category text DEFAULT NULL::text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_email text;
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
  v_paid numeric;
  v_payments_sum numeric;
  v_discount numeric := COALESCE(_discount, 0);
  v_cust_id uuid := NULL;
  v_cust_name text := NULL;
  v_cust_phone text := NULL;
  v_cust_address text := NULL;
  v_cust_category text := NULL;
  v_serial_number text;
  v_color text;
  v_product_name text;
  v_new_item_id uuid;
  v_active_res int;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'NO_ITEMS' USING ERRCODE = '22023'; END IF;
  IF v_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = _invoice_id AND public.can_access_user_data(user_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF v_invoice.status = 'voided' THEN RAISE EXCEPTION 'INVOICE_VOIDED' USING ERRCODE = '22023'; END IF;

  IF _customer_id IS NOT NULL THEN
    SELECT id, name, phone, address, category
      INTO v_cust_id, v_cust_name, v_cust_phone, v_cust_address, v_cust_category
    FROM public.customers WHERE id = _customer_id AND public.can_access_user_data(user_id);
    IF v_cust_id IS NULL THEN RAISE EXCEPTION 'INVALID_CUSTOMER' USING ERRCODE = '22023'; END IF;
  END IF;

  FOR v_old_item IN SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
    IF v_old_item.product_id IS NOT NULL THEN
      SELECT COALESCE(SUM(quantity),0) INTO v_active_res
        FROM public.invoice_po_reservations
        WHERE invoice_item_id = v_old_item.id AND status IN ('active','needs_order');
      PERFORM 1 FROM public.products WHERE id = v_old_item.product_id FOR UPDATE;
      IF (v_old_item.quantity - v_active_res) > 0 THEN
        UPDATE public.products SET stock_quantity = stock_quantity + (v_old_item.quantity - v_active_res) WHERE id = v_old_item.product_id;
        INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id, actor_id, actor_email)
        SELECT p.user_id, v_old_item.product_id, (v_old_item.quantity - v_active_res), 'edit-revert ' || v_invoice.invoice_number, _invoice_id, v_user_id, v_actor_email
        FROM public.products p WHERE p.id = v_old_item.product_id;
      END IF;
    END IF;
  END LOOP;

  DELETE FROM public.invoice_po_reservations WHERE invoice_id = _invoice_id AND status IN ('active','needs_order');
  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    v_item_discount := COALESCE((v_item->>'discount')::numeric, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023'; END IF;
    IF v_item_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

    IF (v_item->>'product_id') IS NOT NULL AND (v_item->>'product_id') <> '' THEN
      SELECT id, name, price, stock_quantity, serial_number, color, user_id INTO v_product
      FROM public.products WHERE id = (v_item->>'product_id')::uuid AND public.can_access_user_data(user_id) FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PRODUCT' USING ERRCODE = '22023'; END IF;

      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_product.price, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_serial_number := NULLIF(v_item->>'serial_number', '');
      v_color := NULLIF(v_item->>'color', '');
      v_product_name := COALESCE(NULLIF(v_item->>'product_name', ''), v_product.name, 'Item');
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (_invoice_id, v_product.id, v_product_name, v_serial_number, COALESCE(v_color, v_product.color), v_qty, v_unit_price, v_item_discount, v_line_total)
      RETURNING id INTO v_new_item_id;

      PERFORM public.cover_invoice_item(_invoice_id, v_new_item_id, v_product.id, v_qty, v_user_id, v_actor_email, 'edit-resale', v_invoice.invoice_number);
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

  SELECT COALESCE(SUM(amount),0) INTO v_payments_sum FROM public.payments WHERE invoice_id = _invoice_id;
  IF _paid_amount IS NULL THEN
    v_paid := LEAST(v_payments_sum, v_total);
  ELSE
    v_paid := GREATEST(0, LEAST(_paid_amount, v_total));
    IF v_paid <> v_payments_sum THEN
      INSERT INTO public.payments (invoice_id, user_id, amount, method, notes, paid_at, created_by, created_by_email)
      VALUES (_invoice_id, v_user_id, GREATEST(0, v_paid - v_payments_sum), 'other',
              'تسوية تعديل الفاتورة', now(), v_user_id, v_actor_email);
      SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.payments WHERE invoice_id = _invoice_id;
      v_paid := LEAST(v_paid, v_total);
    END IF;
  END IF;

  UPDATE public.invoices
  SET subtotal = v_subtotal, discount = v_discount, total = v_total, paid_amount = v_paid,
      notes = NULLIF(_notes, ''), system_notes = COALESCE(NULLIF(_system_notes,''), system_notes),
      language = COALESCE(_language, language),
      customer_id = v_cust_id, customer_name = v_cust_name,
      customer_phone = v_cust_phone, customer_address = v_cust_address,
      customer_category = COALESCE(NULLIF(_customer_category,''), customer_category, v_cust_category),
      sales_channel = COALESCE(NULLIF(_sales_channel,''), sales_channel),
      sales_event_id = COALESCE(_sales_event_id, sales_event_id),
      updated_at = now(), updated_by = v_user_id, updated_by_email = v_actor_email
  WHERE id = _invoice_id;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (_invoice_id, v_user_id, 'edited',
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(_items),
                       'previous_total', v_invoice.total, 'actor_email', v_actor_email, 'paid_amount', v_paid));

  RETURN _invoice_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_stock_shortages()
RETURNS TABLE(
  product_id uuid,
  product_name text,
  serial_number text,
  color text,
  collection text,
  image_url text,
  is_spare_part boolean,
  stock_quantity int,
  incoming_qty bigint,
  needed_qty bigint,
  net_shortage bigint,
  invoices jsonb
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH needs AS (
    SELECT r.product_id, r.invoice_id, SUM(r.quantity)::bigint AS qty
    FROM public.invoice_po_reservations r
    JOIN public.invoices i ON i.id = r.invoice_id
    WHERE r.status = 'needs_order'
      AND i.status NOT IN ('voided')
      AND public.can_access_user_data(i.user_id)
    GROUP BY r.product_id, r.invoice_id
  ),
  per_product AS (
    SELECT n.product_id,
           SUM(n.qty)::bigint AS needed_qty,
           jsonb_agg(jsonb_build_object(
             'invoice_id', i.id,
             'invoice_number', i.invoice_number,
             'customer_name', i.customer_name,
             'quantity', n.qty,
             'created_at', i.created_at,
             'status', i.status
           ) ORDER BY i.created_at) AS invoices
    FROM needs n
    JOIN public.invoices i ON i.id = n.invoice_id
    GROUP BY n.product_id
  ),
  incoming AS (
    SELECT poi.product_id,
           SUM(GREATEST(0, poi.quantity - COALESCE(poi.received_qty,0)))::bigint AS incoming_qty
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.po_id
    WHERE po.status IN ('ordered','shipped','in_warehouse')
    GROUP BY poi.product_id
  )
  SELECT p.id AS product_id, p.name AS product_name, p.serial_number, p.color, p.collection,
         p.image_url, p.is_spare_part, p.stock_quantity,
         COALESCE(inc.incoming_qty, 0) AS incoming_qty,
         pp.needed_qty,
         pp.needed_qty AS net_shortage,
         pp.invoices
  FROM per_product pp
  JOIN public.products p ON p.id = pp.product_id
  LEFT JOIN incoming inc ON inc.product_id = pp.product_id
  ORDER BY pp.needed_qty DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_stock_shortages() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cover_invoice_item(uuid, uuid, uuid, int, uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.promote_needs_order_to_po()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_avail int;
  v_take int;
  v_need record;
  v_po_status text;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT status INTO v_po_status FROM public.purchase_orders WHERE id = NEW.po_id;
  IF v_po_status NOT IN ('ordered','shipped','in_warehouse') THEN RETURN NEW; END IF;

  v_avail := GREATEST(0, COALESCE(NEW.quantity,0) - COALESCE(NEW.received_qty,0));
  IF v_avail <= 0 THEN RETURN NEW; END IF;

  FOR v_need IN
    SELECT r.id, r.invoice_id, r.invoice_item_id, r.quantity, r.created_by, r.created_by_email
    FROM public.invoice_po_reservations r
    JOIN public.invoices i ON i.id = r.invoice_id
    WHERE r.product_id = NEW.product_id AND r.status = 'needs_order'
    ORDER BY i.created_at ASC
  LOOP
    EXIT WHEN v_avail <= 0;
    v_take := LEAST(v_need.quantity, v_avail);
    IF v_take = v_need.quantity THEN
      UPDATE public.invoice_po_reservations
        SET status = 'active', po_id = NEW.po_id, po_item_id = NEW.id
        WHERE id = v_need.id;
    ELSE
      INSERT INTO public.invoice_po_reservations
        (invoice_id, invoice_item_id, product_id, po_id, po_item_id, quantity, status, created_by, created_by_email)
      VALUES
        (v_need.invoice_id, v_need.invoice_item_id, NEW.product_id, NEW.po_id, NEW.id, v_take, 'active', v_need.created_by, v_need.created_by_email);
      UPDATE public.invoice_po_reservations SET quantity = quantity - v_take WHERE id = v_need.id;
    END IF;
    v_avail := v_avail - v_take;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS promote_needs_order_on_po_item ON public.purchase_order_items;
CREATE TRIGGER promote_needs_order_on_po_item
  AFTER INSERT ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.promote_needs_order_to_po();
