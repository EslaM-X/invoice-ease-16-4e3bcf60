
-- 1) Global (company-wide) reassign by shipment_date, per shipment_type
CREATE OR REPLACE FUNCTION public.reassign_shipment_codes_global()
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
    UPDATE public.purchase_orders
       SET shipment_code = '__tmp__' || id::text
     WHERE shipment_type = t;

    FOR r IN
      SELECT id, user_id FROM public.purchase_orders
       WHERE shipment_type = t
       ORDER BY COALESCE(shipment_date, created_at) AT TIME ZONE 'Africa/Cairo' ASC,
                created_at ASC,
                id ASC
    LOOP
      seq := seq + 1;
      UPDATE public.purchase_orders
         SET shipment_code = prefix || seq::text
       WHERE id = r.id;
    END LOOP;

    -- Reflect global counter on every user's row so future per-user inserts still get correct seq
    INSERT INTO public.shipment_counters(user_id, shipment_type, last_seq, updated_at)
    SELECT DISTINCT user_id, t, seq, now() FROM public.purchase_orders WHERE shipment_type = t
    ON CONFLICT (user_id, shipment_type) DO UPDATE SET last_seq = EXCLUDED.last_seq, updated_at = now();
  END LOOP;

  -- Refresh receipt_code on ALL receipts (e.g. G3#1 → A5#1)
  UPDATE public.po_receipts pr
     SET receipt_code = po.shipment_code || '#' || pr.receipt_number::text
    FROM public.purchase_orders po
   WHERE pr.po_id = po.id;
END;
$$;
REVOKE ALL ON FUNCTION public.reassign_shipment_codes_global() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_shipment_codes_global() TO authenticated;

-- 2) Backward-compat wrapper: per-user call now triggers full company reassign
CREATE OR REPLACE FUNCTION public.reassign_shipment_codes_for_user(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.reassign_shipment_codes_global();
END;
$$;
REVOKE ALL ON FUNCTION public.reassign_shipment_codes_for_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_shipment_codes_for_user(uuid) TO authenticated;

-- 3) Trigger: assign next GLOBAL sequence for shipment_type on insert
CREATE OR REPLACE FUNCTION public.assign_shipment_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_seq integer;
BEGIN
  IF NEW.shipment_code IS NOT NULL AND length(btrim(NEW.shipment_code)) > 0 THEN
    RETURN NEW;
  END IF;

  v_prefix := CASE NEW.shipment_type
    WHEN 'grounded' THEN 'G'
    WHEN 'air' THEN 'A'
    WHEN 'door_to_door' THEN 'D'
    ELSE 'G'
  END;

  -- Global max across all users for this shipment_type
  SELECT COALESCE(MAX(NULLIF(regexp_replace(shipment_code, '^[A-Z]+', ''), '')::int), 0) + 1
    INTO v_seq
    FROM public.purchase_orders
   WHERE shipment_type = NEW.shipment_type
     AND shipment_code ~ ('^' || v_prefix || '[0-9]+$');

  NEW.shipment_code := v_prefix || v_seq::text;

  -- Keep per-user counter in sync (best-effort, not used for numbering anymore)
  INSERT INTO public.shipment_counters(user_id, shipment_type, last_seq, updated_at)
  VALUES (NEW.user_id, NEW.shipment_type, v_seq, now())
  ON CONFLICT (user_id, shipment_type) DO UPDATE
    SET last_seq = GREATEST(public.shipment_counters.last_seq, EXCLUDED.last_seq),
        updated_at = now();

  RETURN NEW;
END;
$$;

-- 4) One-shot fix for existing data (run as a privileged maintenance step)
DO $$
BEGIN
  -- Bypass the auth.uid() role check inside reassign_shipment_codes_global by inlining the logic here
  DECLARE
    r record;
    t text;
    seq int;
    prefix text;
  BEGIN
    FOREACH t IN ARRAY ARRAY['grounded','air','door_to_door'] LOOP
      prefix := CASE t WHEN 'grounded' THEN 'G' WHEN 'air' THEN 'A' ELSE 'D' END;
      seq := 0;
      UPDATE public.purchase_orders SET shipment_code = '__tmp__' || id::text WHERE shipment_type = t;
      FOR r IN
        SELECT id FROM public.purchase_orders
         WHERE shipment_type = t
         ORDER BY COALESCE(shipment_date, created_at) AT TIME ZONE 'Africa/Cairo' ASC, created_at ASC, id ASC
      LOOP
        seq := seq + 1;
        UPDATE public.purchase_orders SET shipment_code = prefix || seq::text WHERE id = r.id;
      END LOOP;
      INSERT INTO public.shipment_counters(user_id, shipment_type, last_seq, updated_at)
      SELECT DISTINCT user_id, t, seq, now() FROM public.purchase_orders WHERE shipment_type = t
      ON CONFLICT (user_id, shipment_type) DO UPDATE SET last_seq = EXCLUDED.last_seq, updated_at = now();
    END LOOP;
    UPDATE public.po_receipts pr
       SET receipt_code = po.shipment_code || '#' || pr.receipt_number::text
      FROM public.purchase_orders po
     WHERE pr.po_id = po.id;
  END;
END $$;
