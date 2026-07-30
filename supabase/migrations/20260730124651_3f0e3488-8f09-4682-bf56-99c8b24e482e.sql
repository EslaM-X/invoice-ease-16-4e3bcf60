CREATE OR REPLACE FUNCTION public.reverse_delivery_signature(p_receipt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_line    record;
  v_undone  integer := 0;
  v_qty     integer;
  v_restore integer;
BEGIN
  FOR v_line IN
    SELECT dri.id, dri.invoice_item_id, dri.quantity,
           ii.product_id, ii.reserved_qty, ii.delivered_qty, ii.quantity AS invoice_qty
    FROM public.delivery_receipt_items dri
    LEFT JOIN public.invoice_items ii ON ii.id = dri.invoice_item_id
    WHERE dri.receipt_id = p_receipt_id
      AND dri.stock_applied_at IS NOT NULL
    FOR UPDATE OF dri
  LOOP
    v_qty := COALESCE(v_line.quantity, 0);

    IF v_line.product_id IS NOT NULL AND v_qty > 0 THEN
      UPDATE public.products
         SET stock_quantity = stock_quantity + v_qty,
             updated_at = now()
       WHERE id = v_line.product_id;

      INSERT INTO public.inventory_logs(product_id, change, reason, user_id)
      VALUES (v_line.product_id, v_qty,
              'delivery_reversal:receipt:' || p_receipt_id::text,
              auth.uid());
    END IF;

    IF v_line.invoice_item_id IS NOT NULL THEN
      v_restore := LEAST(v_qty, GREATEST(0, COALESCE(v_line.invoice_qty,0) - GREATEST(0, COALESCE(v_line.delivered_qty,0) - v_qty)));
      UPDATE public.invoice_items
         SET delivered_qty = GREATEST(0, COALESCE(delivered_qty,0) - v_qty),
             reserved_qty  = COALESCE(reserved_qty,0) + v_restore
       WHERE id = v_line.invoice_item_id;
    END IF;

    UPDATE public.delivery_receipt_items
       SET stock_applied_at = NULL
     WHERE id = v_line.id;

    v_undone := v_undone + 1;
  END LOOP;

  RETURN jsonb_build_object('receipt_id', p_receipt_id, 'lines_reversed', v_undone);
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_dr_reservation_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_flag_on('reservation_engine') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('signed','paid') THEN
      PERFORM public.reverse_delivery_signature(OLD.id);
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('signed','paid') THEN
      PERFORM public.apply_delivery_signature(NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: 'paid' is a post-delivery archival state, NOT a reversal
  IF NEW.status IN ('signed','paid') AND OLD.status NOT IN ('signed','paid') THEN
    PERFORM public.apply_delivery_signature(NEW.id);
  ELSIF OLD.status IN ('signed','paid') AND NEW.status NOT IN ('signed','paid') THEN
    PERFORM public.reverse_delivery_signature(NEW.id);
  END IF;

  RETURN NEW;
END;
$function$;