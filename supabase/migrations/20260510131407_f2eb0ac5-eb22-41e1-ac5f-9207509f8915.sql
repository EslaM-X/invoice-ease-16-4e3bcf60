
ALTER TABLE public.delivery_receipts ADD COLUMN IF NOT EXISTS shipping_fees numeric;

CREATE TABLE IF NOT EXISTS public.delivery_receipt_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL,
  action text NOT NULL,
  actor_id uuid,
  actor_email text,
  before_data jsonb,
  after_data jsonb,
  changed_fields text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_audit_receipt ON public.delivery_receipt_audit_log(receipt_id, created_at DESC);

ALTER TABLE public.delivery_receipt_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company dr audit select" ON public.delivery_receipt_audit_log;
CREATE POLICY "company dr audit select" ON public.delivery_receipt_audit_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.delivery_receipts r
                 WHERE r.id = delivery_receipt_audit_log.receipt_id
                   AND public.can_access_user_data(r.user_id)));

CREATE OR REPLACE FUNCTION public.tg_dr_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_before jsonb;
  v_after jsonb;
  v_changed text[] := '{}';
  v_action text;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_after := to_jsonb(NEW);
    INSERT INTO public.delivery_receipt_audit_log(receipt_id, action, actor_id, actor_email, before_data, after_data, changed_fields)
    VALUES (NEW.id, v_action, v_uid, v_email, NULL, v_after, NULL);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'updated';
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    -- compute changed columns
    SELECT array_agg(key) INTO v_changed
    FROM jsonb_each(v_after) a
    WHERE COALESCE(v_before -> a.key, 'null'::jsonb) IS DISTINCT FROM a.value
      AND a.key NOT IN ('updated_at');
    IF v_changed IS NULL OR array_length(v_changed, 1) IS NULL THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.delivery_receipt_audit_log(receipt_id, action, actor_id, actor_email, before_data, after_data, changed_fields)
    VALUES (NEW.id, v_action, v_uid, v_email, v_before, v_after, v_changed);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.delivery_receipt_audit_log(receipt_id, action, actor_id, actor_email, before_data, after_data, changed_fields)
    VALUES (OLD.id, 'deleted', v_uid, v_email, to_jsonb(OLD), NULL, NULL);
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_dr_audit ON public.delivery_receipts;
CREATE TRIGGER trg_dr_audit
AFTER INSERT OR UPDATE OR DELETE ON public.delivery_receipts
FOR EACH ROW EXECUTE FUNCTION public.tg_dr_audit();

-- Update RPCs to accept shipping_fees
CREATE OR REPLACE FUNCTION public.create_delivery_receipt(
  _invoice_id uuid, _delivered_to_name text, _delivered_to_phone text,
  _delivered_to_id_number text, _notes text, _manager_name text, _accountant_name text,
  _signature_customer text, _signature_manager text, _signature_accountant text,
  _status text, _items jsonb, _shipping_fees numeric DEFAULT NULL
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
    status, shipping_fees, created_by, created_by_email, updated_by, updated_by_email
  ) VALUES (
    v_invoice.user_id, _invoice_id, v_receipt_number,
    NULLIF(_delivered_to_name,''), NULLIF(_delivered_to_phone,''), NULLIF(_delivered_to_id_number,''),
    NULLIF(_notes,''), NULLIF(_manager_name,''), NULLIF(_accountant_name,''),
    NULLIF(_signature_customer,''), NULLIF(_signature_manager,''), NULLIF(_signature_accountant,''),
    COALESCE(NULLIF(_status,''),'draft'), _shipping_fees,
    v_user_id, v_email, v_user_id, v_email
  ) RETURNING id INTO v_receipt_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;
    SELECT ii.* INTO v_inv_item FROM public.invoice_items ii
    WHERE ii.id = (v_item->>'invoice_item_id')::uuid AND ii.invoice_id = _invoice_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_INVOICE_ITEM'; END IF;
    SELECT COALESCE(SUM(dri.quantity),0) INTO v_already
      FROM public.delivery_receipt_items dri WHERE dri.invoice_item_id = v_inv_item.id;
    IF v_already + v_qty > v_inv_item.quantity THEN
      RAISE EXCEPTION 'QUANTITY_EXCEEDED:%', v_inv_item.product_name;
    END IF;
    INSERT INTO public.delivery_receipt_items (receipt_id, invoice_item_id, product_name, serial_number, color, quantity, note)
    VALUES (v_receipt_id, v_inv_item.id, v_inv_item.product_name, v_inv_item.serial_number, v_inv_item.color, v_qty, NULLIF(v_item->>'note',''));
  END LOOP;
  RETURN v_receipt_id;
END $$;

CREATE OR REPLACE FUNCTION public.update_delivery_receipt(
  _receipt_id uuid, _delivered_to_name text, _delivered_to_phone text,
  _delivered_to_id_number text, _notes text, _manager_name text, _accountant_name text,
  _signature_customer text, _signature_manager text, _signature_accountant text,
  _status text, _items jsonb, _shipping_fees numeric DEFAULT NULL
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
      SELECT COALESCE(SUM(dri.quantity),0) INTO v_already
        FROM public.delivery_receipt_items dri WHERE dri.invoice_item_id = v_inv_item.id;
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
