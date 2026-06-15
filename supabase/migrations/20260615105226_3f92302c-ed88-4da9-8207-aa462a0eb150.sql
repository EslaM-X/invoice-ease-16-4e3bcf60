
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

  -- CRITICAL: clear ALL shipment codes for this user FIRST so type-changed rows
  -- (e.g. a PO moved from grounded→air) don't keep their old "G1" code and
  -- collide with the next row being assigned "G1" during renumbering.
  UPDATE public.purchase_orders SET shipment_code = NULL WHERE user_id = _user_id;

  FOREACH t IN ARRAY ARRAY['grounded','air','door_to_door'] LOOP
    prefix := CASE t WHEN 'grounded' THEN 'G' WHEN 'air' THEN 'A' ELSE 'D' END;
    seq := 0;

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

  UPDATE public.po_receipts pr
     SET receipt_code = po.shipment_code || '#' || pr.receipt_number::text
    FROM public.purchase_orders po
   WHERE pr.po_id = po.id AND po.user_id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_shipment_codes_for_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_shipment_codes_for_user(uuid) TO authenticated;
