CREATE OR REPLACE FUNCTION public.delivery_item_effective_qty(
  _invoice_item_id uuid,
  _mode text,
  _exclude_receipt_id uuid
)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product_name text;
  v_is_multi boolean := false;
  v_full integer := 0;
  v_mixer integer := 0;
  v_trim integer := 0;
  v_untagged integer := 0;
BEGIN
  SELECT ii.product_name
  INTO v_product_name
  FROM public.invoice_items ii
  WHERE ii.id = _invoice_item_id;

  IF v_product_name IS NULL THEN
    RETURN 0;
  END IF;

  v_is_multi := (
    v_product_name ~* 'WALL\s*MOUNTED\s*TWO\s*HOLE\s*BASIN\s*MIXER'
    OR v_product_name ~* 'CONCEALED\s*SHOWER'
    OR v_product_name ~* 'SHOWER\s*MIXERS\s*CONCEALED'
    OR v_product_name ~* 'FREE\s*STANDING\s*BATH\s*MIXER'
    OR v_product_name ~* 'BATH\s*MIXERS\s*FREE\s*STANDING'
  );

  IF NOT v_is_multi THEN
    RETURN COALESCE((
      SELECT SUM(dri.quantity)::int
      FROM public.delivery_receipt_items dri
      JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
      WHERE dri.invoice_item_id = _invoice_item_id
        AND (_exclude_receipt_id IS NULL OR dri.receipt_id <> _exclude_receipt_id)
        AND dr.status IN ('draft', 'out_for_delivery', 'signed', 'paid')
    ), 0);
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN dri.note ~* '\[PART:full\]' THEN dri.quantity ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN dri.note ~* '\[PART:mixer\]' THEN dri.quantity ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN dri.note ~* '\[PART:trim\]' THEN dri.quantity ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN dri.note IS NULL OR btrim(dri.note) = '' THEN dri.quantity ELSE 0 END), 0)::int
  INTO v_full, v_mixer, v_trim, v_untagged
  FROM public.delivery_receipt_items dri
  JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
  WHERE dri.invoice_item_id = _invoice_item_id
    AND (_exclude_receipt_id IS NULL OR dri.receipt_id <> _exclude_receipt_id)
    AND dr.status IN ('draft', 'out_for_delivery', 'signed', 'paid');

  IF _mode = 'any' THEN
    RETURN v_full + v_untagged + v_mixer + v_trim;
  ELSIF _mode = 'mixer_ok' THEN
    RETURN v_full + v_untagged + v_mixer;
  ELSIF _mode = 'trim_ok' THEN
    RETURN v_full + v_untagged + v_trim;
  ELSE
    RETURN v_full + v_untagged + LEAST(v_mixer, v_trim);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delivery_item_effective_qty(
  _invoice_item_id uuid,
  _mode text DEFAULT 'strict_full'
)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.delivery_item_effective_qty(_invoice_item_id, _mode, NULL::uuid);
$function$;

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
  v_has_activity boolean;
  v_all_items_complete boolean;
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

  IF COALESCE(v_status, '') IN ('voided', 'archived', 'cancelled', 'draft') THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO v_needed
  FROM public.invoice_items
  WHERE invoice_id = _invoice_id
    AND product_id IS NOT NULL;

  WITH per_item_raw AS (
    SELECT
      ii.id,
      ii.product_name,
      ii.quantity,
      COALESCE(SUM(CASE WHEN dr.status IN ('signed', 'paid') THEN dri.quantity ELSE 0 END), 0)::int AS plain_qty,
      COALESCE(SUM(CASE WHEN dr.status IN ('signed', 'paid') AND dri.note ~* '\[PART:full\]' THEN dri.quantity ELSE 0 END), 0)::int AS full_qty,
      COALESCE(SUM(CASE WHEN dr.status IN ('signed', 'paid') AND dri.note ~* '\[PART:mixer\]' THEN dri.quantity ELSE 0 END), 0)::int AS mixer_qty,
      COALESCE(SUM(CASE WHEN dr.status IN ('signed', 'paid') AND dri.note ~* '\[PART:trim\]' THEN dri.quantity ELSE 0 END), 0)::int AS trim_qty,
      COALESCE(SUM(CASE WHEN dr.status IN ('signed', 'paid') AND (dri.note IS NULL OR btrim(dri.note) = '') THEN dri.quantity ELSE 0 END), 0)::int AS untagged_qty
    FROM public.invoice_items ii
    LEFT JOIN public.delivery_receipt_items dri ON dri.invoice_item_id = ii.id
    LEFT JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id AND dr.invoice_id = _invoice_id
    WHERE ii.invoice_id = _invoice_id
      AND ii.product_id IS NOT NULL
    GROUP BY ii.id, ii.product_name, ii.quantity
  ), per_item AS (
    SELECT
      quantity,
      CASE
        WHEN product_name ~* 'WALL\s*MOUNTED\s*TWO\s*HOLE\s*BASIN\s*MIXER'
          OR product_name ~* 'CONCEALED\s*SHOWER'
          OR product_name ~* 'SHOWER\s*MIXERS\s*CONCEALED'
          OR product_name ~* 'FREE\s*STANDING\s*BATH\s*MIXER'
          OR product_name ~* 'BATH\s*MIXERS\s*FREE\s*STANDING'
        THEN full_qty + untagged_qty + LEAST(mixer_qty, trim_qty)
        ELSE plain_qty
      END AS signed_effective_qty
    FROM per_item_raw
  )
  SELECT
    COALESCE(SUM(signed_effective_qty), 0),
    COALESCE(bool_and(signed_effective_qty >= quantity), false)
  INTO v_signed_qty, v_all_items_complete
  FROM per_item;

  SELECT COALESCE(SUM(dri.quantity), 0)
    INTO v_out_qty
  FROM public.delivery_receipt_items dri
  JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
  WHERE dr.invoice_id = _invoice_id
    AND dr.status = 'out_for_delivery';

  v_has_activity := COALESCE(v_signed_qty, 0) > 0 OR COALESCE(v_out_qty, 0) > 0;

  IF v_needed > 0 AND v_all_items_complete THEN
    v_new := 'delivered';
  ELSIF v_has_activity THEN
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

CREATE OR REPLACE FUNCTION public.recalc_invoice_delivery_status(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.recompute_invoice_delivery_status(_invoice_id);
END;
$function$;