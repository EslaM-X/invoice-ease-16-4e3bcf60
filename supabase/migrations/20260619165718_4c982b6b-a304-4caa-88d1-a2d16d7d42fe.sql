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
  IF NOT public.is_inventory_admin() THEN RAISE EXCEPTION 'forbidden: inventory admin only'; END IF;

  DELETE FROM public.inventory_logs WHERE id IS NOT NULL; GET DIAGNOSTICS v_logs = ROW_COUNT;
  DELETE FROM public.po_receipts    WHERE id IS NOT NULL; GET DIAGNOSTICS v_recv = ROW_COUNT;

  UPDATE public.delivery_receipt_items
     SET back_deducted_at = NULL, back_deducted_by_email = NULL, back_deducted_from_po = NULL
   WHERE back_deducted_at IS NOT NULL;
  GET DIAGNOSTICS v_dris = ROW_COUNT;

  UPDATE public.products SET stock_quantity = 0 WHERE stock_quantity <> 0;
  GET DIAGNOSTICS v_prods = ROW_COUNT;

  UPDATE public.purchase_order_items SET received_qty = 0 WHERE received_qty <> 0;
  GET DIAGNOSTICS v_poi = ROW_COUNT;

  UPDATE public.purchase_orders
     SET stock_applied_at = NULL,
         received_at = NULL,
         received_by = NULL,
         received_by_email = NULL,
         status = CASE WHEN status = 'received' THEN 'in_warehouse' ELSE status END
   WHERE stock_applied_at IS NOT NULL
      OR received_at IS NOT NULL
      OR received_by IS NOT NULL
      OR received_by_email IS NOT NULL
      OR status = 'received';

  INSERT INTO public.audit_log(actor_id, actor_email, action, entity_type, entity_id, details)
  VALUES (v_actor, p_actor_email, 'reset_all_inventory', 'inventory', NULL,
          jsonb_build_object('logs_deleted', v_logs, 'receipts_deleted', v_recv,
                             'products_zeroed', v_prods, 'dris_unlinked', v_dris,
                             'poi_zeroed', v_poi));

  RETURN jsonb_build_object('ok', true, 'logs_deleted', v_logs, 'receipts_deleted', v_recv,
                            'products_zeroed', v_prods, 'dris_unlinked', v_dris, 'poi_zeroed', v_poi);
END;
$$;