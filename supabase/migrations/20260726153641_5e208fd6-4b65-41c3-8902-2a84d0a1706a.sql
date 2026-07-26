
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS delivery_status_override boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.recompute_invoice_delivery_status(_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_delivery text;
  v_override boolean;
  v_needed numeric;
  v_signed_qty numeric;
  v_out_qty numeric;
  v_has_out_for_delivery boolean;
  v_new text;
BEGIN
  SELECT status, delivery_status, delivery_status_override
    INTO v_status, v_delivery, v_override
  FROM public.invoices
  WHERE id = _invoice_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Manual override locks the status.
  IF v_override THEN
    RETURN;
  END IF;

  IF v_status IN ('voided', 'archived') THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO v_needed
  FROM public.invoice_items
  WHERE invoice_id = _invoice_id
    AND product_id IS NOT NULL;

  SELECT COALESCE(SUM(dri.quantity), 0) INTO v_signed_qty
  FROM public.delivery_receipt_items dri
  JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
  WHERE dr.invoice_id = _invoice_id
    AND dr.status = 'signed'
    AND dr.archived_at IS NULL;

  SELECT
    COALESCE(SUM(dri.quantity), 0),
    COALESCE(bool_or(true), false)
  INTO v_out_qty, v_has_out_for_delivery
  FROM public.delivery_receipt_items dri
  JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
  WHERE dr.invoice_id = _invoice_id
    AND dr.status = 'out_for_delivery'
    AND dr.archived_at IS NULL;

  IF v_needed > 0 AND v_signed_qty >= v_needed THEN
    v_new := 'delivered';
  ELSIF v_signed_qty > 0 OR v_out_qty > 0 OR v_has_out_for_delivery THEN
    v_new := 'in_transit';
  ELSE
    v_new := 'pending';
  END IF;

  IF v_delivery = 'delivered'
     AND v_new <> 'delivered'
     AND NOT v_has_out_for_delivery THEN
    RETURN;
  END IF;

  IF v_new IS DISTINCT FROM v_delivery THEN
    UPDATE public.invoices
    SET delivery_status = v_new
    WHERE id = _invoice_id;
  END IF;
END;
$function$;
