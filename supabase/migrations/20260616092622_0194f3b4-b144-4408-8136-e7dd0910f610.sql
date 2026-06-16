CREATE OR REPLACE FUNCTION public.reassign_po_numbers_by_shipment_date()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row record;
  v_year int;
  v_counter int := 0;
  v_prev_year int := -1;
  v_new_no text;
  v_updated int := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.is_admin() OR public.has_role(v_actor, 'purchasing'::public.app_role) OR public.has_role(v_actor, 'cfo'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.purchase_orders
     SET po_number = '__tmp__' || id::text
   WHERE po_number IS NOT NULL;

  FOR v_row IN
    SELECT id, COALESCE(shipment_date, created_at) AS sort_dt, created_at
      FROM public.purchase_orders
     ORDER BY (COALESCE(shipment_date, created_at) AT TIME ZONE 'Africa/Cairo') ASC,
              created_at ASC,
              id ASC
  LOOP
    v_year := EXTRACT(YEAR FROM (v_row.sort_dt AT TIME ZONE 'Africa/Cairo'))::int;
    IF v_year <> v_prev_year THEN
      v_counter := 1;
      v_prev_year := v_year;
    ELSE
      v_counter := v_counter + 1;
    END IF;

    v_new_no := 'PO-' || v_year || '-' || lpad(v_counter::text, 4, '0');
    UPDATE public.purchase_orders
       SET po_number = v_new_no,
           updated_at = now()
     WHERE id = v_row.id;
    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_po_numbers_by_shipment_date() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_po_numbers_by_shipment_date() TO authenticated;

CREATE OR REPLACE FUNCTION public.renumber_purchase_orders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden: admin only' USING ERRCODE = '42501'; END IF;
  RETURN public.reassign_po_numbers_by_shipment_date();
END;
$$;

REVOKE ALL ON FUNCTION public.renumber_purchase_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renumber_purchase_orders() TO authenticated;

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
  v_old_po_number text;
  v_new record;
  v_note text;
  v_renumber jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF _new_type IS NOT NULL AND _new_type NOT IN ('grounded','air','door_to_door') THEN
    RAISE EXCEPTION 'INVALID_SHIPMENT_TYPE' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = _po_id FOR UPDATE;
  IF v_po IS NULL THEN RAISE EXCEPTION 'PO_NOT_FOUND' USING ERRCODE='22023'; END IF;
  IF NOT public.can_access_user_data(v_po.user_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (public.is_admin() OR public.has_role(v_actor, 'purchasing'::public.app_role) OR public.has_role(v_actor, 'cfo'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  v_old_type := v_po.shipment_type;
  v_old_code := v_po.shipment_code;
  v_old_date := v_po.shipment_date;
  v_old_po_number := v_po.po_number;

  UPDATE public.purchase_orders
     SET shipment_type = COALESCE(_new_type, shipment_type),
         shipment_date = COALESCE(_new_date, shipment_date),
         updated_at = now()
   WHERE id = _po_id;

  PERFORM public.reassign_shipment_codes_for_user(v_po.user_id);
  v_renumber := public.reassign_po_numbers_by_shipment_date();

  SELECT po_number, shipment_code, shipment_type, shipment_date INTO v_new
    FROM public.purchase_orders WHERE id = _po_id;

  IF v_old_type IS DISTINCT FROM v_new.shipment_type
     OR v_old_code IS DISTINCT FROM v_new.shipment_code
     OR v_old_date IS DISTINCT FROM v_new.shipment_date
     OR v_old_po_number IS DISTINCT FROM v_new.po_number THEN
    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor;
    v_note := format(
      '[SHIPMENT_EDIT] type: %s → %s · code: %s → %s · PO: %s → %s · date: %s → %s',
      COALESCE(v_old_type,'—'), COALESCE(v_new.shipment_type,'—'),
      COALESCE(v_old_code,'—'), COALESCE(v_new.shipment_code,'—'),
      COALESCE(v_old_po_number,'—'), COALESCE(v_new.po_number,'—'),
      COALESCE(to_char(v_old_date AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI'),'—'),
      COALESCE(to_char(v_new.shipment_date AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI'),'—')
    );
    INSERT INTO public.po_status_history(po_id, from_status, to_status, note, actor_id, actor_email)
    VALUES (_po_id, v_po.status, v_po.status, v_note, v_actor, v_actor_email);
  END IF;

  RETURN jsonb_build_object(
    'po_number', v_new.po_number,
    'shipment_code', v_new.shipment_code,
    'shipment_type', v_new.shipment_type,
    'shipment_date', v_new.shipment_date,
    'renumbered', COALESCE(v_renumber->>'updated', '0')::int
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_po_shipment(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_po_shipment(uuid, text, timestamptz) TO authenticated;