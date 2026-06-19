CREATE OR REPLACE FUNCTION public.apply_back_deductions(
  p_dri_ids uuid[],
  p_from_po uuid,
  p_actor_email text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row record;
  v_stock_before int;
  v_deductable int;
  v_shortfall int;
  v_stock_after int;
  v_count int := 0;
  v_total_qty int := 0;
  v_total_shortfall int := 0;
  v_po_number text;
  v_user_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT (is_admin() OR has_role(v_actor, 'purchasing'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT po_number, user_id INTO v_po_number, v_user_id
    FROM public.purchase_orders WHERE id = p_from_po;

  FOR v_row IN
    SELECT dri.id AS dri_id, dri.quantity, ii.product_id, dri.receipt_id, dri.serial_number
    FROM public.delivery_receipt_items dri
    JOIN public.invoice_items ii ON ii.id = dri.invoice_item_id
    WHERE dri.id = ANY(p_dri_ids)
      AND dri.back_deducted_at IS NULL
      AND ii.product_id IS NOT NULL
  LOOP
    SELECT stock_quantity INTO v_stock_before
      FROM public.products WHERE id = v_row.product_id FOR UPDATE;

    -- Clamp deduction to current stock; never go negative (avoids
    -- products_stock_non_negative violation that previously rolled back the
    -- whole PO receipt confirmation).
    v_deductable := LEAST(v_row.quantity, GREATEST(COALESCE(v_stock_before, 0), 0));
    v_shortfall  := v_row.quantity - v_deductable;
    v_stock_after := COALESCE(v_stock_before, 0) - v_deductable;

    IF v_deductable > 0 THEN
      UPDATE public.products
         SET stock_quantity = v_stock_after, updated_at = now()
       WHERE id = v_row.product_id;
    END IF;

    -- Mark DRI as back-deducted so it stops appearing in pending list.
    UPDATE public.delivery_receipt_items
       SET back_deducted_at = now(),
           back_deducted_by_email = p_actor_email,
           back_deducted_from_po = p_from_po
     WHERE id = v_row.dri_id;

    IF v_deductable > 0 THEN
      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
      VALUES (
        COALESCE(v_user_id, v_actor),
        v_row.product_id,
        -v_deductable,
        'خصم محضر استلام تاريخي (PO ' || COALESCE(v_po_number, p_from_po::text) || ')'
          || CASE WHEN v_shortfall > 0
                  THEN ' — جزئي (متبقي بدون خصم: ' || v_shortfall::text || ')'
                  ELSE '' END,
        v_actor,
        p_actor_email
      );
    END IF;

    INSERT INTO public.audit_log (actor_id, actor_email, entity_type, entity_id, action, details)
    VALUES (
      v_actor, p_actor_email,
      'delivery_receipt_item', v_row.dri_id,
      CASE WHEN v_shortfall > 0 THEN 'back_deduct_partial' ELSE 'back_deduct_applied' END,
      jsonb_build_object(
        'po_id', p_from_po,
        'po_number', v_po_number,
        'product_id', v_row.product_id,
        'receipt_id', v_row.receipt_id,
        'serial_number', v_row.serial_number,
        'requested_quantity', v_row.quantity,
        'deducted_quantity', v_deductable,
        'shortfall', v_shortfall,
        'stock_before', v_stock_before,
        'stock_after', v_stock_after
      )
    );

    v_count := v_count + 1;
    v_total_qty := v_total_qty + v_deductable;
    v_total_shortfall := v_total_shortfall + v_shortfall;
  END LOOP;

  RETURN jsonb_build_object(
    'items', v_count,
    'total_qty', v_total_qty,
    'shortfall', v_total_shortfall
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_back_deductions(uuid[], uuid, text) TO authenticated;