
-- Admin-only: full inventory reset to zero
CREATE OR REPLACE FUNCTION public.reset_all_inventory(p_actor_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_logs int; v_recv int; v_prods int; v_dris int; v_poi int;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;

  -- 1) wipe inventory logs
  DELETE FROM public.inventory_logs;
  GET DIAGNOSTICS v_logs = ROW_COUNT;

  -- 2) wipe PO receipts (cascades to items)
  DELETE FROM public.po_receipts;
  GET DIAGNOSTICS v_recv = ROW_COUNT;

  -- 3) clear back-deduction tracking on DRIs (so they become pending again)
  UPDATE public.delivery_receipt_items
     SET back_deducted_at = NULL,
         back_deducted_by_email = NULL,
         back_deducted_from_po = NULL
   WHERE back_deducted_at IS NOT NULL;
  GET DIAGNOSTICS v_dris = ROW_COUNT;

  -- 4) zero products stock
  UPDATE public.products SET stock_quantity = 0 WHERE stock_quantity <> 0;
  GET DIAGNOSTICS v_prods = ROW_COUNT;

  -- 5) reset received_qty on PO items
  UPDATE public.purchase_order_items SET received_qty = 0 WHERE received_qty <> 0;
  GET DIAGNOSTICS v_poi = ROW_COUNT;

  -- 6) revert PO header status flags
  UPDATE public.purchase_orders
     SET stock_applied_at = NULL,
         received_at = NULL,
         received_by = NULL,
         received_by_email = NULL,
         status = CASE WHEN status = 'received' THEN 'in_warehouse' ELSE status END;

  -- audit
  INSERT INTO public.audit_log(actor_id, actor_email, action, entity_type, entity_id, details)
  VALUES (v_actor, p_actor_email, 'reset_all_inventory', 'inventory', NULL,
          jsonb_build_object('logs_deleted', v_logs, 'receipts_deleted', v_recv,
                             'products_zeroed', v_prods, 'dris_reset', v_dris,
                             'po_items_reset', v_poi));

  RETURN jsonb_build_object('ok', true, 'logs_deleted', v_logs,
                            'receipts_deleted', v_recv, 'products_zeroed', v_prods,
                            'dris_reset', v_dris, 'po_items_reset', v_poi);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_all_inventory(text) TO authenticated;

-- Bulk receive: receive multiple POs with multiple batches each, atomically.
-- payload shape: [{ po_id: uuid, batches: [{ notes?: text, items: [{ po_item_id, product_id, quantity, serial_number?, color? }] }] }]
CREATE OR REPLACE FUNCTION public.bulk_apply_po_receipts(p_payload jsonb, p_actor_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po record;
  v_batch jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_po_count int := 0;
  v_batch_count int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  FOR v_po IN
    SELECT (elem->>'po_id')::uuid AS po_id, elem->'batches' AS batches
      FROM jsonb_array_elements(p_payload) elem
  LOOP
    v_po_count := v_po_count + 1;
    FOR v_batch IN SELECT * FROM jsonb_array_elements(v_po.batches)
    LOOP
      v_batch_count := v_batch_count + 1;
      v_result := public.apply_po_receipt_with_back_deduct(
        v_po.po_id,
        v_batch->'items',
        COALESCE(v_batch->>'notes', NULL),
        p_actor_email
      );
      v_results := v_results || jsonb_build_object('po_id', v_po.po_id, 'result', v_result);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'pos', v_po_count, 'batches', v_batch_count, 'results', v_results);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_apply_po_receipts(jsonb, text) TO authenticated;
