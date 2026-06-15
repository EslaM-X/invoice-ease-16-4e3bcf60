
-- 1) Realtime publication for receipt + history tables
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.po_status_history; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.po_receipts; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.po_receipt_items; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

ALTER TABLE public.po_status_history REPLICA IDENTITY FULL;
ALTER TABLE public.po_receipts REPLICA IDENTITY FULL;
ALTER TABLE public.po_receipt_items REPLICA IDENTITY FULL;

-- 2) Log shipment reclassification in po_status_history
CREATE OR REPLACE FUNCTION public.update_po_shipment(_po_id uuid, _new_type text, _new_date timestamp with time zone)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_po record;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_old_type text;
  v_old_code text;
  v_old_date timestamptz;
  v_new record;
  v_note text;
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

  v_old_type := v_po.shipment_type;
  v_old_code := v_po.shipment_code;
  v_old_date := v_po.shipment_date;

  UPDATE public.purchase_orders
     SET shipment_type = COALESCE(_new_type, shipment_type),
         shipment_date = COALESCE(_new_date, shipment_date),
         updated_at = now()
   WHERE id = _po_id;

  PERFORM public.reassign_shipment_codes_for_user(v_po.user_id);

  SELECT shipment_code, shipment_type, shipment_date INTO v_new
    FROM public.purchase_orders WHERE id = _po_id;

  IF v_old_type IS DISTINCT FROM v_new.shipment_type
     OR v_old_code IS DISTINCT FROM v_new.shipment_code
     OR v_old_date IS DISTINCT FROM v_new.shipment_date THEN
    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor;
    v_note := format(
      '[SHIPMENT_EDIT] type: %s → %s · code: %s → %s · date: %s → %s',
      COALESCE(v_old_type,'—'), COALESCE(v_new.shipment_type,'—'),
      COALESCE(v_old_code,'—'), COALESCE(v_new.shipment_code,'—'),
      COALESCE(to_char(v_old_date AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI'),'—'),
      COALESCE(to_char(v_new.shipment_date AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI'),'—')
    );
    INSERT INTO public.po_status_history(po_id, from_status, to_status, note, actor_id, actor_email)
    VALUES (_po_id, v_po.status, v_po.status, v_note, v_actor, v_actor_email);
  END IF;

  RETURN jsonb_build_object(
    'shipment_code', v_new.shipment_code,
    'shipment_type', v_new.shipment_type,
    'shipment_date', v_new.shipment_date
  );
END;
$function$;

-- 3) Log historical receipts in po_status_history
CREATE OR REPLACE FUNCTION public.record_historical_po_receipt(_po_id uuid, _receipt_date timestamp with time zone, _items jsonb, _notes text, _apply_to_inventory boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_po record;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_receipt_id uuid;
  v_total numeric := 0;
  v_next_num int;
  v_code text;
  v_item record;
  v_existing record;
  v_stock_before numeric;
  v_stock_after numeric;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = _po_id FOR UPDATE;
  IF v_po IS NULL THEN RAISE EXCEPTION 'PO_NOT_FOUND' USING ERRCODE='22023'; END IF;
  IF NOT public.can_access_user_data(v_po.user_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (public.is_admin() OR public.has_role(v_actor, 'purchasing'::app_role) OR public.has_role(v_actor, 'cfo'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _receipt_date IS NULL THEN RAISE EXCEPTION 'RECEIPT_DATE_REQUIRED' USING ERRCODE='22023'; END IF;
  IF _receipt_date > now() + interval '1 day' THEN
    RAISE EXCEPTION 'FUTURE_DATE_NOT_ALLOWED' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_ITEMS' USING ERRCODE='22023';
  END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor;

  SELECT COALESCE(MAX(receipt_number),0)+1 INTO v_next_num FROM public.po_receipts WHERE po_id = _po_id;
  v_code := COALESCE(v_po.shipment_code, v_po.po_number) || '#' || v_next_num::text;

  INSERT INTO public.po_receipts(po_id, receipt_number, receipt_code, total_qty, notes, actor_id, actor_email, created_at)
  VALUES (_po_id, v_next_num, v_code, 0, NULLIF(trim(_notes), ''), v_actor, v_actor_email, _receipt_date)
  RETURNING id INTO v_receipt_id;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(item_id uuid, received_qty numeric) LOOP
    IF v_item.received_qty IS NULL OR v_item.received_qty <= 0 THEN CONTINUE; END IF;
    SELECT * INTO v_existing FROM public.purchase_order_items WHERE id = v_item.item_id AND po_id = _po_id FOR UPDATE;
    IF v_existing IS NULL THEN RAISE EXCEPTION 'INVALID_ITEM %', v_item.item_id USING ERRCODE='22023'; END IF;
    IF (v_existing.received_qty + v_item.received_qty) > v_existing.quantity THEN
      RAISE EXCEPTION 'QTY_EXCEEDS_REMAINING' USING ERRCODE='22023';
    END IF;

    SELECT stock_quantity INTO v_stock_before FROM public.products WHERE id = v_existing.product_id;
    v_stock_after := v_stock_before;
    IF _apply_to_inventory THEN
      UPDATE public.products SET stock_quantity = stock_quantity + v_item.received_qty WHERE id = v_existing.product_id;
      v_stock_after := v_stock_before + v_item.received_qty;
    END IF;

    UPDATE public.purchase_order_items SET received_qty = received_qty + v_item.received_qty WHERE id = v_item.item_id;
    INSERT INTO public.po_receipt_items(receipt_id, po_item_id, product_id, product_name, serial_number, color, quantity, stock_before, stock_after)
    VALUES (v_receipt_id, v_item.item_id, v_existing.product_id, v_existing.product_name, v_existing.serial_number, v_existing.color, v_item.received_qty, v_stock_before, v_stock_after);
    v_total := v_total + v_item.received_qty;
  END LOOP;

  UPDATE public.po_receipts SET total_qty = v_total WHERE id = v_receipt_id;

  INSERT INTO public.po_status_history(po_id, from_status, to_status, note, actor_id, actor_email, created_at)
  VALUES (
    _po_id, v_po.status, v_po.status,
    format('[HISTORICAL_RECEIPT] %s · qty %s · date %s · inventory %s%s',
      v_code, v_total,
      to_char(_receipt_date AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI'),
      CASE WHEN _apply_to_inventory THEN 'applied' ELSE 'skipped' END,
      CASE WHEN NULLIF(trim(_notes),'') IS NOT NULL THEN ' · '||trim(_notes) ELSE '' END
    ),
    v_actor, v_actor_email, now()
  );

  RETURN v_receipt_id;
END;
$function$;
