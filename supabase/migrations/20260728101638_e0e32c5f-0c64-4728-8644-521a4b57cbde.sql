-- Harden delivery receipt updates so existing items are not removed until the
-- replacement item set has been validated and staged successfully.
CREATE OR REPLACE FUNCTION public.update_delivery_receipt(
  _receipt_id uuid,
  _delivered_to_name text,
  _delivered_to_phone text,
  _delivered_to_id_number text,
  _notes text,
  _manager_name text,
  _accountant_name text,
  _signature_customer text,
  _signature_manager text,
  _signature_accountant text,
  _status text,
  _items jsonb,
  _shipping_fees numeric DEFAULT NULL,
  _tax_enabled boolean DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_receipt record;
  v_item jsonb;
  v_inv_item record;
  v_already int;
  v_qty int;
  v_item_count int := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000';
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'NO_ITEMS';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_receipt
  FROM public.delivery_receipts
  WHERE id = _receipt_id
    AND public.can_access_user_data(user_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.delivery_receipt_items_stage (
    invoice_item_id uuid NOT NULL,
    product_name text NOT NULL,
    serial_number text,
    color text,
    quantity integer NOT NULL,
    note text
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.delivery_receipt_items_stage;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT ii.* INTO v_inv_item
    FROM public.invoice_items ii
    WHERE ii.id = (v_item->>'invoice_item_id')::uuid
      AND ii.invoice_id = v_receipt.invoice_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_INVOICE_ITEM';
    END IF;

    SELECT COALESCE(public.delivery_item_effective_qty(v_inv_item.id, 'strict_full', _receipt_id), 0)
    INTO v_already;

    IF v_already + v_qty > v_inv_item.quantity THEN
      RAISE EXCEPTION 'QUANTITY_EXCEEDED:%', v_inv_item.product_name;
    END IF;

    INSERT INTO pg_temp.delivery_receipt_items_stage (
      invoice_item_id, product_name, serial_number, color, quantity, note
    ) VALUES (
      v_inv_item.id,
      v_inv_item.product_name,
      v_inv_item.serial_number,
      v_inv_item.color,
      v_qty,
      NULLIF(v_item->>'note','')
    );

    v_item_count := v_item_count + 1;
  END LOOP;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'NO_ITEMS';
  END IF;

  UPDATE public.delivery_receipts SET
    delivered_to_name = NULLIF(_delivered_to_name,''),
    delivered_to_phone = NULLIF(_delivered_to_phone,''),
    delivered_to_id_number = NULLIF(_delivered_to_id_number,''),
    notes = NULLIF(_notes,''),
    manager_name = NULLIF(_manager_name,''),
    accountant_name = NULLIF(_accountant_name,''),
    signature_customer = NULLIF(_signature_customer,''),
    signature_manager = NULLIF(_signature_manager,''),
    signature_accountant = NULLIF(_signature_accountant,''),
    status = COALESCE(NULLIF(_status,''), status),
    shipping_fees = _shipping_fees,
    tax_enabled = COALESCE(_tax_enabled, tax_enabled),
    updated_at = now(),
    updated_by = v_user_id,
    updated_by_email = v_email
  WHERE id = _receipt_id;

  DELETE FROM public.delivery_receipt_items
  WHERE receipt_id = _receipt_id;

  INSERT INTO public.delivery_receipt_items (
    receipt_id, invoice_item_id, product_name, serial_number, color, quantity, note
  )
  SELECT _receipt_id, invoice_item_id, product_name, serial_number, color, quantity, note
  FROM pg_temp.delivery_receipt_items_stage;

  PERFORM public.recompute_invoice_delivery_status(v_receipt.invoice_id);
  RETURN _receipt_id;
END;
$$;

-- Replace the effective quantity helper with a status-aware version.
-- Active validation excludes the receipt currently being edited, and ignores
-- cancelled/returned rows so they do not make delivered quantities appear to reset.
CREATE OR REPLACE FUNCTION public.delivery_item_effective_qty(
  _invoice_item_id uuid,
  _mode text,
  _exclude_receipt_id uuid
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
    COALESCE(SUM(CASE WHEN dri.note IS NULL OR btrim(dri.note) = '' OR dri.note ~* '\\[PART:full\\]' THEN dri.quantity ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN dri.note ~* '\\[PART:mixer\\]' THEN dri.quantity ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN dri.note ~* '\\[PART:trim\\]' THEN dri.quantity ELSE 0 END), 0)::int,
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

-- Keep the old two-argument calls working exactly as before.
CREATE OR REPLACE FUNCTION public.delivery_item_effective_qty(
  _invoice_item_id uuid,
  _mode text DEFAULT 'strict_full'::text
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.delivery_item_effective_qty(_invoice_item_id, _mode, NULL::uuid);
$$;

-- One canonical automatic invoice delivery-status engine.
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

  SELECT COALESCE(SUM(public.delivery_item_effective_qty(ii.id, 'strict_full')), 0)
    INTO v_signed_qty
  FROM public.invoice_items ii
  WHERE ii.invoice_id = _invoice_id
    AND ii.product_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.delivery_receipt_items dri
      JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
      WHERE dri.invoice_item_id = ii.id
        AND dr.invoice_id = _invoice_id
        AND dr.status IN ('signed', 'paid')
    );

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

-- Retire the older recalculation entry point by delegating it to the canonical one.
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

-- Make trigger paths call the canonical engine and keep old/new invoice ids correct.
CREATE OR REPLACE FUNCTION public.tg_recalc_delivery_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT invoice_id INTO v_invoice_id FROM public.delivery_receipts WHERE id = OLD.receipt_id;
  ELSE
    SELECT invoice_id INTO v_invoice_id FROM public.delivery_receipts WHERE id = NEW.receipt_id;
  END IF;

  IF v_invoice_id IS NOT NULL THEN
    PERFORM public.recompute_invoice_delivery_status(v_invoice_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_dri_recompute_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT invoice_id INTO v_invoice_id FROM public.delivery_receipts WHERE id = OLD.receipt_id;
  ELSE
    SELECT invoice_id INTO v_invoice_id FROM public.delivery_receipts WHERE id = NEW.receipt_id;
  END IF;

  IF v_invoice_id IS NOT NULL THEN
    PERFORM public.recompute_invoice_delivery_status(v_invoice_id);
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_dr_recompute_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_invoice_delivery_status(OLD.invoice_id);
    RETURN NULL;
  END IF;

  PERFORM public.recompute_invoice_delivery_status(NEW.invoice_id);
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM public.recompute_invoice_delivery_status(OLD.invoice_id);
  END IF;

  RETURN NULL;
END;
$$;

-- Recalculate only affected invoices once with the hardened logic. This does not
-- touch delivery receipts or receipt items.
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