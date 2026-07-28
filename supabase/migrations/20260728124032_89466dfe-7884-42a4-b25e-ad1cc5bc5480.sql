CREATE OR REPLACE FUNCTION public.normalize_delivery_match_text(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(regexp_replace(btrim(coalesce(_value, '')), '\s+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.normalize_delivery_match_serial(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(regexp_replace(btrim(coalesce(_value, '')), '[\s_./-]+', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.resolve_delivery_receipt_item_invoice_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id uuid;
  v_match_id uuid;
  v_match_count integer;
BEGIN
  IF NEW.invoice_item_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT dr.invoice_id INTO v_invoice_id
  FROM public.delivery_receipts dr
  WHERE dr.id = NEW.receipt_id;

  IF v_invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT (array_agg(ii.id ORDER BY ii.id::text))[1], count(*)
  INTO v_match_id, v_match_count
  FROM public.invoice_items ii
  WHERE ii.invoice_id = v_invoice_id
    AND public.normalize_delivery_match_text(ii.product_name) = public.normalize_delivery_match_text(NEW.product_name)
    AND (
      nullif(public.normalize_delivery_match_serial(NEW.serial_number), '') IS NULL
      OR public.normalize_delivery_match_serial(ii.serial_number) = public.normalize_delivery_match_serial(NEW.serial_number)
    )
    AND (
      nullif(public.normalize_delivery_match_text(NEW.color), '') IS NULL
      OR public.normalize_delivery_match_text(ii.color) = public.normalize_delivery_match_text(NEW.color)
    );

  IF v_match_count = 1 THEN
    NEW.invoice_item_id := v_match_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resolve_delivery_receipt_item_invoice_item_before_write ON public.delivery_receipt_items;
CREATE TRIGGER resolve_delivery_receipt_item_invoice_item_before_write
BEFORE INSERT OR UPDATE OF receipt_id, invoice_item_id, product_name, serial_number, color
ON public.delivery_receipt_items
FOR EACH ROW
EXECUTE FUNCTION public.resolve_delivery_receipt_item_invoice_item();

WITH candidates AS (
  SELECT
    dri.id AS delivery_receipt_item_id,
    (array_agg(ii.id ORDER BY ii.id::text))[1] AS invoice_item_id,
    count(*) AS match_count
  FROM public.delivery_receipt_items dri
  JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
  JOIN public.invoice_items ii ON ii.invoice_id = dr.invoice_id
  WHERE dri.invoice_item_id IS NULL
    AND public.normalize_delivery_match_text(ii.product_name) = public.normalize_delivery_match_text(dri.product_name)
    AND (
      nullif(public.normalize_delivery_match_serial(dri.serial_number), '') IS NULL
      OR public.normalize_delivery_match_serial(ii.serial_number) = public.normalize_delivery_match_serial(dri.serial_number)
    )
    AND (
      nullif(public.normalize_delivery_match_text(dri.color), '') IS NULL
      OR public.normalize_delivery_match_text(ii.color) = public.normalize_delivery_match_text(dri.color)
    )
  GROUP BY dri.id
)
UPDATE public.delivery_receipt_items dri
SET invoice_item_id = candidates.invoice_item_id
FROM candidates
WHERE dri.id = candidates.delivery_receipt_item_id
  AND candidates.match_count = 1
  AND dri.invoice_item_id IS NULL;