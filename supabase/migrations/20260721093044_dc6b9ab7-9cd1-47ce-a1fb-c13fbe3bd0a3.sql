
-- Create RPC for distributor invoices that uses the same company_counters.receipt_seq
-- so distributor invoice numbers stay perfectly sequential with regular invoices,
-- just prefixed with 'D-' instead of 'INV-'.

CREATE OR REPLACE FUNCTION public.create_distributor_invoice(
  _customer_name text,
  _customer_phone text,
  _customer_address text,
  _shipping_address text,
  _customer_category text,
  _sales_event_id uuid,
  _notes text,
  _language text,
  _items jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_email text;
  v_distributor_id uuid;
  v_invoice_id uuid;
  v_receipt_no bigint;
  v_invoice_number text;
  v_subtotal numeric := 0;
  v_item jsonb;
  v_qty int;
  v_unit_price numeric;
  v_line_total numeric;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'NO_ITEMS' USING ERRCODE = '22023'; END IF;
  IF COALESCE(btrim(_customer_name),'') = '' THEN RAISE EXCEPTION 'CUSTOMER_NAME_REQUIRED' USING ERRCODE = '22023'; END IF;

  SELECT id INTO v_distributor_id FROM public.distributors
    WHERE user_id = v_user_id AND is_active = true LIMIT 1;
  IF v_distributor_id IS NULL THEN RAISE EXCEPTION 'NOT_A_DISTRIBUTOR' USING ERRCODE = '42501'; END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_user_id;

  -- Share the same sequential counter as regular invoices
  INSERT INTO public.company_counters (id, receipt_seq) VALUES ('default', 1)
  ON CONFLICT (id) DO UPDATE SET receipt_seq = public.company_counters.receipt_seq + 1, updated_at = now()
  RETURNING receipt_seq INTO v_receipt_no;

  v_invoice_number := 'D-' || to_char(now(), 'YYYY') || '-' || lpad(v_receipt_no::text, 5, '0');

  -- compute subtotal
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023'; END IF;
    IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
    v_subtotal := v_subtotal + (v_unit_price * v_qty);
  END LOOP;

  INSERT INTO public.invoices (
    user_id, invoice_number, receipt_number, customer_name, customer_phone, customer_address,
    shipping_address, customer_category, sales_channel, sales_event_id,
    subtotal, discount, total, notes, status, source, distributor_id,
    approval_status, language, created_by, created_by_email
  ) VALUES (
    v_user_id, v_invoice_number, v_receipt_no,
    btrim(_customer_name), NULLIF(btrim(_customer_phone),''), NULLIF(btrim(_customer_address),''),
    NULLIF(btrim(_shipping_address),''), NULLIF(_customer_category,''),
    'distributor', _sales_event_id,
    v_subtotal, 0, v_subtotal, NULLIF(btrim(_notes),''),
    'draft', 'distributor', v_distributor_id,
    'pending', COALESCE(_language,'ar'), v_user_id, v_actor_email
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
    v_line_total := v_unit_price * v_qty;
    INSERT INTO public.invoice_items (
      invoice_id, product_id, product_name, serial_number, color,
      quantity, unit_price, discount, line_total
    ) VALUES (
      v_invoice_id,
      NULLIF(v_item->>'product_id','')::uuid,
      COALESCE(NULLIF(v_item->>'product_name',''),'Item'),
      NULLIF(v_item->>'serial_number',''),
      NULLIF(v_item->>'color',''),
      v_qty, v_unit_price, 0, v_line_total
    );
  END LOOP;

  RETURN v_invoice_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_distributor_invoice(text,text,text,text,text,uuid,text,text,jsonb) TO authenticated;

-- Backfill: renumber existing legacy D-<random> distributor invoices to the
-- unified sequential scheme, oldest first, so they slot into the counter cleanly.
DO $$
DECLARE
  r record;
  v_seq bigint;
BEGIN
  FOR r IN
    SELECT id, created_at FROM public.invoices
    WHERE invoice_number ~ '^D-[0-9]+$'
    ORDER BY created_at ASC
  LOOP
    INSERT INTO public.company_counters (id, receipt_seq) VALUES ('default', 1)
    ON CONFLICT (id) DO UPDATE SET receipt_seq = public.company_counters.receipt_seq + 1, updated_at = now()
    RETURNING receipt_seq INTO v_seq;

    UPDATE public.invoices
      SET invoice_number = 'D-' || to_char(r.created_at, 'YYYY') || '-' || lpad(v_seq::text, 5, '0'),
          receipt_number = COALESCE(receipt_number, v_seq)
      WHERE id = r.id;
  END LOOP;
END $$;
