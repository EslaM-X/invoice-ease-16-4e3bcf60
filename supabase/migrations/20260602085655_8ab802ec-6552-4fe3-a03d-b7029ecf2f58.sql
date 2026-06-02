
-- Replace create_invoice (8-arg) and update_invoice (8-arg) with reservation-aware versions.

CREATE OR REPLACE FUNCTION public.create_invoice(
  _customer_id uuid, _discount numeric, _notes text, _language text, _items jsonb,
  _paid_amount numeric DEFAULT NULL::numeric, _system_notes text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_email text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_receipt_no bigint;
  v_seq bigint;
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
  v_stock_take int;
  v_shortfall int;
  v_avail_transit int;
  v_po_item record;
  v_take int;
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

  -- generate invoice number
  UPDATE public.company_counters SET receipt_seq = receipt_seq + 1, updated_at = now()
  WHERE id = 'global' RETURNING receipt_seq INTO v_seq;
  IF v_seq IS NULL THEN
    INSERT INTO public.company_counters (id, receipt_seq) VALUES ('global', 1) RETURNING receipt_seq INTO v_seq;
  END IF;
  v_receipt_no := v_seq;
  v_invoice_number := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO public.invoices (
    user_id, invoice_number, receipt_number,
    customer_id, customer_name, customer_phone, customer_address,
    subtotal, discount, total, notes, system_notes, language, status,
    created_by, created_by_email
  ) VALUES (
    v_user_id, v_invoice_number, v_receipt_no,
    v_cust_id, v_cust_name, v_cust_phone, v_cust_address,
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
      FROM public.products
      WHERE id = (v_item->>'product_id')::uuid AND public.can_access_user_data(user_id)
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PRODUCT' USING ERRCODE = '22023'; END IF;

      v_stock_take := LEAST(v_qty, GREATEST(v_product.stock_quantity, 0));
      v_shortfall := v_qty - v_stock_take;

      -- if there's a shortfall, ensure enough is available in-transit (and not already reserved)
      IF v_shortfall > 0 THEN
        SELECT COALESCE(SUM(GREATEST(0, poi.quantity - COALESCE(poi.received_qty,0))), 0)
             - COALESCE((SELECT SUM(quantity) FROM public.invoice_po_reservations
                          WHERE product_id = v_product.id AND status = 'active'), 0)
          INTO v_avail_transit
        FROM public.purchase_order_items poi
        JOIN public.purchase_orders po ON po.id = poi.po_id
        WHERE poi.product_id = v_product.id
          AND po.status IN ('ordered','shipped','in_warehouse');
        IF v_avail_transit < v_shortfall THEN
          RAISE EXCEPTION 'OUT_OF_STOCK:%', v_product.name USING ERRCODE = '22023';
        END IF;
      END IF;

      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_product.price, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_serial_number := NULLIF(v_item->>'serial_number', '');
      v_color := NULLIF(v_item->>'color', '');
      v_product_name := COALESCE(NULLIF(v_item->>'product_name', ''), v_product.name, 'Item');
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (v_invoice_id, v_product.id, v_product_name, v_serial_number,
              COALESCE(v_color, v_product.color), v_qty, v_unit_price, v_item_discount, v_line_total)
      RETURNING id INTO v_new_item_id;

      IF v_stock_take > 0 THEN
        UPDATE public.products SET stock_quantity = stock_quantity - v_stock_take WHERE id = v_product.id;
        INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id, actor_id, actor_email)
        VALUES (v_product.user_id, v_product.id, -v_stock_take, 'sale ' || v_invoice_number, v_invoice_id, v_user_id, v_actor_email);
      END IF;

      -- Allocate shortfall across PO items FIFO
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
            (v_invoice_id, v_new_item_id, v_product.id, v_po_item.po_id, v_po_item.po_item_id, v_take, 'active', v_user_id, v_actor_email);
          v_shortfall := v_shortfall - v_take;
        END LOOP;
      END IF;
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
  IF _paid_amount IS NULL THEN
    v_paid := ROUND(v_total * 0.5, 2);
  ELSE
    v_paid := GREATEST(0, LEAST(_paid_amount, v_total));
  END IF;

  UPDATE public.invoices SET subtotal = v_subtotal, discount = v_discount, total = v_total, paid_amount = v_paid
  WHERE id = v_invoice_id;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (v_invoice_id, v_user_id, 'created',
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(_items),
                       'receipt_no', v_receipt_no, 'actor_email', v_actor_email, 'paid_amount', v_paid));

  RETURN v_invoice_id;
END;
$function$;


CREATE OR REPLACE FUNCTION public.update_invoice(
  _invoice_id uuid, _customer_id uuid, _discount numeric, _notes text, _language text, _items jsonb,
  _paid_amount numeric DEFAULT NULL::numeric, _system_notes text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
  v_discount numeric := COALESCE(_discount, 0);
  v_cust_id uuid := NULL;
  v_cust_name text := NULL;
  v_cust_phone text := NULL;
  v_cust_address text := NULL;
  v_serial_number text;
  v_color text;
  v_product_name text;
  v_new_item_id uuid;
  v_stock_take int;
  v_shortfall int;
  v_avail_transit int;
  v_po_item record;
  v_take int;
  v_revert_stock int;
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

  -- Revert old items: stock += (qty - active_reservations) ; fulfilled portion was already deducted at fulfill time
  FOR v_old_item IN SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
    IF v_old_item.product_id IS NOT NULL THEN
      SELECT COALESCE(SUM(quantity), 0) INTO v_active_res
      FROM public.invoice_po_reservations
      WHERE invoice_item_id = v_old_item.id AND status = 'active';
      v_revert_stock := v_old_item.quantity - v_active_res;
      IF v_revert_stock > 0 THEN
        PERFORM 1 FROM public.products WHERE id = v_old_item.product_id FOR UPDATE;
        UPDATE public.products SET stock_quantity = stock_quantity + v_revert_stock WHERE id = v_old_item.product_id;
        INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id, actor_id, actor_email)
        SELECT p.user_id, v_old_item.product_id, v_revert_stock, 'edit-revert ' || v_invoice.invoice_number, _invoice_id, v_user_id, v_actor_email
        FROM public.products p WHERE p.id = v_old_item.product_id;
      END IF;
    END IF;
  END LOOP;

  -- Wipe old reservations and items
  DELETE FROM public.invoice_po_reservations WHERE invoice_id = _invoice_id;
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

      v_stock_take := LEAST(v_qty, GREATEST(v_product.stock_quantity, 0));
      v_shortfall := v_qty - v_stock_take;

      IF v_shortfall > 0 THEN
        SELECT COALESCE(SUM(GREATEST(0, poi.quantity - COALESCE(poi.received_qty,0))), 0)
             - COALESCE((SELECT SUM(quantity) FROM public.invoice_po_reservations
                          WHERE product_id = v_product.id AND status = 'active'), 0)
          INTO v_avail_transit
        FROM public.purchase_order_items poi
        JOIN public.purchase_orders po ON po.id = poi.po_id
        WHERE poi.product_id = v_product.id
          AND po.status IN ('ordered','shipped','in_warehouse');
        IF v_avail_transit < v_shortfall THEN
          RAISE EXCEPTION 'OUT_OF_STOCK:%', v_product.name USING ERRCODE = '22023';
        END IF;
      END IF;

      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_product.price, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_serial_number := NULLIF(v_item->>'serial_number', '');
      v_color := NULLIF(v_item->>'color', '');
      v_product_name := COALESCE(NULLIF(v_item->>'product_name', ''), v_product.name, 'Item');
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (_invoice_id, v_product.id, v_product_name, v_serial_number,
              COALESCE(v_color, v_product.color), v_qty, v_unit_price, v_item_discount, v_line_total)
      RETURNING id INTO v_new_item_id;

      IF v_stock_take > 0 THEN
        UPDATE public.products SET stock_quantity = stock_quantity - v_stock_take WHERE id = v_product.id;
        INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id, actor_id, actor_email)
        VALUES (v_product.user_id, v_product.id, -v_stock_take, 'edit-resale ' || v_invoice.invoice_number, _invoice_id, v_user_id, v_actor_email);
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
            (_invoice_id, v_new_item_id, v_product.id, v_po_item.po_id, v_po_item.po_item_id, v_take, 'active', v_user_id, v_actor_email);
          v_shortfall := v_shortfall - v_take;
        END LOOP;
      END IF;
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
  IF _paid_amount IS NULL THEN
    v_paid := COALESCE(v_invoice.paid_amount, ROUND(v_total * 0.5, 2));
  ELSE
    v_paid := GREATEST(0, LEAST(_paid_amount, v_total));
  END IF;

  UPDATE public.invoices
  SET subtotal = v_subtotal, discount = v_discount, total = v_total, paid_amount = v_paid,
      customer_id = v_cust_id, customer_name = v_cust_name, customer_phone = v_cust_phone, customer_address = v_cust_address,
      notes = NULLIF(_notes,''), system_notes = COALESCE(NULLIF(_system_notes,''), system_notes),
      language = COALESCE(_language, language), updated_at = now(),
      updated_by = v_user_id, updated_by_email = v_actor_email
  WHERE id = _invoice_id;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (_invoice_id, v_user_id, 'edited',
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(_items),
                       'previous_total', v_invoice.total, 'actor_email', v_actor_email, 'paid_amount', v_paid));

  RETURN _invoice_id;
END;
$function$;


-- Enhance fulfillment trigger: when PO becomes 'received', fulfill reservations AND deduct stock for the fulfilled portion
CREATE OR REPLACE FUNCTION public.fulfill_reservations_on_po_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF NEW.status = 'received' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    FOR r IN
      SELECT id, product_id, quantity, invoice_id
        FROM public.invoice_po_reservations
       WHERE po_id = NEW.id AND status = 'active'
    LOOP
      UPDATE public.invoice_po_reservations
         SET status = 'fulfilled', fulfilled_at = now()
       WHERE id = r.id;
      UPDATE public.products SET stock_quantity = GREATEST(0, stock_quantity - r.quantity) WHERE id = r.product_id;
      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id, actor_id, actor_email)
      SELECT p.user_id, p.id, -r.quantity, 'reservation-fulfilled PO ' || NEW.po_number, r.invoice_id, NEW.actor_id, NEW.actor_email
      FROM public.products p WHERE p.id = r.product_id;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
