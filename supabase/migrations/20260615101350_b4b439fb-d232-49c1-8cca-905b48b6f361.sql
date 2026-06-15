
-- 1) Add shipment_date column (defaults to created_at; this is the sort key for code numbering)
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS shipment_date timestamptz;
UPDATE public.purchase_orders SET shipment_date = created_at WHERE shipment_date IS NULL;
ALTER TABLE public.purchase_orders ALTER COLUMN shipment_date SET DEFAULT now();
ALTER TABLE public.purchase_orders ALTER COLUMN shipment_date SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_user_type_shipdate ON public.purchase_orders(user_id, shipment_type, shipment_date);

-- 2) Reassign all shipment codes for a user, ordered by shipment_date (Cairo time)
CREATE OR REPLACE FUNCTION public.reassign_shipment_codes_for_user(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  t text;
  seq int;
  prefix text;
BEGIN
  IF NOT (public.is_admin() OR public.has_role(auth.uid(), 'purchasing'::app_role) OR public.has_role(auth.uid(), 'cfo'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOREACH t IN ARRAY ARRAY['grounded','air','door_to_door'] LOOP
    prefix := CASE t WHEN 'grounded' THEN 'G' WHEN 'air' THEN 'A' ELSE 'D' END;
    seq := 0;
    -- Two-step rename to avoid unique violations on (user_id, shipment_code)
    UPDATE public.purchase_orders SET shipment_code = NULL
     WHERE user_id = _user_id AND shipment_type = t;

    FOR r IN
      SELECT id FROM public.purchase_orders
       WHERE user_id = _user_id AND shipment_type = t
       ORDER BY shipment_date AT TIME ZONE 'Africa/Cairo' ASC, created_at ASC, id ASC
    LOOP
      seq := seq + 1;
      UPDATE public.purchase_orders SET shipment_code = prefix || seq::text WHERE id = r.id;
    END LOOP;

    INSERT INTO public.shipment_counters(user_id, shipment_type, last_seq, updated_at)
    VALUES (_user_id, t, seq, now())
    ON CONFLICT (user_id, shipment_type) DO UPDATE SET last_seq = EXCLUDED.last_seq, updated_at = now();
  END LOOP;

  -- Refresh receipt_code on all receipts for this user (G3#1 etc.)
  UPDATE public.po_receipts pr
     SET receipt_code = po.shipment_code || '#' || pr.receipt_number::text
    FROM public.purchase_orders po
   WHERE pr.po_id = po.id AND po.user_id = _user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reassign_shipment_codes_for_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_shipment_codes_for_user(uuid) TO authenticated;

-- 3) Update a PO's shipment type/date and re-number everything for the owner
CREATE OR REPLACE FUNCTION public.update_po_shipment(_po_id uuid, _new_type text, _new_date timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po record;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF _new_type IS NOT NULL AND _new_type NOT IN ('grounded','air','door_to_door') THEN
    RAISE EXCEPTION 'INVALID_SHIPMENT_TYPE' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = _po_id FOR UPDATE;
  IF v_po IS NULL THEN RAISE EXCEPTION 'PO_NOT_FOUND' USING ERRCODE='22023'; END IF;
  IF NOT public.can_access_user_data(v_po.user_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (public.is_admin() OR public.has_role(v_actor, 'purchasing'::app_role) OR public.has_role(v_actor, 'cfo'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  UPDATE public.purchase_orders
     SET shipment_type = COALESCE(_new_type, shipment_type),
         shipment_date = COALESCE(_new_date, shipment_date),
         updated_at = now()
   WHERE id = _po_id;

  PERFORM public.reassign_shipment_codes_for_user(v_po.user_id);

  SELECT shipment_code, shipment_type, shipment_date INTO v_po
    FROM public.purchase_orders WHERE id = _po_id;

  RETURN jsonb_build_object(
    'shipment_code', v_po.shipment_code,
    'shipment_type', v_po.shipment_type,
    'shipment_date', v_po.shipment_date
  );
END;
$$;
REVOKE ALL ON FUNCTION public.update_po_shipment(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_po_shipment(uuid, text, timestamptz) TO authenticated;

-- 4) Record a historical PO receipt (with custom date), optionally applying to inventory
CREATE OR REPLACE FUNCTION public.record_historical_po_receipt(
  _po_id uuid,
  _receipt_date timestamptz,
  _items jsonb,
  _notes text,
  _apply_to_inventory boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po record;
  v_actor uuid := auth.uid();
  v_email text;
  v_receipt_id uuid;
  v_next_no int;
  v_total int := 0;
  v_item jsonb;
  v_qty int;
  v_poi record;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'NO_ITEMS' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = _po_id FOR UPDATE;
  IF v_po IS NULL THEN RAISE EXCEPTION 'PO_NOT_FOUND' USING ERRCODE='22023'; END IF;
  IF NOT public.can_access_user_data(v_po.user_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (public.is_admin() OR public.has_role(v_actor,'purchasing'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_actor;

  SELECT COALESCE(MAX(receipt_number),0) + 1 INTO v_next_no FROM public.po_receipts WHERE po_id = _po_id;

  INSERT INTO public.po_receipts(po_id, user_id, receipt_number, total_qty, notes, actor_id, actor_email, created_at)
  VALUES (_po_id, v_po.user_id, v_next_no, 0, NULLIF(_notes,''), v_actor, v_email, COALESCE(_receipt_date, now()))
  RETURNING id INTO v_receipt_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'received_qty')::int, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_poi FROM public.purchase_order_items
     WHERE id = (v_item->>'item_id')::uuid AND po_id = _po_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PO_ITEM' USING ERRCODE='22023'; END IF;

    INSERT INTO public.po_receipt_items(receipt_id, po_item_id, product_id, product_name, serial_number, color, quantity)
    VALUES (v_receipt_id, v_poi.id, v_poi.product_id, v_poi.product_name, v_poi.serial_number, v_poi.color, v_qty);

    v_total := v_total + v_qty;

    IF _apply_to_inventory THEN
      UPDATE public.products SET stock_quantity = stock_quantity + v_qty, updated_at = now()
       WHERE id = v_poi.product_id;
      INSERT INTO public.inventory_logs(user_id, product_id, change, reason, actor_id, actor_email)
      VALUES (v_po.user_id, v_poi.product_id, v_qty,
              'historical PO ' || COALESCE(v_po.shipment_code, v_po.po_number) || ' #' || v_next_no,
              v_actor, v_email);
    END IF;
  END LOOP;

  UPDATE public.po_receipts SET total_qty = v_total WHERE id = v_receipt_id;
  RETURN v_receipt_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_historical_po_receipt(uuid, timestamptz, jsonb, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_historical_po_receipt(uuid, timestamptz, jsonb, text, boolean) TO authenticated;

-- 5) Manual stock reconciliation (admin only)
CREATE OR REPLACE FUNCTION public.manual_reconcile_stock(_product_id uuid, _new_qty int, _reason text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_product record;
  v_diff int;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _new_qty < 0 THEN RAISE EXCEPTION 'INVALID_QTY' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_product FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE='22023'; END IF;
  IF NOT public.can_access_user_data(v_product.user_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  v_diff := _new_qty - v_product.stock_quantity;

  UPDATE public.products SET stock_quantity = _new_qty, updated_at = now() WHERE id = _product_id;

  INSERT INTO public.inventory_logs(user_id, product_id, change, reason, actor_id, actor_email)
  VALUES (v_product.user_id, _product_id, v_diff,
          'manual-reconcile: ' || COALESCE(NULLIF(_reason,''),'(no reason)'),
          v_actor, v_email);

  RETURN _new_qty;
END;
$$;
REVOKE ALL ON FUNCTION public.manual_reconcile_stock(uuid, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manual_reconcile_stock(uuid, int, text) TO authenticated;
