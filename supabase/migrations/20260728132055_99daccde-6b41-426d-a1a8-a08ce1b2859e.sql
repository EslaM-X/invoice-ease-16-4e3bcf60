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
  unmatched_signed_pool numeric := 0;
  unmatched_active_pool numeric := 0;
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
  is_fully_paid boolean := false;
  has_part_markers boolean := false;
  item_is_multi boolean := false;
  item_short_completed numeric := 0;
  item_short_active numeric := 0;
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

  is_fully_paid := inv_total_amount > 0 AND inv_paid >= (inv_total_amount - 0.001);

  is_company_pickup := is_fully_paid
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

  SELECT COALESCE(SUM(COALESCE(dri.quantity, 0)), 0)
  INTO unmatched_signed_pool
  FROM public.delivery_receipt_items dri
  JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
  WHERE dr.invoice_id = _invoice_id
    AND dr.status IN ('signed', 'paid')
    AND dri.invoice_item_id IS NULL
    AND COALESCE(dri.note, '') !~* '\[PART:(full|mixer|trim)\]'
    AND COALESCE(dri.product_name, '') !~* '(رسوم\s*شحن|shipping|delivery\s*fee|transport)'
    AND NOT EXISTS (
      SELECT 1
      FROM public.invoice_items ii
      WHERE ii.invoice_id = _invoice_id
        AND ii.product_id IS NOT NULL
        AND COALESCE(ii.quantity, 0) > 0
        AND public.normalize_delivery_match_text(dri.product_name) = public.normalize_delivery_match_text(ii.product_name)
        AND (
          public.normalize_delivery_match_serial(dri.serial_number) = ''
          OR public.normalize_delivery_match_serial(dri.serial_number) = public.normalize_delivery_match_serial(ii.serial_number)
        )
        AND (
          public.normalize_delivery_match_text(dri.color) = ''
          OR public.normalize_delivery_match_text(dri.color) = public.normalize_delivery_match_text(ii.color)
        )
    );

  SELECT COALESCE(SUM(COALESCE(dri.quantity, 0)), 0)
  INTO unmatched_active_pool
  FROM public.delivery_receipt_items dri
  JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
  WHERE dr.invoice_id = _invoice_id
    AND dr.status IN ('out_for_delivery', 'signed', 'paid')
    AND dri.invoice_item_id IS NULL
    AND COALESCE(dri.note, '') !~* '\[PART:(full|mixer|trim)\]'
    AND COALESCE(dri.product_name, '') !~* '(رسوم\s*شحن|shipping|delivery\s*fee|transport)'
    AND NOT EXISTS (
      SELECT 1
      FROM public.invoice_items ii
      WHERE ii.invoice_id = _invoice_id
        AND ii.product_id IS NOT NULL
        AND COALESCE(ii.quantity, 0) > 0
        AND public.normalize_delivery_match_text(dri.product_name) = public.normalize_delivery_match_text(ii.product_name)
        AND (
          public.normalize_delivery_match_serial(dri.serial_number) = ''
          OR public.normalize_delivery_match_serial(dri.serial_number) = public.normalize_delivery_match_serial(ii.serial_number)
        )
        AND (
          public.normalize_delivery_match_text(dri.color) = ''
          OR public.normalize_delivery_match_text(dri.color) = public.normalize_delivery_match_text(ii.color)
        )
    );

  FOR item_rec IN
    SELECT id, product_name, serial_number, color, COALESCE(quantity, 0)::numeric AS quantity
    FROM public.invoice_items
    WHERE invoice_id = _invoice_id
      AND product_id IS NOT NULL
      AND COALESCE(quantity, 0) > 0
  LOOP
    item_required := item_rec.quantity;
    required_total := required_total + item_required;
    item_is_multi := COALESCE(item_rec.product_name, '') ~* '(WALL\s*MOUNTED\s*TWO\s*HOLE\s*BASIN\s*MIXER|CONCEALED\s*SHOWER|SHOWER\s*MIXERS\s*CONCEALED|FREE\s*STANDING\s*BATH\s*MIXER|BATH\s*MIXERS\s*FREE\s*STANDING)';

    IF item_is_multi THEN
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
            AND public.normalize_delivery_match_text(dri.product_name) = public.normalize_delivery_match_text(item_rec.product_name)
            AND (
              public.normalize_delivery_match_serial(dri.serial_number) = ''
              OR public.normalize_delivery_match_serial(dri.serial_number) = public.normalize_delivery_match_serial(item_rec.serial_number)
            )
            AND (
              public.normalize_delivery_match_text(dri.color) = ''
              OR public.normalize_delivery_match_text(dri.color) = public.normalize_delivery_match_text(item_rec.color)
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
            AND public.normalize_delivery_match_text(dri.product_name) = public.normalize_delivery_match_text(item_rec.product_name)
            AND (
              public.normalize_delivery_match_serial(dri.serial_number) = ''
              OR public.normalize_delivery_match_serial(dri.serial_number) = public.normalize_delivery_match_serial(item_rec.serial_number)
            )
            AND (
              public.normalize_delivery_match_text(dri.color) = ''
              OR public.normalize_delivery_match_text(dri.color) = public.normalize_delivery_match_text(item_rec.color)
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
            AND public.normalize_delivery_match_text(dri.product_name) = public.normalize_delivery_match_text(item_rec.product_name)
            AND (
              public.normalize_delivery_match_serial(dri.serial_number) = ''
              OR public.normalize_delivery_match_serial(dri.serial_number) = public.normalize_delivery_match_serial(item_rec.serial_number)
            )
            AND (
              public.normalize_delivery_match_text(dri.color) = ''
              OR public.normalize_delivery_match_text(dri.color) = public.normalize_delivery_match_text(item_rec.color)
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
            AND public.normalize_delivery_match_text(dri.product_name) = public.normalize_delivery_match_text(item_rec.product_name)
            AND (
              public.normalize_delivery_match_serial(dri.serial_number) = ''
              OR public.normalize_delivery_match_serial(dri.serial_number) = public.normalize_delivery_match_serial(item_rec.serial_number)
            )
            AND (
              public.normalize_delivery_match_text(dri.color) = ''
              OR public.normalize_delivery_match_text(dri.color) = public.normalize_delivery_match_text(item_rec.color)
            )
          )
        );

      item_completed := LEAST(item_required, GREATEST(0, item_completed));
      item_active := LEAST(item_required, GREATEST(0, item_active));

      IF item_completed < item_required AND unmatched_signed_pool > 0 THEN
        item_short_completed := LEAST(item_required - item_completed, unmatched_signed_pool);
        item_completed := item_completed + item_short_completed;
        unmatched_signed_pool := unmatched_signed_pool - item_short_completed;
      END IF;

      IF item_active < item_required AND unmatched_active_pool > 0 THEN
        item_short_active := LEAST(item_required - item_active, unmatched_active_pool);
        item_active := item_active + item_short_active;
        unmatched_active_pool := unmatched_active_pool - item_short_active;
      END IF;
    END IF;

    completed_total := completed_total + item_completed;
    active_total := active_total + item_active;
  END LOOP;

  -- Aggregate fallback: when total signed quantity across matched-to-product lines covers the required total.
  -- Previously skipped whenever PART markers existed; now also allowed when the invoice is fully paid,
  -- so paid + fully-signed invoices with a stray missing PART tag still close automatically.
  IF required_total > 0 AND (NOT has_part_markers OR is_fully_paid) THEN
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
         delivery_completed_at = CASE WHEN new_state = 'complete' THEN COALESCE(delivery_completed_at, now()) ELSE NULL END,
         delivery_status = CASE WHEN new_state = 'complete' THEN 'delivered' ELSE delivery_status END
   WHERE id = _invoice_id;

  IF new_state = 'complete' THEN
    UPDATE public.delivery_receipts
       SET archived_at = COALESCE(archived_at, now())
     WHERE invoice_id = _invoice_id
       AND status IN ('signed', 'paid')
       AND archived_at IS NULL;
  END IF;

  RETURN new_state;
END;
$function$;

-- Recompute for all live invoices so previously-reopened ones snap back to the archive.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.invoices WHERE status NOT IN ('draft','voided') LOOP
    PERFORM public.compute_invoice_delivery_state_v2(r.id);
  END LOOP;
END $$;