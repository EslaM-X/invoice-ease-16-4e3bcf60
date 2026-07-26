CREATE OR REPLACE FUNCTION public.recompute_invoice_delivery_status(_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_delivery text;
  v_needed numeric;
  v_delivered numeric;
  v_receipt_count int;
  v_new text;
BEGIN
  SELECT status, delivery_status INTO v_status, v_delivery
    FROM public.invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Never touch closed/archived/voided invoices
  IF v_status IN ('voided','archived','completed') THEN RETURN; END IF;
  IF v_delivery = 'delivered' THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_receipt_count
    FROM public.delivery_receipts WHERE invoice_id = _invoice_id;

  SELECT COALESCE(SUM(quantity),0) INTO v_needed
    FROM public.invoice_items WHERE invoice_id = _invoice_id AND product_id IS NOT NULL;

  SELECT COALESCE(SUM(dri.quantity),0) INTO v_delivered
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    WHERE dr.invoice_id = _invoice_id
      AND dr.status IN ('signed','out_for_delivery')
      AND dr.archived_at IS NULL;

  IF v_needed > 0 AND v_delivered >= v_needed THEN
    v_new := 'delivered';
  ELSIF v_delivered > 0 THEN
    v_new := 'in_transit';
  ELSE
    v_new := 'pending';
  END IF;

  IF v_new IS DISTINCT FROM v_delivery THEN
    UPDATE public.invoices SET delivery_status = v_new WHERE id = _invoice_id;
  END IF;
END;
$function$;