ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS dashboard_usd_rate numeric NOT NULL DEFAULT 50.5;

CREATE OR REPLACE FUNCTION public.recalculate_po_receipt_state(p_po_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po record;
  v_ordered int := 0;
  v_received int := 0;
  v_new_status text;
BEGIN
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF v_po IS NULL THEN
    RAISE EXCEPTION 'PO_NOT_FOUND';
  END IF;

  SELECT COALESCE(SUM(quantity), 0)::int, COALESCE(SUM(received_qty), 0)::int
    INTO v_ordered, v_received
    FROM public.purchase_order_items
   WHERE po_id = p_po_id;

  IF v_po.status = 'cancelled' THEN
    v_new_status := 'cancelled';
  ELSIF v_ordered > 0 AND v_received >= v_ordered THEN
    v_new_status := 'received';
  ELSIF v_received > 0 THEN
    v_new_status := 'in_warehouse';
  ELSE
    v_new_status := CASE
      WHEN v_po.shipped_at IS NOT NULL THEN 'shipped'
      WHEN v_po.paid_at IS NOT NULL OR v_po.payment_installment_1_at IS NOT NULL THEN 'ordered'
      WHEN v_po.cfo_priced_at IS NOT NULL THEN 'priced'
      ELSE v_po.status
    END;
  END IF;

  UPDATE public.purchase_orders
     SET status = v_new_status,
         received_at = CASE WHEN v_new_status = 'received' THEN COALESCE(received_at, now()) ELSE NULL END,
         received_by = CASE WHEN v_new_status = 'received' THEN received_by ELSE NULL END,
         received_by_email = CASE WHEN v_new_status = 'received' THEN received_by_email ELSE NULL END,
         stock_applied_at = CASE WHEN v_received > 0 THEN COALESCE(stock_applied_at, now()) ELSE NULL END,
         updated_at = now()
   WHERE id = p_po_id;

  RETURN jsonb_build_object('ok', true, 'ordered', v_ordered, 'received', v_received, 'status', v_new_status);
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_po_receipt_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_po_receipt_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_po_receipt_batch(
  p_receipt_id uuid,
  p_receipt_date timestamptz,
  p_items jsonb,
  p_actor_email text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt record;
  v_po record;
  v_actor uuid := auth.uid();
  v_in jsonb;
  v_po_item record;
  v_existing record;
  v_new_qty int;
  v_delta int;
  v_stock_before int;
  v_stock_after int;
  v_total int := 0;
  v_changes int := 0;
  v_state jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_receipt FROM public.po_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF v_receipt IS NULL THEN RAISE EXCEPTION 'receipt not found'; END IF;
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = v_receipt.po_id FOR UPDATE;
  IF NOT (public.is_admin() OR public.has_role(v_actor, 'purchasing'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT public.can_access_user_data(v_po.user_id) THEN
    RAISE EXCEPTION 'forbidden (company)';
  END IF;

  IF p_receipt_date IS NOT NULL THEN
    UPDATE public.po_receipts
       SET receipt_date = p_receipt_date
     WHERE id = p_receipt_id;
  END IF;

  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    FOR v_in IN SELECT jsonb_array_elements(p_items) LOOP
      v_new_qty := GREATEST(0, COALESCE((v_in->>'new_qty')::int, 0));
      SELECT * INTO v_po_item FROM public.purchase_order_items
        WHERE id = (v_in->>'po_item_id')::uuid AND po_id = v_receipt.po_id FOR UPDATE;
      IF v_po_item IS NULL THEN CONTINUE; END IF;

      SELECT * INTO v_existing FROM public.po_receipt_items
        WHERE receipt_id = p_receipt_id AND po_item_id = v_po_item.id;

      IF v_existing IS NULL AND v_new_qty = 0 THEN CONTINUE; END IF;

      v_delta := v_new_qty - COALESCE(v_existing.quantity, 0);
      IF v_delta = 0 THEN
        v_total := v_total + v_new_qty;
        CONTINUE;
      END IF;

      IF v_po_item.received_qty + v_delta > v_po_item.quantity THEN
        RAISE EXCEPTION 'QTY_EXCEEDS_REMAINING';
      END IF;
      IF v_po_item.received_qty + v_delta < 0 THEN
        RAISE EXCEPTION 'QTY_WOULD_GO_NEGATIVE';
      END IF;

      SELECT stock_quantity INTO v_stock_before FROM public.products WHERE id = v_po_item.product_id FOR UPDATE;
      v_stock_after := GREATEST(0, COALESCE(v_stock_before,0) + v_delta);

      UPDATE public.products SET stock_quantity = v_stock_after, updated_at = now() WHERE id = v_po_item.product_id;
      UPDATE public.purchase_order_items SET received_qty = received_qty + v_delta WHERE id = v_po_item.id;

      IF v_existing IS NULL THEN
        INSERT INTO public.po_receipt_items (receipt_id, po_item_id, product_id, product_name, serial_number, color, quantity, stock_before, stock_after)
        VALUES (p_receipt_id, v_po_item.id, v_po_item.product_id, v_po_item.product_name, v_po_item.serial_number, v_po_item.color, v_new_qty, v_stock_before, v_stock_after);
      ELSIF v_new_qty = 0 THEN
        DELETE FROM public.po_receipt_items WHERE id = v_existing.id;
      ELSE
        UPDATE public.po_receipt_items
           SET quantity = v_new_qty,
               stock_before = v_stock_before,
               stock_after = v_stock_after
         WHERE id = v_existing.id;
      END IF;

      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
      VALUES (v_po.user_id, v_po_item.product_id, v_delta,
              'PO ' || v_po.po_number || ' تعديل دفعة #' || v_receipt.receipt_number || ' (' || COALESCE(v_existing.quantity,0)::text || '→' || v_new_qty::text || ')',
              v_actor, p_actor_email);
      v_changes := v_changes + 1;
      v_total := v_total + v_new_qty;
    END LOOP;
  ELSE
    SELECT COALESCE(SUM(quantity),0)::int INTO v_total FROM public.po_receipt_items WHERE receipt_id = p_receipt_id;
  END IF;

  UPDATE public.po_receipts SET total_qty = v_total WHERE id = p_receipt_id;
  v_state := public.recalculate_po_receipt_state(v_receipt.po_id);
  RETURN jsonb_build_object('ok', true, 'changes', v_changes, 'total_qty', v_total, 'po_state', v_state);
END $$;

GRANT EXECUTE ON FUNCTION public.update_po_receipt_batch(uuid, timestamptz, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_po_receipt_batch(
  p_receipt_id uuid,
  p_actor_email text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt record;
  v_po record;
  v_actor uuid := auth.uid();
  rec record;
  v_stock int;
  v_state jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_receipt FROM public.po_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF v_receipt IS NULL THEN RAISE EXCEPTION 'receipt not found'; END IF;
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = v_receipt.po_id FOR UPDATE;
  IF NOT (public.is_admin() OR public.has_role(v_actor, 'purchasing'::public.app_role)) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT public.can_access_user_data(v_po.user_id) THEN RAISE EXCEPTION 'forbidden (company)'; END IF;

  FOR rec IN SELECT * FROM public.po_receipt_items WHERE receipt_id = p_receipt_id LOOP
    SELECT stock_quantity INTO v_stock FROM public.products WHERE id = rec.product_id FOR UPDATE;
    UPDATE public.products SET stock_quantity = GREATEST(0, COALESCE(v_stock,0) - rec.quantity), updated_at = now()
      WHERE id = rec.product_id;
    UPDATE public.purchase_order_items SET received_qty = GREATEST(0, received_qty - rec.quantity)
      WHERE id = rec.po_item_id;
    INSERT INTO public.inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
    VALUES (v_po.user_id, rec.product_id, -rec.quantity,
            'PO ' || v_po.po_number || ' تراجع/حذف دفعة #' || v_receipt.receipt_number, v_actor, p_actor_email);
  END LOOP;

  DELETE FROM public.po_receipts WHERE id = p_receipt_id;
  v_state := public.recalculate_po_receipt_state(v_po.id);

  INSERT INTO public.po_status_history(po_id, from_status, to_status, note, actor_id, actor_email)
  VALUES (v_po.id, v_po.status, COALESCE(v_state->>'status', v_po.status),
          'UNDO_RECEIPT ' || COALESCE(v_receipt.receipt_code, '#' || v_receipt.receipt_number::text),
          v_actor, p_actor_email);

  RETURN jsonb_build_object('ok', true, 'po_state', v_state);
END $$;

GRANT EXECUTE ON FUNCTION public.delete_po_receipt_batch(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.undo_last_po_receipt(
  p_po_id uuid,
  p_actor_email text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_po record;
  v_receipt_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF v_po IS NULL THEN RAISE EXCEPTION 'PO_NOT_FOUND'; END IF;
  IF NOT (public.is_admin() OR public.has_role(v_actor, 'purchasing'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT public.can_access_user_data(v_po.user_id) THEN RAISE EXCEPTION 'forbidden (company)'; END IF;

  SELECT id INTO v_receipt_id
    FROM public.po_receipts
   WHERE po_id = p_po_id
   ORDER BY receipt_number DESC, created_at DESC
   LIMIT 1;

  IF v_receipt_id IS NULL THEN
    RAISE EXCEPTION 'NO_RECEIPT_TO_UNDO';
  END IF;

  RETURN public.delete_po_receipt_batch(v_receipt_id, p_actor_email);
END $$;

REVOKE ALL ON FUNCTION public.undo_last_po_receipt(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_last_po_receipt(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_historical_po_receipt(_po_id uuid, _receipt_date timestamp with time zone, _items jsonb, _notes text, _apply_to_inventory boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_po record;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_receipt_id uuid;
  v_total numeric := 0;
  v_next_num int;
  v_code text;
  v_item record;
  v_existing record;
  v_stock_before numeric;
  v_stock_after numeric;
  v_state jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = _po_id FOR UPDATE;
  IF v_po IS NULL THEN RAISE EXCEPTION 'PO_NOT_FOUND' USING ERRCODE='22023'; END IF;
  IF NOT public.can_access_user_data(v_po.user_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (public.is_admin() OR public.has_role(v_actor, 'purchasing'::public.app_role) OR public.has_role(v_actor, 'cfo'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _receipt_date IS NULL THEN RAISE EXCEPTION 'RECEIPT_DATE_REQUIRED' USING ERRCODE='22023'; END IF;
  IF _receipt_date > now() + interval '1 day' THEN
    RAISE EXCEPTION 'FUTURE_DATE_NOT_ALLOWED' USING ERRCODE='22023';
  END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_ITEMS' USING ERRCODE='22023';
  END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor;
  v_actor_email := COALESCE(v_actor_email, _notes, 'system');

  SELECT COALESCE(MAX(receipt_number),0)+1 INTO v_next_num FROM public.po_receipts WHERE po_id = _po_id;
  v_code := COALESCE(v_po.shipment_code, v_po.po_number) || '#' || v_next_num::text;

  INSERT INTO public.po_receipts(po_id, user_id, receipt_number, receipt_code, total_qty, notes, actor_id, actor_email, receipt_date, created_at)
  VALUES (_po_id, v_po.user_id, v_next_num, v_code, 0, NULLIF(trim(_notes), ''), v_actor, v_actor_email, _receipt_date, now())
  RETURNING id INTO v_receipt_id;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(item_id uuid, received_qty numeric) LOOP
    IF v_item.received_qty IS NULL OR v_item.received_qty <= 0 THEN CONTINUE; END IF;
    SELECT * INTO v_existing FROM public.purchase_order_items WHERE id = v_item.item_id AND po_id = _po_id FOR UPDATE;
    IF v_existing IS NULL THEN RAISE EXCEPTION 'INVALID_ITEM %', v_item.item_id USING ERRCODE='22023'; END IF;
    IF (v_existing.received_qty + v_item.received_qty) > v_existing.quantity THEN
      RAISE EXCEPTION 'QTY_EXCEEDS_REMAINING' USING ERRCODE='22023';
    END IF;

    SELECT stock_quantity INTO v_stock_before FROM public.products WHERE id = v_existing.product_id FOR UPDATE;
    v_stock_after := v_stock_before;
    IF _apply_to_inventory THEN
      UPDATE public.products SET stock_quantity = stock_quantity + v_item.received_qty, updated_at = now() WHERE id = v_existing.product_id;
      v_stock_after := v_stock_before + v_item.received_qty;
      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
      VALUES (v_po.user_id, v_existing.product_id, v_item.received_qty,
              'PO ' || v_po.po_number || ' استلام تاريخي ' || v_code,
              v_actor, v_actor_email);
    END IF;

    UPDATE public.purchase_order_items SET received_qty = received_qty + v_item.received_qty WHERE id = v_item.item_id;
    INSERT INTO public.po_receipt_items(receipt_id, po_item_id, product_id, product_name, serial_number, color, quantity, stock_before, stock_after)
    VALUES (v_receipt_id, v_item.item_id, v_existing.product_id, v_existing.product_name, v_existing.serial_number, v_existing.color, v_item.received_qty, v_stock_before, v_stock_after);
    v_total := v_total + v_item.received_qty;
  END LOOP;

  IF v_total <= 0 THEN
    DELETE FROM public.po_receipts WHERE id = v_receipt_id;
    RAISE EXCEPTION 'EMPTY_ITEMS' USING ERRCODE='22023';
  END IF;

  UPDATE public.po_receipts SET total_qty = v_total WHERE id = v_receipt_id;
  v_state := public.recalculate_po_receipt_state(_po_id);

  INSERT INTO public.po_status_history(po_id, from_status, to_status, note, actor_id, actor_email, created_at)
  VALUES (
    _po_id, v_po.status, COALESCE(v_state->>'status', v_po.status),
    format('[HISTORICAL_RECEIPT] %s · qty %s · date %s · inventory %s%s',
      v_code, v_total,
      to_char(_receipt_date AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI'),
      CASE WHEN _apply_to_inventory THEN 'applied' ELSE 'skipped' END,
      CASE WHEN NULLIF(trim(_notes),'') IS NOT NULL THEN ' · '||trim(_notes) ELSE '' END
    ),
    v_actor, v_actor_email, now()
  );

  RETURN v_receipt_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_historical_po_receipt(uuid, timestamptz, jsonb, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_historical_po_receipt(uuid, timestamptz, jsonb, text, boolean) TO authenticated;

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
  v_code text;
  v_batch_total int := 0;
  v_total_ordered int;
  v_total_received int;
  v_fully boolean;
  v_stock_before int;
  v_stock_after int;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF v_po IS NULL THEN RAISE EXCEPTION 'PO not found'; END IF;

  IF NOT (public.is_admin() OR public.has_role(v_actor, 'purchasing'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT public.can_access_user_data(v_po.user_id) THEN
    RAISE EXCEPTION 'forbidden (company)';
  END IF;
  IF v_po.status = 'cancelled' THEN RAISE EXCEPTION 'PO cancelled'; END IF;

  SELECT COALESCE(MAX(receipt_number), 0) + 1 INTO v_receipt_no
    FROM public.po_receipts WHERE po_id = p_po_id;
  v_code := COALESCE(v_po.shipment_code, v_po.po_number) || '#' || v_receipt_no::text;

  INSERT INTO public.po_receipts (po_id, user_id, receipt_number, receipt_code, receipt_date, notes, actor_id, actor_email)
  VALUES (p_po_id, v_po.user_id, v_receipt_no, v_code, now(), NULLIF(p_notes, ''), v_actor, p_actor_email)
  RETURNING id INTO v_receipt_id;

  FOR v_in IN SELECT jsonb_array_elements(items_in) LOOP
    v_recv := COALESCE((v_in->>'received_qty')::int, 0);
    IF v_recv <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_item FROM public.purchase_order_items
      WHERE id = (v_in->>'item_id')::uuid AND po_id = p_po_id FOR UPDATE;
    IF v_item IS NULL THEN RAISE EXCEPTION 'item not found in PO'; END IF;
    IF v_item.received_qty + v_recv > v_item.quantity THEN
      RAISE EXCEPTION 'received qty (%) exceeds remaining for %', v_recv, v_item.product_name;
    END IF;

    SELECT stock_quantity INTO v_stock_before FROM public.products WHERE id = v_item.product_id FOR UPDATE;
    v_stock_after := COALESCE(v_stock_before, 0) + v_recv;

    UPDATE public.products SET stock_quantity = v_stock_after, updated_at = now() WHERE id = v_item.product_id;
    UPDATE public.purchase_order_items SET received_qty = received_qty + v_recv WHERE id = v_item.id;

    INSERT INTO public.po_receipt_items
      (receipt_id, po_item_id, product_id, product_name, serial_number, color, quantity, stock_before, stock_after)
    VALUES
      (v_receipt_id, v_item.id, v_item.product_id, v_item.product_name, v_item.serial_number, v_item.color,
       v_recv, v_stock_before, v_stock_after);

    INSERT INTO public.inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
    VALUES (v_po.user_id, v_item.product_id, v_recv,
            'PO ' || v_po.po_number || ' استلام دفعة ' || v_code, v_actor, p_actor_email);

    PERFORM public.fulfill_reservations_for_po_item(v_item.id, v_recv);
    v_batch_total := v_batch_total + v_recv;
  END LOOP;

  IF v_batch_total = 0 THEN
    DELETE FROM public.po_receipts WHERE id = v_receipt_id;
    RAISE EXCEPTION 'no items received';
  END IF;

  UPDATE public.po_receipts SET total_qty = v_batch_total WHERE id = v_receipt_id;

  SELECT COALESCE(SUM(quantity),0), COALESCE(SUM(received_qty),0)
    INTO v_total_ordered, v_total_received
    FROM public.purchase_order_items WHERE po_id = p_po_id;

  v_fully := (v_total_received >= v_total_ordered AND v_total_ordered > 0);

  UPDATE public.purchase_orders
    SET status = CASE WHEN v_fully THEN 'received' ELSE 'in_warehouse' END,
        received_at = CASE WHEN v_fully THEN now() ELSE received_at END,
        received_by = CASE WHEN v_fully THEN v_actor ELSE received_by END,
        received_by_email = CASE WHEN v_fully THEN p_actor_email ELSE received_by_email END,
        stock_applied_at = COALESCE(stock_applied_at, now()),
        updated_at = now()
    WHERE id = p_po_id;

  INSERT INTO public.po_status_history (po_id, from_status, to_status, note, actor_id, actor_email)
  VALUES (p_po_id, v_po.status,
          CASE WHEN v_fully THEN 'received' ELSE 'in_warehouse' END,
          'دفعة ' || v_code || ': ' || v_batch_total || ' (إجمالي ' || v_total_received || '/' || v_total_ordered || ')',
          v_actor, p_actor_email);

  RETURN jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_no,
    'receipt_code', v_code,
    'fully_received', v_fully,
    'batch_qty', v_batch_total,
    'total_ordered', v_total_ordered,
    'total_received', v_total_received
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_po_receipt(uuid, jsonb, text, text) TO authenticated;