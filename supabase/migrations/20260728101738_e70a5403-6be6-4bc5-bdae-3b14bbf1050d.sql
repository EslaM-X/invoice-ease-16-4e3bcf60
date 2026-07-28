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
  IF _invoice_id IS NULL THEN
    RETURN;
  END IF;

  SELECT status, delivery_status, COALESCE(delivery_status_override, false)
    INTO v_status, v_delivery, v_override
  FROM public.invoices
  WHERE id = _invoice_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_override THEN
    RETURN;
  END IF;

  IF COALESCE(v_status, '') IN ('voided', 'archived', 'cancelled') THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO v_needed
  FROM public.invoice_items
  WHERE invoice_id = _invoice_id
    AND product_id IS NOT NULL;

  WITH per_item AS (
    SELECT
      ii.id,
      ii.product_name,
      COALESCE(SUM(CASE WHEN dr.status IN ('signed', 'paid') THEN dri.quantity ELSE 0 END), 0)::int AS plain_qty,
      COALESCE(SUM(CASE WHEN dr.status IN ('signed', 'paid') AND (dri.note IS NULL OR btrim(dri.note) = '' OR dri.note ~* '\\[PART:full\\]') THEN dri.quantity ELSE 0 END), 0)::int AS full_qty,
      COALESCE(SUM(CASE WHEN dr.status IN ('signed', 'paid') AND dri.note ~* '\\[PART:mixer\\]' THEN dri.quantity ELSE 0 END), 0)::int AS mixer_qty,
      COALESCE(SUM(CASE WHEN dr.status IN ('signed', 'paid') AND dri.note ~* '\\[PART:trim\\]' THEN dri.quantity ELSE 0 END), 0)::int AS trim_qty
    FROM public.invoice_items ii
    LEFT JOIN public.delivery_receipt_items dri ON dri.invoice_item_id = ii.id
    LEFT JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id AND dr.invoice_id = _invoice_id
    WHERE ii.invoice_id = _invoice_id
      AND ii.product_id IS NOT NULL
    GROUP BY ii.id, ii.product_name
  )
  SELECT COALESCE(SUM(
    CASE
      WHEN product_name ~* 'WALL\s*MOUNTED\s*TWO\s*HOLE\s*BASIN\s*MIXER'
        OR product_name ~* 'CONCEALED\s*SHOWER'
        OR product_name ~* 'SHOWER\s*MIXERS\s*CONCEALED'
        OR product_name ~* 'FREE\s*STANDING\s*BATH\s*MIXER'
        OR product_name ~* 'BATH\s*MIXERS\s*FREE\s*STANDING'
      THEN full_qty + LEAST(mixer_qty, trim_qty)
      ELSE plain_qty
    END
  ), 0)
  INTO v_signed_qty
  FROM per_item;

  SELECT
    COALESCE(SUM(dri.quantity), 0),
    COALESCE(bool_or(true), false)
    INTO v_out_qty, v_has_out_for_delivery
  FROM public.delivery_receipt_items dri
  JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
  WHERE dr.invoice_id = _invoice_id
    AND dr.status = 'out_for_delivery';

  IF v_needed > 0 AND v_signed_qty >= v_needed THEN
    v_new := 'delivered';
  ELSIF v_signed_qty > 0 OR v_out_qty > 0 OR v_has_out_for_delivery THEN
    v_new := 'in_transit';
  ELSE
    v_new := 'pending';
  END IF;

  IF v_new IS DISTINCT FROM COALESCE(v_delivery, 'pending') THEN
    UPDATE public.invoices
    SET delivery_status = v_new
    WHERE id = _invoice_id
      AND COALESCE(delivery_status_override, false) = false;
  END IF;
END;
$function$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT dr.invoice_id
    FROM public.delivery_receipts dr
    JOIN public.invoices i ON i.id = dr.invoice_id
    WHERE COALESCE(i.status, '') NOT IN ('voided', 'archived', 'cancelled')
      AND COALESCE(i.delivery_status_override, false) = false
  LOOP
    PERFORM public.recompute_invoice_delivery_status(r.invoice_id);
  END LOOP;
END $$;