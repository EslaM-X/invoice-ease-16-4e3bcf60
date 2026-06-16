
-- 1) Renumber purchase orders by shipment date (or created_at as fallback)
CREATE OR REPLACE FUNCTION public.renumber_purchase_orders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row record;
  v_year int;
  v_counter int;
  v_prev_year int := -1;
  v_new_no text;
  v_updated int := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT is_admin() THEN RAISE EXCEPTION 'forbidden: admin only'; END IF;

  -- Temporary unique-collision guard: prefix all current numbers
  UPDATE public.purchase_orders SET po_number = '__tmp__' || po_number;

  FOR v_row IN
    SELECT id, COALESCE(shipment_date, created_at) AS sort_dt
    FROM public.purchase_orders
    ORDER BY COALESCE(shipment_date, created_at) ASC, created_at ASC
  LOOP
    v_year := EXTRACT(YEAR FROM v_row.sort_dt)::int;
    IF v_year <> v_prev_year THEN
      v_counter := 1;
      v_prev_year := v_year;
    ELSE
      v_counter := v_counter + 1;
    END IF;
    v_new_no := 'PO-' || v_year || '-' || lpad(v_counter::text, 4, '0');
    UPDATE public.purchase_orders SET po_number = v_new_no WHERE id = v_row.id;
    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.renumber_purchase_orders() TO authenticated;

-- 2) Harden defective_items RPCs with explicit row lock on products
CREATE OR REPLACE FUNCTION public.register_defective_item(
  _product_id uuid, _quantity integer, _reason text,
  _serial_number text DEFAULT NULL, _color text DEFAULT NULL, _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_product record;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;

  -- Lock product row first to serialize concurrent deductions
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

CREATE OR REPLACE FUNCTION public.return_defective_item(
  _defective_id uuid, _quantity integer, _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

  -- Lock defective row first
  SELECT * INTO v_d FROM public.defective_items
    WHERE id = _defective_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Defective item not found'; END IF;

  v_remaining := v_d.quantity - v_d.returned_quantity;
  IF _quantity > v_remaining THEN
    RAISE EXCEPTION 'Cannot return % — only % remaining', _quantity, v_remaining;
  END IF;

  -- Lock product row before mutating stock
  PERFORM 1 FROM public.products WHERE id = v_d.product_id FOR UPDATE;

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

-- 3) Receipt → reservation fulfillment hook.
-- Standalone helper so apply_po_receipt's existing logic stays untouched.
CREATE OR REPLACE FUNCTION public.fulfill_reservations_for_po_item(
  _po_item_id uuid, _quantity integer
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_remaining int := COALESCE(_quantity, 0);
  v_res record;
  v_take int;
  v_fulfilled int := 0;
BEGIN
  IF v_remaining <= 0 THEN RETURN 0; END IF;

  FOR v_res IN
    SELECT * FROM public.invoice_po_reservations
      WHERE po_item_id = _po_item_id AND status = 'pending'
      ORDER BY created_at ASC FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_res.quantity, v_remaining);

    IF v_take >= v_res.quantity THEN
      UPDATE public.invoice_po_reservations
        SET status = 'fulfilled', fulfilled_at = now()
        WHERE id = v_res.id;
    ELSE
      -- Partial: split — shrink existing row, log a fulfilled twin
      UPDATE public.invoice_po_reservations
        SET quantity = quantity - v_take WHERE id = v_res.id;
      INSERT INTO public.invoice_po_reservations(
        invoice_id, invoice_item_id, product_id, po_id, po_item_id,
        quantity, status, created_by, created_by_email, fulfilled_at
      ) VALUES (
        v_res.invoice_id, v_res.invoice_item_id, v_res.product_id, v_res.po_id, v_res.po_item_id,
        v_take, 'fulfilled', v_res.created_by, v_res.created_by_email, now()
      );
    END IF;

    v_remaining := v_remaining - v_take;
    v_fulfilled := v_fulfilled + v_take;
  END LOOP;

  RETURN v_fulfilled;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fulfill_reservations_for_po_item(uuid, integer) TO authenticated;

-- Extend apply_po_receipt to call the fulfillment hook for each received line
CREATE OR REPLACE FUNCTION public.apply_po_receipt(p_po_id uuid, items_in jsonb, p_notes text, p_actor_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_po record;
  v_item record;
  v_in jsonb;
  v_recv int;
  v_actor uuid := auth.uid();
  v_receipt_id uuid;
  v_receipt_no int;
  v_batch_total int := 0;
  v_total_ordered int;
  v_total_received int;
  v_fully boolean;
  v_stock_before int;
  v_stock_after int;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF v_po IS NULL THEN RAISE EXCEPTION 'PO not found'; END IF;

  IF NOT (is_admin() OR has_role(v_actor, 'purchasing'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT can_access_user_data(v_po.user_id) THEN
    RAISE EXCEPTION 'forbidden (company)';
  END IF;
  IF v_po.status = 'received' THEN RAISE EXCEPTION 'PO already fully received'; END IF;
  IF v_po.status = 'cancelled' THEN RAISE EXCEPTION 'PO cancelled'; END IF;

  SELECT COALESCE(MAX(receipt_number), 0) + 1 INTO v_receipt_no
    FROM po_receipts WHERE po_id = p_po_id;

  INSERT INTO po_receipts (po_id, user_id, receipt_number, notes, actor_id, actor_email)
  VALUES (p_po_id, v_po.user_id, v_receipt_no, NULLIF(p_notes, ''), v_actor, p_actor_email)
  RETURNING id INTO v_receipt_id;

  FOR v_in IN SELECT jsonb_array_elements(items_in) LOOP
    v_recv := COALESCE((v_in->>'received_qty')::int, 0);
    IF v_recv <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_item FROM purchase_order_items
      WHERE id = (v_in->>'item_id')::uuid AND po_id = p_po_id FOR UPDATE;
    IF v_item IS NULL THEN RAISE EXCEPTION 'item not found in PO'; END IF;
    IF v_item.received_qty + v_recv > v_item.quantity THEN
      RAISE EXCEPTION 'received qty (%) exceeds remaining for %', v_recv, v_item.product_name;
    END IF;

    SELECT stock_quantity INTO v_stock_before FROM products WHERE id = v_item.product_id FOR UPDATE;
    v_stock_after := COALESCE(v_stock_before, 0) + v_recv;

    UPDATE products SET stock_quantity = v_stock_after, updated_at = now() WHERE id = v_item.product_id;
    UPDATE purchase_order_items SET received_qty = received_qty + v_recv WHERE id = v_item.id;

    INSERT INTO po_receipt_items
      (receipt_id, po_item_id, product_id, product_name, serial_number, color, quantity, stock_before, stock_after)
    VALUES
      (v_receipt_id, v_item.id, v_item.product_id, v_item.product_name, v_item.serial_number, v_item.color,
       v_recv, v_stock_before, v_stock_after);

    INSERT INTO inventory_logs (user_id, product_id, change_qty, reason, actor_id, actor_email)
    VALUES (v_po.user_id, v_item.product_id, v_recv,
            'PO ' || v_po.po_number || ' استلام دفعة #' || v_receipt_no, v_actor, p_actor_email);

    -- Fulfill any reservations waiting on this PO line
    PERFORM public.fulfill_reservations_for_po_item(v_item.id, v_recv);

    v_batch_total := v_batch_total + v_recv;
  END LOOP;

  IF v_batch_total = 0 THEN
    DELETE FROM po_receipts WHERE id = v_receipt_id;
    RAISE EXCEPTION 'no items received';
  END IF;

  UPDATE po_receipts SET total_qty = v_batch_total WHERE id = v_receipt_id;

  SELECT COALESCE(SUM(quantity),0), COALESCE(SUM(received_qty),0)
    INTO v_total_ordered, v_total_received
    FROM purchase_order_items WHERE po_id = p_po_id;

  v_fully := (v_total_received >= v_total_ordered);

  UPDATE purchase_orders
    SET status = CASE WHEN v_fully THEN 'received' ELSE 'in_warehouse' END,
        received_at = CASE WHEN v_fully THEN now() ELSE received_at END,
        received_by = CASE WHEN v_fully THEN v_actor ELSE received_by END,
        received_by_email = CASE WHEN v_fully THEN p_actor_email ELSE received_by_email END,
        stock_applied_at = COALESCE(stock_applied_at, now()),
        updated_at = now()
    WHERE id = p_po_id;

  INSERT INTO po_status_history (po_id, from_status, to_status, note, actor_id, actor_email)
  VALUES (p_po_id, v_po.status,
          CASE WHEN v_fully THEN 'received' ELSE 'in_warehouse' END,
          'دفعة #' || v_receipt_no || ': ' || v_batch_total || ' (إجمالي ' || v_total_received || '/' || v_total_ordered || ')',
          v_actor, p_actor_email);

  RETURN jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_no,
    'fully_received', v_fully,
    'batch_qty', v_batch_total,
    'total_ordered', v_total_ordered,
    'total_received', v_total_received
  );
END;
$$;
