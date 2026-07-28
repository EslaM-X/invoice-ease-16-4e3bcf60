CREATE OR REPLACE FUNCTION public.compute_invoice_delivery_state_v2(_invoice_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  required_total numeric := 0;
  completed_total numeric := 0;
  active_total numeric := 0;
  aggregate_signed_total numeric := 0;
  aggregate_active_total numeric := 0;
  item_required numeric := 0;
  item_completed numeric := 0;
  item_active numeric := 0;
  completed_full numeric := 0;
  completed_mixer numeric := 0;
  completed_trim numeric := 0;
  completed_untagged numeric := 0;
  active_full numeric := 0;
  active_mixer numeric := 0;
  active_trim numeric := 0;
  active_untagged numeric := 0;
  new_state text := 'pending';
  inv_status text;
  inv_notes text;
  inv_paid numeric := 0;
  inv_total_amount numeric := 0;
  is_company_pickup boolean := false;
  has_part_markers boolean := false;
  item_rec record;
BEGIN
  SELECT status, COALESCE(notes, ''), COALESCE(paid_amount, 0), COALESCE(total, 0)
    INTO inv_status, inv_notes, inv_paid, inv_total_amount
  FROM public.invoices
  WHERE id = _invoice_id;

  IF inv_status IS NULL THEN
    RETURN NULL;
  END IF;

  IF inv_status IN ('draft','voided') THEN
    UPDATE public.invoices
       SET delivery_computed_state = 'na',
           delivery_completed_at = NULL
     WHERE id = _invoice_id;
    RETURN 'na';
  END IF;

  is_company_pickup := inv_paid >= (inv_total_amount - 0.001)
    AND inv_total_amount > 0
    AND (
      inv_notes ILIKE '%الاستلام من الشركة%'
      OR inv_notes ILIKE '%استلام من الشركة%'
      OR inv_notes ILIKE '%pickup from company%'
      OR inv_notes ILIKE '%pick up from company%'
      OR inv_notes ILIKE '%customer pickup%'
    );

  SELECT EXISTS (
    SELECT 1
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    WHERE dr.invoice_id = _invoice_id
      AND COALESCE(dri.note, '') ~* '\[PART:(mixer|trim)\]'
  ) INTO has_part_markers;

  FOR item_rec IN
    SELECT id, product_name, serial_number, color, COALESCE(quantity, 0)::numeric AS quantity
    FROM public.invoice_items
    WHERE invoice_id = _invoice_id
      AND product_id IS NOT NULL
      AND COALESCE(quantity, 0) > 0
  LOOP
    item_required := item_rec.quantity;
    required_total := required_total + item_required;

    IF COALESCE(item_rec.product_name, '') ~* '(WALL\s*MOUNTED\s*TWO\s*HOLE\s*BASIN\s*MIXER|CONCEALED\s*SHOWER|SHOWER\s*MIXERS\s*CONCEALED|FREE\s*STANDING\s*BATH\s*MIXER|BATH\s*MIXERS\s*FREE\s*STANDING)' THEN
      SELECT
        COALESCE(SUM(CASE WHEN COALESCE(dri.note, '') ~* '\[PART:full\]' THEN COALESCE(dri.quantity, 0) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN COALESCE(dri.note, '') ~* '\[PART:mixer\]' THEN COALESCE(dri.quantity, 0) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN COALESCE(dri.note, '') ~* '\[PART:trim\]' THEN COALESCE(dri.quantity, 0) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN COALESCE(dri.note, '') !~* '\[PART:(full|mixer|trim)\]' THEN COALESCE(dri.quantity, 0) ELSE 0 END), 0)
      INTO completed_full, completed_mixer, completed_trim, completed_untagged
      FROM public.delivery_receipt_items dri
      JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
      WHERE dr.invoice_id = _invoice_id
        AND dr.status IN ('signed', 'paid')
        AND (
          dri.invoice_item_id = item_rec.id
          OR (
            dri.invoice_item_id IS NULL
            AND regexp_replace(lower(trim(COALESCE(dri.product_name, ''))), '\s+', ' ', 'g') = regexp_replace(lower(trim(COALESCE(item_rec.product_name, ''))), '\s+', ' ', 'g')
            AND (
              regexp_replace(lower(trim(COALESCE(dri.serial_number, ''))), '[\s_\-./]+', '', 'g') = ''
              OR regexp_replace(lower(trim(COALESCE(dri.serial_number, ''))), '[\s_\-./]+', '', 'g') = regexp_replace(lower(trim(COALESCE(item_rec.serial_number, ''))), '[\s_\-./]+', '', 'g')
            )
            AND (
              regexp_replace(lower(trim(COALESCE(dri.color, ''))), '\s+', ' ', 'g') = ''
              OR regexp_replace(lower(trim(COALESCE(dri.color, ''))), '\s+', ' ', 'g') = regexp_replace(lower(trim(COALESCE(item_rec.color, ''))), '\s+', ' ', 'g')
            )
          )
        );

      SELECT
        COALESCE(SUM(CASE WHEN COALESCE(dri.note, '') ~* '\[PART:full\]' THEN COALESCE(dri.quantity, 0) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN COALESCE(dri.note, '') ~* '\[PART:mixer\]' THEN COALESCE(dri.quantity, 0) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN COALESCE(dri.note, '') ~* '\[PART:trim\]' THEN COALESCE(dri.quantity, 0) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN COALESCE(dri.note, '') !~* '\[PART:(full|mixer|trim)\]' THEN COALESCE(dri.quantity, 0) ELSE 0 END), 0)
      INTO active_full, active_mixer, active_trim, active_untagged
      FROM public.delivery_receipt_items dri
      JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
      WHERE dr.invoice_id = _invoice_id
        AND dr.status IN ('out_for_delivery', 'signed', 'paid')
        AND (
          dri.invoice_item_id = item_rec.id
          OR (
            dri.invoice_item_id IS NULL
            AND regexp_replace(lower(trim(COALESCE(dri.product_name, ''))), '\s+', ' ', 'g') = regexp_replace(lower(trim(COALESCE(item_rec.product_name, ''))), '\s+', ' ', 'g')
            AND (
              regexp_replace(lower(trim(COALESCE(dri.serial_number, ''))), '[\s_\-./]+', '', 'g') = ''
              OR regexp_replace(lower(trim(COALESCE(dri.serial_number, ''))), '[\s_\-./]+', '', 'g') = regexp_replace(lower(trim(COALESCE(item_rec.serial_number, ''))), '[\s_\-./]+', '', 'g')
            )
            AND (
              regexp_replace(lower(trim(COALESCE(dri.color, ''))), '\s+', ' ', 'g') = ''
              OR regexp_replace(lower(trim(COALESCE(dri.color, ''))), '\s+', ' ', 'g') = regexp_replace(lower(trim(COALESCE(item_rec.color, ''))), '\s+', ' ', 'g')
            )
          )
        );

      item_completed := LEAST(item_required, GREATEST(0, completed_full + completed_untagged + LEAST(completed_mixer, completed_trim)));
      item_active := LEAST(item_required, GREATEST(0, active_full + active_untagged + LEAST(active_mixer, active_trim)));
    ELSE
      SELECT COALESCE(SUM(COALESCE(dri.quantity, 0)), 0)
      INTO item_completed
      FROM public.delivery_receipt_items dri
      JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
      WHERE dr.invoice_id = _invoice_id
        AND dr.status IN ('signed', 'paid')
        AND (
          dri.invoice_item_id = item_rec.id
          OR (
            dri.invoice_item_id IS NULL
            AND regexp_replace(lower(trim(COALESCE(dri.product_name, ''))), '\s+', ' ', 'g') = regexp_replace(lower(trim(COALESCE(item_rec.product_name, ''))), '\s+', ' ', 'g')
            AND (
              regexp_replace(lower(trim(COALESCE(dri.serial_number, ''))), '[\s_\-./]+', '', 'g') = ''
              OR regexp_replace(lower(trim(COALESCE(dri.serial_number, ''))), '[\s_\-./]+', '', 'g') = regexp_replace(lower(trim(COALESCE(item_rec.serial_number, ''))), '[\s_\-./]+', '', 'g')
            )
            AND (
              regexp_replace(lower(trim(COALESCE(dri.color, ''))), '\s+', ' ', 'g') = ''
              OR regexp_replace(lower(trim(COALESCE(dri.color, ''))), '\s+', ' ', 'g') = regexp_replace(lower(trim(COALESCE(item_rec.color, ''))), '\s+', ' ', 'g')
            )
          )
        );

      SELECT COALESCE(SUM(COALESCE(dri.quantity, 0)), 0)
      INTO item_active
      FROM public.delivery_receipt_items dri
      JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
      WHERE dr.invoice_id = _invoice_id
        AND dr.status IN ('out_for_delivery', 'signed', 'paid')
        AND (
          dri.invoice_item_id = item_rec.id
          OR (
            dri.invoice_item_id IS NULL
            AND regexp_replace(lower(trim(COALESCE(dri.product_name, ''))), '\s+', ' ', 'g') = regexp_replace(lower(trim(COALESCE(item_rec.product_name, ''))), '\s+', ' ', 'g')
            AND (
              regexp_replace(lower(trim(COALESCE(dri.serial_number, ''))), '[\s_\-./]+', '', 'g') = ''
              OR regexp_replace(lower(trim(COALESCE(dri.serial_number, ''))), '[\s_\-./]+', '', 'g') = regexp_replace(lower(trim(COALESCE(item_rec.serial_number, ''))), '[\s_\-./]+', '', 'g')
            )
            AND (
              regexp_replace(lower(trim(COALESCE(dri.color, ''))), '\s+', ' ', 'g') = ''
              OR regexp_replace(lower(trim(COALESCE(dri.color, ''))), '\s+', ' ', 'g') = regexp_replace(lower(trim(COALESCE(item_rec.color, ''))), '\s+', ' ', 'g')
            )
          )
        );

      item_completed := LEAST(item_required, GREATEST(0, item_completed));
      item_active := LEAST(item_required, GREATEST(0, item_active));
    END IF;

    completed_total := completed_total + item_completed;
    active_total := active_total + item_active;
  END LOOP;

  -- Aggregate fallback is only safe when there are no explicit mixer/trim part markers.
  -- This still covers legacy SKU substitutions without falsely closing split-part deliveries.
  IF required_total > 0 AND NOT has_part_markers THEN
    SELECT COALESCE(SUM(COALESCE(dri.quantity, 0)), 0)
    INTO aggregate_signed_total
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    LEFT JOIN public.invoice_items linked_item ON linked_item.id = dri.invoice_item_id
    WHERE dr.invoice_id = _invoice_id
      AND dr.status IN ('signed', 'paid')
      AND (dri.invoice_item_id IS NULL OR linked_item.product_id IS NOT NULL)
      AND COALESCE(dri.product_name, '') !~* '(رسوم\s*شحن|shipping|delivery\s*fee|transport)';

    SELECT COALESCE(SUM(COALESCE(dri.quantity, 0)), 0)
    INTO aggregate_active_total
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    LEFT JOIN public.invoice_items linked_item ON linked_item.id = dri.invoice_item_id
    WHERE dr.invoice_id = _invoice_id
      AND dr.status IN ('out_for_delivery', 'signed', 'paid')
      AND (dri.invoice_item_id IS NULL OR linked_item.product_id IS NOT NULL)
      AND COALESCE(dri.product_name, '') !~* '(رسوم\s*شحن|shipping|delivery\s*fee|transport)';

    completed_total := GREATEST(completed_total, LEAST(required_total, aggregate_signed_total));
    active_total := GREATEST(active_total, LEAST(required_total, aggregate_active_total));
  END IF;

  IF required_total = 0 THEN
    new_state := 'no_items';
  ELSIF completed_total >= required_total THEN
    new_state := 'complete';
  ELSIF is_company_pickup AND active_total >= required_total THEN
    new_state := 'complete';
  ELSIF active_total >= required_total THEN
    new_state := 'awaiting_signature';
  ELSIF active_total > 0 OR completed_total > 0 THEN
    new_state := 'partial';
  ELSE
    new_state := 'pending';
  END IF;

  UPDATE public.invoices
     SET delivery_computed_state = new_state,
         delivery_completed_at = CASE
           WHEN new_state = 'complete' THEN COALESCE(delivery_completed_at, now())
           ELSE NULL
         END
   WHERE id = _invoice_id
     AND (
       delivery_computed_state IS DISTINCT FROM new_state
       OR (new_state = 'complete' AND delivery_completed_at IS NULL)
       OR (new_state <> 'complete' AND delivery_completed_at IS NOT NULL)
     );

  IF new_state = 'complete' THEN
    UPDATE public.delivery_receipts
       SET archived_at = COALESCE(archived_at, now())
     WHERE invoice_id = _invoice_id
       AND status IN ('out_for_delivery', 'signed', 'paid')
       AND archived_at IS NULL;
  ELSE
    UPDATE public.delivery_receipts
       SET archived_at = NULL
     WHERE invoice_id = _invoice_id
       AND archived_at IS NOT NULL;
  END IF;

  RETURN new_state;
END;
$function$;