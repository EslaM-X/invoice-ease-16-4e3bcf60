
ALTER TABLE public.delivery_receipts
  ADD COLUMN IF NOT EXISTS tax_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) NOT NULL DEFAULT 14.00;

CREATE OR REPLACE FUNCTION public.create_delivery_receipt(
  _invoice_id uuid, _delivered_to_name text, _delivered_to_phone text,
  _delivered_to_id_number text, _notes text, _manager_name text, _accountant_name text,
  _signature_customer text, _signature_manager text, _signature_accountant text,
  _status text, _items jsonb, _shipping_fees numeric DEFAULT NULL,
  _tax_enabled boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_invoice record;
  v_receipt_id uuid;
  v_receipt_no bigint;
  v_receipt_number text;
  v_item jsonb;
  v_inv_item record;
  v_already int;
  v_qty int;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'NO_ITEMS'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = _invoice_id AND public.can_access_user_data(user_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF v_invoice.status = 'voided' THEN RAISE EXCEPTION 'INVOICE_VOIDED'; END IF;

  INSERT INTO public.company_counters (id, receipt_seq) VALUES ('delivery_receipt', 1)
  ON CONFLICT (id) DO UPDATE SET receipt_seq = public.company_counters.receipt_seq + 1, updated_at = now()
  RETURNING receipt_seq INTO v_receipt_no;
  v_receipt_number := 'DR-' || to_char(now(), 'YYYY') || '-' || lpad(v_receipt_no::text, 5, '0');

  INSERT INTO public.delivery_receipts (
    user_id, invoice_id, receipt_number,
    delivered_to_name, delivered_to_phone, delivered_to_id_number,
    notes, manager_name, accountant_name,
    signature_customer, signature_manager, signature_accountant,
    status, shipping_fees, tax_enabled,
    created_by, created_by_email, updated_by, updated_by_email
  ) VALUES (
    v_invoice.user_id, _invoice_id, v_receipt_number,
    NULLIF(_delivered_to_name,''), NULLIF(_delivered_to_phone,''), NULLIF(_delivered_to_id_number,''),
    NULLIF(_notes,''), NULLIF(_manager_name,''), NULLIF(_accountant_name,''),
    NULLIF(_signature_customer,''), NULLIF(_signature_manager,''), NULLIF(_signature_accountant,''),
    COALESCE(NULLIF(_status,''),'draft'), _shipping_fees, COALESCE(_tax_enabled, false),
    v_user_id, v_email, v_user_id, v_email
  ) RETURNING id INTO v_receipt_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;
    SELECT ii.* INTO v_inv_item FROM public.invoice_items ii
    WHERE ii.id = (v_item->>'invoice_item_id')::uuid AND ii.invoice_id = _invoice_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_INVOICE_ITEM'; END IF;

    SELECT public.delivery_item_effective_qty(v_inv_item.id, 'strict_full') INTO v_already;
    IF v_already + v_qty > v_inv_item.quantity THEN
      RAISE EXCEPTION 'QUANTITY_EXCEEDED:%', v_inv_item.product_name;
    END IF;

    INSERT INTO public.delivery_receipt_items (receipt_id, invoice_item_id, product_name, serial_number, color, quantity, note)
    VALUES (v_receipt_id, v_inv_item.id, v_inv_item.product_name, v_inv_item.serial_number, v_inv_item.color, v_qty, NULLIF(v_item->>'note',''));
  END LOOP;

  PERFORM public.recalc_invoice_delivery_status(_invoice_id);
  RETURN v_receipt_id;
END $$;

CREATE OR REPLACE FUNCTION public.update_delivery_receipt(
  _receipt_id uuid, _delivered_to_name text, _delivered_to_phone text,
  _delivered_to_id_number text, _notes text, _manager_name text, _accountant_name text,
  _signature_customer text, _signature_manager text, _signature_accountant text,
  _status text, _items jsonb, _shipping_fees numeric DEFAULT NULL,
  _tax_enabled boolean DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_receipt record;
  v_item jsonb;
  v_inv_item record;
  v_already int;
  v_qty int;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;
  SELECT * INTO v_receipt FROM public.delivery_receipts
    WHERE id = _receipt_id AND public.can_access_user_data(user_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECEIPT_NOT_FOUND'; END IF;

  DELETE FROM public.delivery_receipt_items WHERE receipt_id = _receipt_id;

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

  IF _items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
      v_qty := COALESCE((v_item->>'quantity')::int, 0);
      IF v_qty <= 0 THEN CONTINUE; END IF;
      SELECT ii.* INTO v_inv_item FROM public.invoice_items ii
      WHERE ii.id = (v_item->>'invoice_item_id')::uuid AND ii.invoice_id = v_receipt.invoice_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_INVOICE_ITEM'; END IF;

      SELECT public.delivery_item_effective_qty(v_inv_item.id, 'strict_full') INTO v_already;
      IF v_already + v_qty > v_inv_item.quantity THEN
        RAISE EXCEPTION 'QUANTITY_EXCEEDED:%', v_inv_item.product_name;
      END IF;

      INSERT INTO public.delivery_receipt_items (receipt_id, invoice_item_id, product_name, serial_number, color, quantity, note)
      VALUES (_receipt_id, v_inv_item.id, v_inv_item.product_name, v_inv_item.serial_number, v_inv_item.color, v_qty, NULLIF(v_item->>'note',''));
    END LOOP;
  END IF;

  PERFORM public.recalc_invoice_delivery_status(v_receipt.invoice_id);
  RETURN _receipt_id;
END $$;
