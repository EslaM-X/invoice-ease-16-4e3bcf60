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
  v_in_transit numeric;
  v_new text;
BEGIN
  SELECT status, delivery_status INTO v_status, v_delivery
  FROM public.invoices WHERE id = _invoice_id;

  IF NOT FOUND THEN RETURN; END IF;

  -- One-way safety: never downgrade already-delivered invoices.
  IF v_delivery = 'delivered' THEN RETURN; END IF;
  IF v_status IN ('voided', 'archived', 'completed') THEN RETURN; END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO v_needed
  FROM public.invoice_items
  WHERE invoice_id = _invoice_id AND product_id IS NOT NULL;

  -- Only signed receipts count as actually delivered.
  SELECT COALESCE(SUM(dri.quantity), 0) INTO v_delivered
  FROM public.delivery_receipt_items dri
  JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
  WHERE dr.invoice_id = _invoice_id
    AND dr.status = 'signed'
    AND dr.archived_at IS NULL;

  -- In-transit receipts keep the invoice open in "in_transit".
  SELECT COALESCE(SUM(dri.quantity), 0) INTO v_in_transit
  FROM public.delivery_receipt_items dri
  JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
  WHERE dr.invoice_id = _invoice_id
    AND dr.status = 'out_for_delivery'
    AND dr.archived_at IS NULL;

  IF v_needed > 0 AND v_delivered >= v_needed THEN
    v_new := 'delivered';
  ELSIF v_delivered > 0 OR v_in_transit > 0 THEN
    v_new := 'in_transit';
  ELSE
    v_new := 'pending';
  END IF;

  IF v_new IS DISTINCT FROM v_delivery THEN
    UPDATE public.invoices
    SET delivery_status = v_new
    WHERE id = _invoice_id
      AND delivery_status IS DISTINCT FROM 'delivered';
  END IF;
END;
$function$;

-- Fix invoices that were wrongly closed because only "out_for_delivery" receipts existed.
-- Strict guard: only touch invoices that are NOT completed/archived/voided, are currently marked delivered,
-- and have NO signed receipts covering their required quantity.
WITH candidates AS (
  SELECT i.id
  FROM public.invoices i
  WHERE i.delivery_status = 'delivered'
    AND i.status NOT IN ('completed', 'archived', 'voided')
    AND EXISTS (
      SELECT 1 FROM public.delivery_receipts dr
      WHERE dr.invoice_id = i.id
        AND dr.status = 'out_for_delivery'
        AND dr.archived_at IS NULL
    )
    AND COALESCE((
      SELECT SUM(dri.quantity)
      FROM public.delivery_receipt_items dri
      JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
      WHERE dr.invoice_id = i.id
        AND dr.status = 'signed'
        AND dr.archived_at IS NULL
    ), 0) < COALESCE((
      SELECT SUM(quantity) FROM public.invoice_items
      WHERE invoice_id = i.id AND product_id IS NOT NULL
    ), 0)
)
UPDATE public.invoices SET delivery_status = 'in_transit'
WHERE id IN (SELECT id FROM candidates);