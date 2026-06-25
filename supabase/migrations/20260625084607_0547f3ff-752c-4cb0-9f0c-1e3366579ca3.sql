-- Fix distributor auth/profile consistency and add sales/customer classification.

-- 1) Classification catalog for exhibitions / online campaigns / showrooms.
CREATE TABLE IF NOT EXISTS public.sales_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  year integer,
  event_type text NOT NULL DEFAULT 'exhibition',
  starts_at date,
  ends_at date,
  location text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_events TO authenticated;
GRANT ALL ON public.sales_events TO service_role;
ALTER TABLE public.sales_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company sales events select" ON public.sales_events;
CREATE POLICY "company sales events select" ON public.sales_events
  FOR SELECT TO authenticated USING (public.is_company_member());
DROP POLICY IF EXISTS "company sales events insert" ON public.sales_events;
CREATE POLICY "company sales events insert" ON public.sales_events
  FOR INSERT TO authenticated WITH CHECK (public.is_company_member());
DROP POLICY IF EXISTS "company sales events update" ON public.sales_events;
CREATE POLICY "company sales events update" ON public.sales_events
  FOR UPDATE TO authenticated USING (public.is_company_member()) WITH CHECK (public.is_company_member());
DROP POLICY IF EXISTS "company sales events delete" ON public.sales_events;
CREATE POLICY "company sales events delete" ON public.sales_events
  FOR DELETE TO authenticated USING (public.is_company_member());

DROP TRIGGER IF EXISTS trg_sales_events_updated ON public.sales_events;
CREATE TRIGGER trg_sales_events_updated
BEFORE UPDATE ON public.sales_events
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.sales_events (name, year, event_type, starts_at, location, is_active)
VALUES
  ('Ceramica Market', 2026, 'exhibition', DATE '2026-01-01', 'Egypt', true),
  ('Le Marché', 2026, 'exhibition', DATE '2026-01-01', 'Egypt', true)
ON CONFLICT DO NOTHING;

-- 2) Customer and invoice classification fields.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS sales_channel text,
  ADD COLUMN IF NOT EXISTS sales_event_id uuid REFERENCES public.sales_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_notes text;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS customer_category text,
  ADD COLUMN IF NOT EXISTS sales_channel text,
  ADD COLUMN IF NOT EXISTS sales_event_id uuid REFERENCES public.sales_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_category ON public.customers(category);
CREATE INDEX IF NOT EXISTS idx_customers_sales_channel ON public.customers(sales_channel);
CREATE INDEX IF NOT EXISTS idx_customers_sales_event ON public.customers(sales_event_id);
CREATE INDEX IF NOT EXISTS idx_invoices_sales_channel ON public.invoices(sales_channel);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_category ON public.invoices(customer_category);
CREATE INDEX IF NOT EXISTS idx_invoices_sales_event ON public.invoices(sales_event_id);

-- Backfill invoice classification from linked customers.
UPDATE public.invoices i
SET customer_category = COALESCE(i.customer_category, c.category),
    sales_channel = COALESCE(NULLIF(i.sales_channel, ''), c.sales_channel, CASE WHEN i.source = 'distributor' THEN 'distributor' ELSE NULL END),
    sales_event_id = COALESCE(i.sales_event_id, c.sales_event_id)
FROM public.customers c
WHERE i.customer_id = c.id;

UPDATE public.invoices
SET sales_channel = 'distributor'
WHERE source = 'distributor' AND (sales_channel IS NULL OR sales_channel = '');

-- 3) Let existing invoice RPCs receive category/channel/event safely.
CREATE OR REPLACE FUNCTION public.create_invoice(
  _customer_id uuid,
  _discount numeric,
  _notes text,
  _language text,
  _items jsonb,
  _paid_amount numeric DEFAULT NULL::numeric,
  _system_notes text DEFAULT NULL::text,
  _sales_channel text DEFAULT NULL::text,
  _sales_event_id uuid DEFAULT NULL::uuid,
  _customer_category text DEFAULT NULL::text
)
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
  v_customer_category text := NULLIF(_customer_category, '');
  v_sales_channel text := NULLIF(_sales_channel, '');
  v_sales_event_id uuid := _sales_event_id;
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
    SELECT id, name, phone, address,
           COALESCE(v_customer_category, category),
           COALESCE(v_sales_channel, sales_channel),
           COALESCE(v_sales_event_id, sales_event_id)
      INTO v_cust_id, v_cust_name, v_cust_phone, v_cust_address,
           v_customer_category, v_sales_channel, v_sales_event_id
    FROM public.customers WHERE id = _customer_id AND public.can_access_user_data(user_id);
    IF v_cust_id IS NULL THEN RAISE EXCEPTION 'INVALID_CUSTOMER' USING ERRCODE = '22023'; END IF;
  END IF;

  IF v_sales_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sales_events WHERE id = v_sales_event_id) THEN
    RAISE EXCEPTION 'INVALID_SALES_EVENT' USING ERRCODE = '22023';
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
    subtotal, discount, total, notes, system_notes, language, status,
    created_by, created_by_email, sales_channel, sales_event_id, customer_category
  ) VALUES (
    v_user_id, v_invoice_number, v_receipt_no,
    v_cust_id, v_cust_name, v_cust_phone, v_cust_address,
    0, v_discount, 0, NULLIF(_notes, ''), NULLIF(_system_notes, ''), COALESCE(_language, 'ar'), 'completed',
    v_user_id, v_actor_email, v_sales_channel, v_sales_event_id, v_customer_category
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

  IF _paid_amount IS NULL THEN v_paid := ROUND(v_total * 0.5, 2);
  ELSE v_paid := GREATEST(0, LEAST(_paid_amount, v_total)); END IF;

  UPDATE public.invoices
  SET subtotal = v_subtotal, discount = v_discount, total = v_total, paid_amount = v_paid
  WHERE id = v_invoice_id;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (v_invoice_id, v_user_id, 'created',
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(_items),
                       'receipt_no', v_receipt_no, 'actor_email', v_actor_email,
                       'paid_amount', v_paid, 'sales_channel', v_sales_channel,
                       'customer_category', v_customer_category));

  RETURN v_invoice_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_invoice(
  _invoice_id uuid,
  _customer_id uuid,
  _discount numeric,
  _notes text,
  _language text,
  _items jsonb,
  _paid_amount numeric DEFAULT NULL::numeric,
  _system_notes text DEFAULT NULL::text,
  _sales_channel text DEFAULT NULL::text,
  _sales_event_id uuid DEFAULT NULL::uuid,
  _customer_category text DEFAULT NULL::text
)
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
  v_discount numeric := COALESCE(_discount, 0);
  v_cust_id uuid := NULL;
  v_cust_name text := NULL;
  v_cust_phone text := NULL;
  v_cust_address text := NULL;
  v_customer_category text := NULLIF(_customer_category, '');
  v_sales_channel text := NULLIF(_sales_channel, '');
  v_sales_event_id uuid := _sales_event_id;
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
    SELECT id, name, phone, address,
           COALESCE(v_customer_category, category),
           COALESCE(v_sales_channel, sales_channel),
           COALESCE(v_sales_event_id, sales_event_id)
      INTO v_cust_id, v_cust_name, v_cust_phone, v_cust_address,
           v_customer_category, v_sales_channel, v_sales_event_id
    FROM public.customers WHERE id = _customer_id AND public.can_access_user_data(user_id);
    IF v_cust_id IS NULL THEN RAISE EXCEPTION 'INVALID_CUSTOMER' USING ERRCODE = '22023'; END IF;
  END IF;

  IF v_sales_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sales_events WHERE id = v_sales_event_id) THEN
    RAISE EXCEPTION 'INVALID_SALES_EVENT' USING ERRCODE = '22023';
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
  IF _paid_amount IS NULL THEN v_paid := ROUND(v_total * 0.5, 2);
  ELSE v_paid := GREATEST(0, LEAST(_paid_amount, v_total)); END IF;

  UPDATE public.invoices SET
    customer_id = v_cust_id,
    customer_name = v_cust_name,
    customer_phone = v_cust_phone,
    customer_address = v_cust_address,
    subtotal = v_subtotal,
    discount = v_discount,
    total = v_total,
    notes = NULLIF(_notes, ''),
    system_notes = NULLIF(_system_notes, ''),
    language = COALESCE(_language, v_invoice.language),
    paid_amount = v_paid,
    sales_channel = v_sales_channel,
    sales_event_id = v_sales_event_id,
    customer_category = v_customer_category,
    updated_at = now(),
    updated_by = v_user_id,
    updated_by_email = v_actor_email
  WHERE id = _invoice_id;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (_invoice_id, v_user_id, 'edited',
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(_items),
                       'actor_email', v_actor_email, 'paid_amount', v_paid,
                       'sales_channel', v_sales_channel, 'customer_category', v_customer_category));

  RETURN _invoice_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_invoice(uuid,numeric,text,text,jsonb,numeric,text,text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_invoice(uuid,uuid,numeric,text,text,jsonb,numeric,text,text,uuid,text) TO authenticated;

-- 4) Make manual distributor creation/approval always produce a valid distributor portal record.
CREATE OR REPLACE FUNCTION public.approve_user_account(_user_id uuid, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_profile public.profiles;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only admins can approve accounts'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE user_id = _user_id;

  UPDATE public.profiles SET approval_status='approved', approval_notes=_notes,
    approved_by=auth.uid(), approved_at=now() WHERE user_id=_user_id;

  IF v_profile.account_type = 'distributor' THEN
    INSERT INTO public.distributors (user_id, name, email, is_active)
    VALUES (_user_id, COALESCE(v_profile.display_name, split_part(v_profile.email,'@',1), 'Distributor'), v_profile.email, true)
    ON CONFLICT (user_id) DO UPDATE SET is_active = true, email = COALESCE(EXCLUDED.email, public.distributors.email), updated_at = now();
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.reject_user_account(_user_id uuid, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only admins can reject accounts'; END IF;
  UPDATE public.profiles SET approval_status='rejected', approval_notes=_notes,
    approved_by=auth.uid(), approved_at=now() WHERE user_id=_user_id;
  UPDATE public.distributors SET is_active=false WHERE user_id=_user_id;
END; $$;

REVOKE ALL ON FUNCTION public.approve_user_account(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_user_account(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_user_account(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_user_account(uuid,text) TO authenticated;

-- 5) A safe repair for the published test distributor account.
DO $$
DECLARE
  v_uid uuid;
  v_email text := 'test.distributor@steinheim.test';
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(v_email) LIMIT 1;
  IF v_uid IS NOT NULL THEN
    UPDATE auth.users
    SET encrypted_password = extensions.crypt('Test1234!', extensions.gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at = now(),
        raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"provider":"email","providers":["email"]}'::jsonb
    WHERE id = v_uid;

    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    SELECT gen_random_uuid(), v_uid,
           jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
           'email', v_uid::text, now(), now(), now()
    WHERE NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_uid AND provider = 'email');

    ALTER TABLE public.profiles DISABLE TRIGGER prevent_profile_approval_self_edit;
    INSERT INTO public.profiles (user_id, email, display_name, account_type, approval_status, approved_at)
    VALUES (v_uid, v_email, 'الموزع التجريبي', 'distributor', 'approved', now())
    ON CONFLICT (user_id) DO UPDATE
      SET email = EXCLUDED.email,
          display_name = COALESCE(public.profiles.display_name, EXCLUDED.display_name),
          account_type = 'distributor',
          approval_status = 'approved',
          approved_at = COALESCE(public.profiles.approved_at, now());
    ALTER TABLE public.profiles ENABLE TRIGGER prevent_profile_approval_self_edit;

    INSERT INTO public.distributors (user_id, name, showroom_name, location, city, address, phone, email, branches_count, is_active)
    VALUES (v_uid, 'الموزع التجريبي', 'معرض شتاينهايم — التجريبي', 'مدينة نصر', 'القاهرة', 'شارع التجارب 1', '+201000000000', v_email, 2, true)
    ON CONFLICT (user_id) DO UPDATE SET is_active = true, email = EXCLUDED.email, updated_at = now();
  END IF;
END $$;

-- 6) Realtime for analytics catalog if not already present.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_events;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;