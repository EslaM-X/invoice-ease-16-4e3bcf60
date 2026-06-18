CREATE OR REPLACE FUNCTION public.delete_po_with_inventory_rollback(
  p_po_id uuid,
  p_actor_email text,
  p_force boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_po record;
  v_actor uuid := auth.uid();
  rec record;
  v_stock int;
  v_reserved_count int := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT is_admin() THEN RAISE EXCEPTION 'forbidden (admin only)'; END IF;

  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF v_po IS NULL THEN RAISE EXCEPTION 'PO not found'; END IF;
  IF NOT can_access_user_data(v_po.user_id) THEN RAISE EXCEPTION 'forbidden (company)'; END IF;

  SELECT count(*) INTO v_reserved_count
    FROM invoice_po_reservations r
    JOIN purchase_order_items poi ON poi.id = r.po_item_id
   WHERE poi.po_id = p_po_id;

  IF v_reserved_count > 0 AND NOT p_force THEN
    RAISE EXCEPTION 'cannot delete: % invoice reservation(s) linked to this PO. Cancel those invoices first.', v_reserved_count;
  END IF;

  FOR rec IN
    SELECT pri.product_id, SUM(pri.quantity)::int AS qty
      FROM po_receipt_items pri
      JOIN po_receipts pr ON pr.id = pri.receipt_id
     WHERE pr.po_id = p_po_id
     GROUP BY pri.product_id
  LOOP
    SELECT stock_quantity INTO v_stock FROM products WHERE id = rec.product_id FOR UPDATE;
    UPDATE products
       SET stock_quantity = GREATEST(0, COALESCE(v_stock, 0) - rec.qty),
           updated_at = now()
     WHERE id = rec.product_id;

    INSERT INTO inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
    VALUES (v_po.user_id, rec.product_id, -rec.qty,
            'PO ' || v_po.po_number || ' حذف أمر شراء', v_actor, p_actor_email);
  END LOOP;

  IF v_reserved_count > 0 AND p_force THEN
    DELETE FROM invoice_po_reservations r
      USING purchase_order_items poi
     WHERE r.po_item_id = poi.id AND poi.po_id = p_po_id;
  END IF;

  -- Prevent the legacy BEFORE DELETE trigger from trying to update the same row being deleted.
  UPDATE purchase_orders
     SET stock_applied_at = NULL,
         updated_at = now()
   WHERE id = p_po_id;

  DELETE FROM po_receipts WHERE po_id = p_po_id;
  DELETE FROM purchase_order_items WHERE po_id = p_po_id;
  DELETE FROM purchase_orders WHERE id = p_po_id;

  RETURN jsonb_build_object('ok', true, 'reservations_removed', CASE WHEN p_force THEN v_reserved_count ELSE 0 END);
END $$;

GRANT EXECUTE ON FUNCTION public.delete_po_with_inventory_rollback(uuid, text, boolean) TO authenticated;

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

  INSERT INTO po_receipts (po_id, user_id, receipt_number, receipt_date, notes, actor_id, actor_email)
  VALUES (p_po_id, v_po.user_id, v_receipt_no, now(), NULLIF(p_notes, ''), v_actor, p_actor_email)
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

    INSERT INTO inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
    VALUES (v_po.user_id, v_item.product_id, v_recv,
            'PO ' || v_po.po_number || ' استلام دفعة #' || v_receipt_no, v_actor, p_actor_email);

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

  v_fully := (v_total_received >= v_total_ordered AND v_total_ordered > 0);

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

GRANT EXECUTE ON FUNCTION public.apply_po_receipt(uuid, jsonb, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_fully_received_po_status_regression()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ordered int;
  v_received int;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'cancelled' THEN
    SELECT COALESCE(SUM(quantity),0)::int, COALESCE(SUM(received_qty),0)::int
      INTO v_ordered, v_received
      FROM purchase_order_items
     WHERE po_id = NEW.id;

    IF v_ordered > 0 AND v_received >= v_ordered AND NEW.status <> 'received' THEN
      NEW.status := 'received';
      NEW.received_at := COALESCE(NEW.received_at, OLD.received_at, now());
      NEW.stock_applied_at := COALESCE(NEW.stock_applied_at, OLD.stock_applied_at, now());
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_prevent_fully_received_po_status_regression ON public.purchase_orders;
CREATE TRIGGER trg_prevent_fully_received_po_status_regression
BEFORE UPDATE OF status ON public.purchase_orders
FOR EACH ROW
EXECUTE FUNCTION public.prevent_fully_received_po_status_regression();