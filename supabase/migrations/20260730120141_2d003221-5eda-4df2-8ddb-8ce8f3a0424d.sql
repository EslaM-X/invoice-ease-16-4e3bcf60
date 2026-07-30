CREATE OR REPLACE FUNCTION public.apply_delivery_signature(p_receipt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receipt  record;
  v_line     record;
  v_applied  integer := 0;
  v_deduct   integer;
  v_reduce   integer;
BEGIN
  SELECT id, invoice_id, status INTO v_receipt
  FROM public.delivery_receipts WHERE id = p_receipt_id FOR UPDATE;

  IF v_receipt.id IS NULL THEN
    RAISE EXCEPTION 'Receipt % not found', p_receipt_id;
  END IF;

  FOR v_line IN
    SELECT dri.id, dri.invoice_item_id, dri.quantity,
           ii.product_id, ii.reserved_qty, ii.delivered_qty, ii.quantity AS invoice_qty
    FROM public.delivery_receipt_items dri
    LEFT JOIN public.invoice_items ii ON ii.id = dri.invoice_item_id
    WHERE dri.receipt_id = p_receipt_id
      AND dri.stock_applied_at IS NULL
    FOR UPDATE OF dri
  LOOP
    v_deduct := COALESCE(v_line.quantity, 0);

    IF v_line.product_id IS NOT NULL AND v_deduct > 0 THEN
      UPDATE public.products
         SET stock_quantity = stock_quantity - v_deduct,
             updated_at = now()
       WHERE id = v_line.product_id;

      INSERT INTO public.inventory_logs(product_id, change, reason, user_id)
      VALUES (v_line.product_id, -v_deduct,
              'delivery_deduction:receipt:' || p_receipt_id::text,
              auth.uid());
    END IF;

    IF v_line.invoice_item_id IS NOT NULL THEN
      v_reduce := LEAST(v_deduct, COALESCE(v_line.reserved_qty, 0));
      UPDATE public.invoice_items
         SET reserved_qty  = GREATEST(0, COALESCE(reserved_qty, 0) - v_reduce),
             delivered_qty = COALESCE(delivered_qty, 0) + v_deduct
       WHERE id = v_line.invoice_item_id;
    END IF;

    UPDATE public.delivery_receipt_items
       SET stock_applied_at = now()
     WHERE id = v_line.id;

    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object('receipt_id', p_receipt_id, 'lines_applied', v_applied);
END;
$function$;