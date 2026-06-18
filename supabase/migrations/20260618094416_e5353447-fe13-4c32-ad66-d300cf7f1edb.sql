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
  v_qty_delta int;
  v_stock_delta int;
  v_apply_inventory boolean := true;
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

  SELECT COALESCE(bool_or(COALESCE(stock_after, stock_before, 0) <> COALESCE(stock_before, 0)), true)
    INTO v_apply_inventory
    FROM public.po_receipt_items
   WHERE receipt_id = p_receipt_id;

  IF p_receipt_date IS NOT NULL THEN
    UPDATE public.po_receipts SET receipt_date = p_receipt_date WHERE id = p_receipt_id;
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

      v_qty_delta := v_new_qty - COALESCE(v_existing.quantity, 0);
      v_stock_delta := CASE WHEN v_apply_inventory THEN v_qty_delta ELSE 0 END;
      IF v_qty_delta = 0 THEN
        v_total := v_total + v_new_qty;
        CONTINUE;
      END IF;

      IF v_po_item.received_qty + v_qty_delta > v_po_item.quantity THEN
        RAISE EXCEPTION 'QTY_EXCEEDS_REMAINING';
      END IF;
      IF v_po_item.received_qty + v_qty_delta < 0 THEN
        RAISE EXCEPTION 'QTY_WOULD_GO_NEGATIVE';
      END IF;

      SELECT stock_quantity INTO v_stock_before FROM public.products WHERE id = v_po_item.product_id FOR UPDATE;
      v_stock_after := GREATEST(0, COALESCE(v_stock_before,0) + v_stock_delta);

      IF v_stock_delta <> 0 THEN
        UPDATE public.products SET stock_quantity = v_stock_after, updated_at = now() WHERE id = v_po_item.product_id;
        INSERT INTO public.inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
        VALUES (v_po.user_id, v_po_item.product_id, v_stock_delta,
                'PO ' || v_po.po_number || ' تعديل دفعة #' || v_receipt.receipt_number || ' (' || COALESCE(v_existing.quantity,0)::text || '→' || v_new_qty::text || ')',
                v_actor, p_actor_email);
      END IF;

      UPDATE public.purchase_order_items SET received_qty = received_qty + v_qty_delta WHERE id = v_po_item.id;

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

      v_changes := v_changes + 1;
      v_total := v_total + v_new_qty;
    END LOOP;
  ELSE
    SELECT COALESCE(SUM(quantity),0)::int INTO v_total FROM public.po_receipt_items WHERE receipt_id = p_receipt_id;
  END IF;

  UPDATE public.po_receipts SET total_qty = v_total WHERE id = p_receipt_id;
  v_state := public.recalculate_po_receipt_state(v_receipt.po_id);
  RETURN jsonb_build_object('ok', true, 'changes', v_changes, 'total_qty', v_total, 'po_state', v_state, 'inventory_applied', v_apply_inventory);
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
  v_applied_delta int;
  v_state jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_receipt FROM public.po_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF v_receipt IS NULL THEN RAISE EXCEPTION 'receipt not found'; END IF;
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = v_receipt.po_id FOR UPDATE;
  IF NOT (public.is_admin() OR public.has_role(v_actor, 'purchasing'::public.app_role)) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT public.can_access_user_data(v_po.user_id) THEN RAISE EXCEPTION 'forbidden (company)'; END IF;

  FOR rec IN SELECT * FROM public.po_receipt_items WHERE receipt_id = p_receipt_id LOOP
    v_applied_delta := COALESCE(rec.stock_after, rec.stock_before, 0) - COALESCE(rec.stock_before, 0);
    IF v_applied_delta <> 0 THEN
      SELECT stock_quantity INTO v_stock FROM public.products WHERE id = rec.product_id FOR UPDATE;
      UPDATE public.products SET stock_quantity = GREATEST(0, COALESCE(v_stock,0) - v_applied_delta), updated_at = now()
        WHERE id = rec.product_id;
      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
      VALUES (v_po.user_id, rec.product_id, -v_applied_delta,
              'PO ' || v_po.po_number || ' تراجع/حذف دفعة #' || v_receipt.receipt_number, v_actor, p_actor_email);
    END IF;
    UPDATE public.purchase_order_items SET received_qty = GREATEST(0, received_qty - rec.quantity)
      WHERE id = rec.po_item_id;
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