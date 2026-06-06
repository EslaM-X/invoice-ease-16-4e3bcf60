
-- 1) Table
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  method text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','transfer','instapay','visa','other')),
  reference text,
  notes text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_invoice ON public.payments(invoice_id);
CREATE INDEX idx_payments_user ON public.payments(user_id);
CREATE INDEX idx_payments_paid_at ON public.payments(paid_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company payments select" ON public.payments
  FOR SELECT TO authenticated
  USING (public.can_access_user_data(user_id));

CREATE POLICY "company payments insert" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_user_data(user_id));

CREATE POLICY "company payments update" ON public.payments
  FOR UPDATE TO authenticated
  USING (public.can_access_user_data(user_id))
  WITH CHECK (public.can_access_user_data(user_id));

CREATE POLICY "company payments delete" ON public.payments
  FOR DELETE TO authenticated
  USING (public.can_access_user_data(user_id));

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Recalc trigger: keep invoices.paid_amount = SUM(payments.amount) clamped to total
CREATE OR REPLACE FUNCTION public.recalc_invoice_paid_amount(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
  v_sum numeric;
BEGIN
  SELECT total INTO v_total FROM public.invoices WHERE id = _invoice_id;
  IF v_total IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_sum FROM public.payments WHERE invoice_id = _invoice_id;
  IF v_sum < 0 THEN v_sum := 0; END IF;
  IF v_sum > v_total THEN v_sum := v_total; END IF;
  UPDATE public.invoices SET paid_amount = v_sum, updated_at = now() WHERE id = _invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_payments_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_invoice_paid_amount(OLD.invoice_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND NEW.invoice_id <> OLD.invoice_id THEN
    PERFORM public.recalc_invoice_paid_amount(OLD.invoice_id);
    PERFORM public.recalc_invoice_paid_amount(NEW.invoice_id);
    RETURN NEW;
  ELSE
    PERFORM public.recalc_invoice_paid_amount(NEW.invoice_id);
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER trg_payments_aiud
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_payments_recalc();

-- 3) Backfill: seed one "legacy" payment per invoice that currently has paid_amount > 0
INSERT INTO public.payments (invoice_id, user_id, amount, method, reference, notes, paid_at, created_by, created_by_email)
SELECT i.id, i.user_id, i.paid_amount, 'other', 'LEGACY',
       'Legacy migration — تم استيراد المبلغ المحصّل التاريخي تلقائياً',
       i.created_at, i.created_by, i.created_by_email
FROM public.invoices i
WHERE COALESCE(i.paid_amount, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = i.id);

-- 4) Patch create_invoice: default paid_amount = 0 (not 50%)
CREATE OR REPLACE FUNCTION public.create_invoice(_customer_id uuid, _discount numeric, _notes text, _language text, _items jsonb, _paid_amount numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_email text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_receipt_no bigint;
  v_seq bigint;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_discount numeric := COALESCE(_discount, 0);
  v_paid numeric;
  v_cust_id uuid := NULL;
  v_cust_name text := NULL;
  v_cust_phone text := NULL;
  v_cust_address text := NULL;
  v_item jsonb;
  v_product record;
  v_qty int;
  v_unit_price numeric;
  v_item_discount numeric;
  v_line_total numeric;
  v_serial_number text;
  v_color text;
  v_product_name text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'NO_ITEMS' USING ERRCODE = '22023'; END IF;
  IF v_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_user_id;

  IF _customer_id IS NOT NULL THEN
    SELECT id, name, phone, address INTO v_cust_id, v_cust_name, v_cust_phone, v_cust_address
    FROM public.customers WHERE id = _customer_id AND public.can_access_user_data(user_id);
    IF v_cust_id IS NULL THEN RAISE EXCEPTION 'INVALID_CUSTOMER' USING ERRCODE = '22023'; END IF;
  END IF;

  INSERT INTO public.company_counters (id, receipt_seq) VALUES ('default', 1)
  ON CONFLICT (id) DO UPDATE
    SET receipt_seq = public.company_counters.receipt_seq + 1, updated_at = now()
  RETURNING receipt_seq INTO v_receipt_no;

  INSERT INTO public.user_counters (user_id, receipt_seq) VALUES (v_user_id, 1)
  ON CONFLICT (user_id) DO UPDATE
    SET receipt_seq = public.user_counters.receipt_seq + 1, updated_at = now();

  v_seq := v_receipt_no;
  v_invoice_number := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 5, '0');

  INSERT INTO public.invoices (
    user_id, invoice_number, receipt_number,
    customer_id, customer_name, customer_phone, customer_address,
    subtotal, discount, total, notes, language, status,
    created_by, created_by_email
  ) VALUES (
    v_user_id, v_invoice_number, v_receipt_no,
    v_cust_id, v_cust_name, v_cust_phone, v_cust_address,
    0, v_discount, 0, NULLIF(_notes, ''), COALESCE(_language, 'ar'), 'completed',
    v_user_id, v_actor_email
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    v_item_discount := COALESCE((v_item->>'discount')::numeric, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023'; END IF;
    IF v_item_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

    IF (v_item->>'product_id') IS NOT NULL AND (v_item->>'product_id') <> '' THEN
      SELECT id, name, price, stock_quantity, serial_number, color, user_id INTO v_product
      FROM public.products
      WHERE id = (v_item->>'product_id')::uuid AND public.can_access_user_data(user_id)
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PRODUCT' USING ERRCODE = '22023'; END IF;
      IF v_product.stock_quantity < v_qty THEN RAISE EXCEPTION 'OUT_OF_STOCK:%', v_product.name USING ERRCODE = '22023'; END IF;

      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_product.price, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_serial_number := NULLIF(v_item->>'serial_number', '');
      v_color := NULLIF(v_item->>'color', '');
      v_product_name := COALESCE(NULLIF(v_item->>'product_name', ''), v_product.name, 'Item');
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (v_invoice_id, v_product.id, v_product_name, v_serial_number,
              COALESCE(v_color, v_product.color), v_qty, v_unit_price, v_item_discount, v_line_total);

      UPDATE public.products SET stock_quantity = stock_quantity - v_qty WHERE id = v_product.id;

      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id, actor_id, actor_email)
      VALUES (v_product.user_id, v_product.id, -v_qty, 'sale ' || v_invoice_number, v_invoice_id, v_user_id, v_actor_email);
    ELSE
      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (v_invoice_id, NULL, COALESCE(NULLIF(v_item->>'product_name',''),'Item'),
              NULLIF(v_item->>'serial_number',''), NULLIF(v_item->>'color',''), v_qty, v_unit_price, v_item_discount, v_line_total);
    END IF;

    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  v_total := GREATEST(0, v_subtotal - v_discount);

  -- CHANGED: default to 0 instead of 50%
  IF _paid_amount IS NULL THEN
    v_paid := 0;
  ELSE
    v_paid := GREATEST(0, LEAST(_paid_amount, v_total));
  END IF;

  UPDATE public.invoices
  SET subtotal = v_subtotal, discount = v_discount, total = v_total, paid_amount = v_paid
  WHERE id = v_invoice_id;

  -- If an initial paid amount was provided, record it as a payment row
  IF v_paid > 0 THEN
    INSERT INTO public.payments (invoice_id, user_id, amount, method, notes, paid_at, created_by, created_by_email)
    VALUES (v_invoice_id, v_user_id, v_paid, 'cash', 'دفعة أولى عند إنشاء الفاتورة', now(), v_user_id, v_actor_email);
  END IF;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (v_invoice_id, v_user_id, 'created',
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(_items),
                       'receipt_no', v_receipt_no, 'actor_email', v_actor_email,
                       'paid_amount', v_paid));

  RETURN v_invoice_id;
END;
$function$;

-- 5) Patch update_invoice: same — no implicit 50%; respect existing payments sum
CREATE OR REPLACE FUNCTION public.update_invoice(_invoice_id uuid, _customer_id uuid, _discount numeric, _notes text, _language text, _items jsonb, _paid_amount numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_email text;
  v_invoice record;
  v_old_item record;
  v_item jsonb;
  v_product record;
  v_qty int;
  v_unit_price numeric;
  v_item_discount numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_paid numeric;
  v_payments_sum numeric;
  v_discount numeric := COALESCE(_discount, 0);
  v_cust_id uuid := NULL;
  v_cust_name text := NULL;
  v_cust_phone text := NULL;
  v_cust_address text := NULL;
  v_serial_number text;
  v_color text;
  v_product_name text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'NO_ITEMS' USING ERRCODE = '22023'; END IF;
  IF v_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = _invoice_id AND public.can_access_user_data(user_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF v_invoice.status = 'voided' THEN RAISE EXCEPTION 'INVOICE_VOIDED' USING ERRCODE = '22023'; END IF;

  IF _customer_id IS NOT NULL THEN
    SELECT id, name, phone, address INTO v_cust_id, v_cust_name, v_cust_phone, v_cust_address
    FROM public.customers WHERE id = _customer_id AND public.can_access_user_data(user_id);
    IF v_cust_id IS NULL THEN RAISE EXCEPTION 'INVALID_CUSTOMER' USING ERRCODE = '22023'; END IF;
  END IF;

  FOR v_old_item IN SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
    IF v_old_item.product_id IS NOT NULL THEN
      PERFORM 1 FROM public.products WHERE id = v_old_item.product_id FOR UPDATE;
      UPDATE public.products SET stock_quantity = stock_quantity + v_old_item.quantity WHERE id = v_old_item.product_id;
      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id, actor_id, actor_email)
      SELECT p.user_id, v_old_item.product_id, v_old_item.quantity, 'edit-revert ' || v_invoice.invoice_number, _invoice_id, v_user_id, v_actor_email
      FROM public.products p WHERE p.id = v_old_item.product_id;
    END IF;
  END LOOP;

  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    v_item_discount := COALESCE((v_item->>'discount')::numeric, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023'; END IF;
    IF v_item_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

    IF (v_item->>'product_id') IS NOT NULL AND (v_item->>'product_id') <> '' THEN
      SELECT id, name, price, stock_quantity, serial_number, color, user_id INTO v_product
      FROM public.products WHERE id = (v_item->>'product_id')::uuid AND public.can_access_user_data(user_id) FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PRODUCT' USING ERRCODE = '22023'; END IF;
      IF v_product.stock_quantity < v_qty THEN RAISE EXCEPTION 'OUT_OF_STOCK:%', v_product.name USING ERRCODE = '22023'; END IF;

      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_product.price, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_serial_number := NULLIF(v_item->>'serial_number', '');
      v_color := NULLIF(v_item->>'color', '');
      v_product_name := COALESCE(NULLIF(v_item->>'product_name', ''), v_product.name, 'Item');
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (_invoice_id, v_product.id, v_product_name, v_serial_number,
              COALESCE(v_color, v_product.color), v_qty, v_unit_price, v_item_discount, v_line_total);

      UPDATE public.products SET stock_quantity = stock_quantity - v_qty WHERE id = v_product.id;
      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id, actor_id, actor_email)
      VALUES (v_product.user_id, v_product.id, -v_qty, 'edit-resale ' || v_invoice.invoice_number, _invoice_id, v_user_id, v_actor_email);
    ELSE
      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (_invoice_id, NULL, COALESCE(NULLIF(v_item->>'product_name',''),'Item'),
              NULLIF(v_item->>'serial_number',''), NULLIF(v_item->>'color',''), v_qty, v_unit_price, v_item_discount, v_line_total);
    END IF;

    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  v_total := GREATEST(0, v_subtotal - v_discount);

  -- CHANGED: if caller didn't pass _paid_amount, keep payments-derived sum; else clamp & also reflect in payments via a single adjustment row
  SELECT COALESCE(SUM(amount),0) INTO v_payments_sum FROM public.payments WHERE invoice_id = _invoice_id;
  IF _paid_amount IS NULL THEN
    v_paid := LEAST(v_payments_sum, v_total);
  ELSE
    v_paid := GREATEST(0, LEAST(_paid_amount, v_total));
    IF v_paid <> v_payments_sum THEN
      INSERT INTO public.payments (invoice_id, user_id, amount, method, notes, paid_at, created_by, created_by_email)
      VALUES (_invoice_id, v_user_id, GREATEST(0, v_paid - v_payments_sum), 'other',
              'تسوية تعديل الفاتورة', now(), v_user_id, v_actor_email);
      SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.payments WHERE invoice_id = _invoice_id;
      v_paid := LEAST(v_paid, v_total);
    END IF;
  END IF;

  UPDATE public.invoices
  SET subtotal = v_subtotal, discount = v_discount, total = v_total, paid_amount = v_paid,
      notes = NULLIF(_notes, ''), language = COALESCE(_language, language),
      customer_id = v_cust_id, customer_name = v_cust_name,
      customer_phone = v_cust_phone, customer_address = v_cust_address,
      updated_at = now(), updated_by = v_user_id, updated_by_email = v_actor_email
  WHERE id = _invoice_id;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (_invoice_id, v_user_id, 'edited',
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(_items),
                       'previous_total', v_invoice.total, 'actor_email', v_actor_email,
                       'paid_amount', v_paid));

  RETURN _invoice_id;
END;
$function$;

-- 6) Convenience RPC: add a payment safely
CREATE OR REPLACE FUNCTION public.add_payment(
  _invoice_id uuid,
  _amount numeric,
  _method text DEFAULT 'cash',
  _reference text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _paid_at timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_invoice record;
  v_remaining numeric;
  v_amount numeric := COALESCE(_amount, 0);
  v_payment_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE='22023'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_invoice FROM public.invoices
    WHERE id = _invoice_id AND public.can_access_user_data(user_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE='22023'; END IF;
  IF v_invoice.status = 'voided' THEN RAISE EXCEPTION 'INVOICE_VOIDED' USING ERRCODE='22023'; END IF;

  v_remaining := GREATEST(0, v_invoice.total - COALESCE(v_invoice.paid_amount,0));
  IF v_amount > v_remaining THEN
    RAISE EXCEPTION 'AMOUNT_EXCEEDS_REMAINING:%', v_remaining USING ERRCODE='22023';
  END IF;

  INSERT INTO public.payments (invoice_id, user_id, amount, method, reference, notes, paid_at, created_by, created_by_email)
  VALUES (_invoice_id, v_invoice.user_id, v_amount,
          COALESCE(NULLIF(_method,''),'cash'),
          NULLIF(_reference,''),
          NULLIF(_notes,''),
          COALESCE(_paid_at, now()),
          v_user_id, v_email)
  RETURNING id INTO v_payment_id;

  RETURN v_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_payment(uuid, numeric, text, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_invoice_paid_amount(uuid) TO authenticated;
