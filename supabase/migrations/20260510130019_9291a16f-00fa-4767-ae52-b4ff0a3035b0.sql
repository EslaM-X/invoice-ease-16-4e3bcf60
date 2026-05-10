
-- 1) Add delivery_status column on invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'pending';

-- 2) delivery_receipts
CREATE TABLE IF NOT EXISTS public.delivery_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  receipt_number text NOT NULL UNIQUE,
  delivered_to_name text,
  delivered_to_phone text,
  delivered_to_id_number text,
  notes text,
  signature_customer text,
  signature_manager text,
  signature_accountant text,
  manager_name text,
  accountant_name text,
  status text NOT NULL DEFAULT 'draft',
  delivered_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_email text,
  updated_by uuid,
  updated_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delivery_receipts_invoice ON public.delivery_receipts(invoice_id);
CREATE INDEX IF NOT EXISTS idx_delivery_receipts_user ON public.delivery_receipts(user_id);

-- 3) delivery_receipt_items
CREATE TABLE IF NOT EXISTS public.delivery_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.delivery_receipts(id) ON DELETE CASCADE,
  invoice_item_id uuid REFERENCES public.invoice_items(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  serial_number text,
  color text,
  quantity integer NOT NULL CHECK (quantity > 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dri_receipt ON public.delivery_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_dri_invoice_item ON public.delivery_receipt_items(invoice_item_id);

-- 4) RLS
ALTER TABLE public.delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_receipt_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company dr select" ON public.delivery_receipts FOR SELECT TO authenticated
  USING (public.can_access_user_data(user_id));
CREATE POLICY "company dr insert" ON public.delivery_receipts FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = user_id) OR public.is_company_member());
CREATE POLICY "company dr update" ON public.delivery_receipts FOR UPDATE TO authenticated
  USING (public.can_access_user_data(user_id));
CREATE POLICY "company dr delete" ON public.delivery_receipts FOR DELETE TO authenticated
  USING (public.can_access_user_data(user_id));

CREATE POLICY "dri select via parent" ON public.delivery_receipt_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.delivery_receipts r WHERE r.id = receipt_id AND public.can_access_user_data(r.user_id)));
CREATE POLICY "dri insert via parent" ON public.delivery_receipt_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.delivery_receipts r WHERE r.id = receipt_id AND public.can_access_user_data(r.user_id)));
CREATE POLICY "dri update via parent" ON public.delivery_receipt_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.delivery_receipts r WHERE r.id = receipt_id AND public.can_access_user_data(r.user_id)));
CREATE POLICY "dri delete via parent" ON public.delivery_receipt_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.delivery_receipts r WHERE r.id = receipt_id AND public.can_access_user_data(r.user_id)));

-- 5) updated_at trigger
DROP TRIGGER IF EXISTS trg_dr_updated_at ON public.delivery_receipts;
CREATE TRIGGER trg_dr_updated_at BEFORE UPDATE ON public.delivery_receipts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6) Recalculate invoice delivery status helper
CREATE OR REPLACE FUNCTION public.recalc_invoice_delivery_status(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_required int := 0;
  v_total_delivered int := 0;
  v_any_short boolean := false;
  v_status text;
  r record;
BEGIN
  FOR r IN
    SELECT ii.id AS item_id, ii.quantity AS req_qty,
      COALESCE((SELECT SUM(dri.quantity) FROM public.delivery_receipt_items dri
                WHERE dri.invoice_item_id = ii.id), 0) AS del_qty
    FROM public.invoice_items ii
    WHERE ii.invoice_id = _invoice_id
  LOOP
    v_total_required := v_total_required + r.req_qty;
    v_total_delivered := v_total_delivered + r.del_qty;
    IF r.del_qty < r.req_qty THEN v_any_short := true; END IF;
  END LOOP;

  IF v_total_required = 0 OR v_total_delivered = 0 THEN
    v_status := 'pending';
  ELSIF v_any_short THEN
    v_status := 'partial';
  ELSE
    v_status := 'delivered';
  END IF;

  UPDATE public.invoices SET delivery_status = v_status WHERE id = _invoice_id;
END;
$$;

-- 7) Trigger to recalc status on items changes
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
    PERFORM public.recalc_invoice_delivery_status(v_invoice_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_dri_recalc ON public.delivery_receipt_items;
CREATE TRIGGER trg_dri_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.delivery_receipt_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_delivery_status();

-- Also handle when entire receipt is deleted
CREATE OR REPLACE FUNCTION public.tg_recalc_on_receipt_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recalc_invoice_delivery_status(OLD.invoice_id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_dr_delete_recalc ON public.delivery_receipts;
CREATE TRIGGER trg_dr_delete_recalc
  AFTER DELETE ON public.delivery_receipts
  FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_on_receipt_delete();

-- 8) Add counter row for delivery receipts
INSERT INTO public.company_counters (id, receipt_seq) VALUES ('delivery_receipt', 0)
  ON CONFLICT (id) DO NOTHING;

-- 9) RPC: create_delivery_receipt
CREATE OR REPLACE FUNCTION public.create_delivery_receipt(
  _invoice_id uuid,
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
  _items jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT * INTO v_invoice FROM public.invoices
  WHERE id = _invoice_id AND public.can_access_user_data(user_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF v_invoice.status = 'voided' THEN RAISE EXCEPTION 'INVOICE_VOIDED'; END IF;

  -- counter
  UPDATE public.company_counters SET receipt_seq = receipt_seq + 1, updated_at = now()
    WHERE id = 'delivery_receipt' RETURNING receipt_seq INTO v_receipt_no;
  v_receipt_number := 'DR-' || to_char(now(), 'YYYY') || '-' || lpad(v_receipt_no::text, 5, '0');

  INSERT INTO public.delivery_receipts (
    user_id, invoice_id, receipt_number,
    delivered_to_name, delivered_to_phone, delivered_to_id_number,
    notes, manager_name, accountant_name,
    signature_customer, signature_manager, signature_accountant,
    status, created_by, created_by_email, updated_by, updated_by_email
  ) VALUES (
    v_invoice.user_id, _invoice_id, v_receipt_number,
    NULLIF(_delivered_to_name,''), NULLIF(_delivered_to_phone,''), NULLIF(_delivered_to_id_number,''),
    NULLIF(_notes,''), NULLIF(_manager_name,''), NULLIF(_accountant_name,''),
    NULLIF(_signature_customer,''), NULLIF(_signature_manager,''), NULLIF(_signature_accountant,''),
    COALESCE(NULLIF(_status,''),'draft'),
    v_user_id, v_email, v_user_id, v_email
  ) RETURNING id INTO v_receipt_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    SELECT ii.* INTO v_inv_item FROM public.invoice_items ii
    WHERE ii.id = (v_item->>'invoice_item_id')::uuid AND ii.invoice_id = _invoice_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_INVOICE_ITEM'; END IF;

    SELECT COALESCE(SUM(dri.quantity),0) INTO v_already
      FROM public.delivery_receipt_items dri
      WHERE dri.invoice_item_id = v_inv_item.id;
    IF v_already + v_qty > v_inv_item.quantity THEN
      RAISE EXCEPTION 'QUANTITY_EXCEEDED:%', v_inv_item.product_name;
    END IF;

    INSERT INTO public.delivery_receipt_items (
      receipt_id, invoice_item_id, product_name, serial_number, color, quantity, note
    ) VALUES (
      v_receipt_id, v_inv_item.id, v_inv_item.product_name,
      v_inv_item.serial_number, v_inv_item.color, v_qty,
      NULLIF(v_item->>'note','')
    );
  END LOOP;

  RETURN v_receipt_id;
END;
$$;

-- 10) RPC: update_delivery_receipt
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
  _items jsonb
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
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_receipt FROM public.delivery_receipts
    WHERE id = _receipt_id AND public.can_access_user_data(user_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECEIPT_NOT_FOUND'; END IF;

  -- delete old items first so quantity check is clean
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
        FROM public.delivery_receipt_items dri
        WHERE dri.invoice_item_id = v_inv_item.id;
      IF v_already + v_qty > v_inv_item.quantity THEN
        RAISE EXCEPTION 'QUANTITY_EXCEEDED:%', v_inv_item.product_name;
      END IF;

      INSERT INTO public.delivery_receipt_items (
        receipt_id, invoice_item_id, product_name, serial_number, color, quantity, note
      ) VALUES (
        _receipt_id, v_inv_item.id, v_inv_item.product_name,
        v_inv_item.serial_number, v_inv_item.color, v_qty,
        NULLIF(v_item->>'note','')
      );
    END LOOP;
  END IF;

  PERFORM public.recalc_invoice_delivery_status(v_receipt.invoice_id);
  RETURN _receipt_id;
END;
$$;
