
-- ============================================================
-- 1. COMPANY WORKSPACE — shared data for the 3 emails
-- ============================================================

CREATE TABLE IF NOT EXISTS public.company_members (
  user_id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  added_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated who is themselves a member can read the member list
CREATE POLICY "members can view team"
  ON public.company_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id = auth.uid())
  );

-- Allowed company emails (case-insensitive)
CREATE OR REPLACE FUNCTION public.is_allowed_company_email(_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(_email) IN (
    'cfo@steinheim-eg.com',
    'e.hesham@steinheim-eg.com',
    'k.elsharbatly@steinheim-eg.com'
  )
$$;

-- Backfill any existing auth users whose email is in the allowed list
INSERT INTO public.company_members (user_id, email)
SELECT u.id, u.email
FROM auth.users u
WHERE public.is_allowed_company_email(u.email)
ON CONFLICT (user_id) DO NOTHING;

-- Trigger: on new user signup with allowed email, auto-add to company
CREATE OR REPLACE FUNCTION public.add_company_member_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_allowed_company_email(NEW.email) THEN
    INSERT INTO public.company_members (user_id, email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_company_member ON auth.users;
CREATE TRIGGER on_auth_user_company_member
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.add_company_member_on_signup();

-- ============================================================
-- 2. SHARED-ACCESS HELPER (used by all RLS policies)
-- ============================================================
-- Returns true if current auth.uid() can access data owned by _owner_id.
-- True when: caller is a company member AND owner is also a company member,
-- OR caller IS the owner (preserves non-team users seeing only their data).
CREATE OR REPLACE FUNCTION public.can_access_user_data(_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() = _owner_id
    OR (
      EXISTS (SELECT 1 FROM public.company_members WHERE user_id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.company_members WHERE user_id = _owner_id)
    )
$$;

CREATE OR REPLACE FUNCTION public.is_company_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_members WHERE user_id = auth.uid())
$$;

-- ============================================================
-- 3. REPLACE RLS POLICIES — shared visibility for company members
-- ============================================================

-- CUSTOMERS
DROP POLICY IF EXISTS "own customers select" ON public.customers;
DROP POLICY IF EXISTS "own customers insert" ON public.customers;
DROP POLICY IF EXISTS "own customers update" ON public.customers;
DROP POLICY IF EXISTS "own customers delete" ON public.customers;

CREATE POLICY "company customers select" ON public.customers
  FOR SELECT TO authenticated USING (public.can_access_user_data(user_id));
CREATE POLICY "company customers insert" ON public.customers
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR public.is_company_member());
CREATE POLICY "company customers update" ON public.customers
  FOR UPDATE TO authenticated USING (public.can_access_user_data(user_id));
CREATE POLICY "company customers delete" ON public.customers
  FOR DELETE TO authenticated USING (public.can_access_user_data(user_id));

-- PRODUCTS
DROP POLICY IF EXISTS "own products select" ON public.products;
DROP POLICY IF EXISTS "own products insert" ON public.products;
DROP POLICY IF EXISTS "own products update" ON public.products;
DROP POLICY IF EXISTS "own products delete" ON public.products;

CREATE POLICY "company products select" ON public.products
  FOR SELECT TO authenticated USING (public.can_access_user_data(user_id));
CREATE POLICY "company products insert" ON public.products
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR public.is_company_member());
CREATE POLICY "company products update" ON public.products
  FOR UPDATE TO authenticated USING (public.can_access_user_data(user_id));
CREATE POLICY "company products delete" ON public.products
  FOR DELETE TO authenticated USING (public.can_access_user_data(user_id));

-- INVOICES
DROP POLICY IF EXISTS "own invoices select" ON public.invoices;
DROP POLICY IF EXISTS "own invoices insert" ON public.invoices;
DROP POLICY IF EXISTS "own invoices update" ON public.invoices;
DROP POLICY IF EXISTS "own invoices delete" ON public.invoices;

CREATE POLICY "company invoices select" ON public.invoices
  FOR SELECT TO authenticated USING (public.can_access_user_data(user_id));
CREATE POLICY "company invoices insert" ON public.invoices
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR public.is_company_member());
CREATE POLICY "company invoices update" ON public.invoices
  FOR UPDATE TO authenticated USING (public.can_access_user_data(user_id));
CREATE POLICY "company invoices delete" ON public.invoices
  FOR DELETE TO authenticated USING (public.can_access_user_data(user_id));

-- INVOICE_ITEMS — via invoice ownership check
DROP POLICY IF EXISTS "items via own invoice select" ON public.invoice_items;
DROP POLICY IF EXISTS "items via own invoice insert" ON public.invoice_items;
DROP POLICY IF EXISTS "items via own invoice update" ON public.invoice_items;
DROP POLICY IF EXISTS "items via own invoice delete" ON public.invoice_items;

CREATE POLICY "items via company invoice select" ON public.invoice_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i
                 WHERE i.id = invoice_items.invoice_id
                   AND public.can_access_user_data(i.user_id)));
CREATE POLICY "items via company invoice insert" ON public.invoice_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.invoices i
                      WHERE i.id = invoice_items.invoice_id
                        AND public.can_access_user_data(i.user_id)));
CREATE POLICY "items via company invoice update" ON public.invoice_items
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i
                 WHERE i.id = invoice_items.invoice_id
                   AND public.can_access_user_data(i.user_id)));
CREATE POLICY "items via company invoice delete" ON public.invoice_items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i
                 WHERE i.id = invoice_items.invoice_id
                   AND public.can_access_user_data(i.user_id)));

-- INVENTORY_LOGS
DROP POLICY IF EXISTS "own logs select" ON public.inventory_logs;
DROP POLICY IF EXISTS "own logs insert" ON public.inventory_logs;

CREATE POLICY "company logs select" ON public.inventory_logs
  FOR SELECT TO authenticated USING (public.can_access_user_data(user_id));
CREATE POLICY "company logs insert" ON public.inventory_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR public.is_company_member());

-- INVOICE_EVENTS
DROP POLICY IF EXISTS "own invoice events select" ON public.invoice_events;
CREATE POLICY "company invoice events select" ON public.invoice_events
  FOR SELECT TO authenticated USING (public.can_access_user_data(user_id));

-- SETTINGS (keep per-user; each member keeps own UI prefs)
-- (no change)

-- USER_COUNTERS (keep per-user; receipt sequence is per identity)
-- (no change)

-- ============================================================
-- 4. AUDIT COLUMNS — track who did what
-- ============================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_by_email text,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by_email text;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_by_email text,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by_email text;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_by_email text,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by_email text;

ALTER TABLE public.inventory_logs
  ADD COLUMN IF NOT EXISTS actor_id uuid,
  ADD COLUMN IF NOT EXISTS actor_email text;

-- Trigger to auto-fill created_by / updated_by from auth.uid() on writes
CREATE OR REPLACE FUNCTION public.set_audit_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NULL THEN NEW.created_by := v_uid; END IF;
    IF NEW.created_by_email IS NULL THEN NEW.created_by_email := v_email; END IF;
    NEW.updated_by := v_uid;
    NEW.updated_by_email := v_email;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_by := v_uid;
    NEW.updated_by_email := v_email;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_products ON public.products;
CREATE TRIGGER audit_products BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_audit_columns();

DROP TRIGGER IF EXISTS audit_customers ON public.customers;
CREATE TRIGGER audit_customers BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_audit_columns();

DROP TRIGGER IF EXISTS audit_invoices ON public.invoices;
CREATE TRIGGER audit_invoices BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_audit_columns();

-- For inventory_logs (different column names)
CREATE OR REPLACE FUNCTION public.set_inventory_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
    IF NEW.actor_id IS NULL THEN NEW.actor_id := v_uid; END IF;
    IF NEW.actor_email IS NULL THEN NEW.actor_email := v_email; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_inventory_logs ON public.inventory_logs;
CREATE TRIGGER audit_inventory_logs BEFORE INSERT ON public.inventory_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_inventory_actor();

-- ============================================================
-- 5. PERMANENT AUDIT LOG (never deleted)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_email text,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  details jsonb
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company audit_log select" ON public.audit_log
  FOR SELECT TO authenticated USING (public.is_company_member() OR auth.uid() = actor_id);
CREATE POLICY "company audit_log insert" ON public.audit_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = actor_id OR auth.uid() IS NOT NULL);
-- No UPDATE or DELETE policies → cannot be modified or deleted

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log (entity_type, entity_id);

-- Generic audit trigger
CREATE OR REPLACE FUNCTION public.write_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_entity uuid;
  v_action text;
  v_details jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  IF TG_OP = 'INSERT' THEN
    v_action := 'created'; v_entity := NEW.id; v_details := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'updated'; v_entity := NEW.id;
    v_details := jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'deleted'; v_entity := OLD.id; v_details := to_jsonb(OLD);
  END IF;

  INSERT INTO public.audit_log (actor_id, actor_email, entity_type, entity_id, action, details)
  VALUES (v_uid, v_email, TG_TABLE_NAME, v_entity, v_action, v_details);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS audit_log_products ON public.products;
CREATE TRIGGER audit_log_products
  AFTER INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS audit_log_customers ON public.customers;
CREATE TRIGGER audit_log_customers
  AFTER INSERT OR UPDATE OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS audit_log_invoices ON public.invoices;
CREATE TRIGGER audit_log_invoices
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

-- ============================================================
-- 6. UPDATE INVOICE RPCs to record actor email in events
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_invoice(_customer_id uuid, _discount numeric, _notes text, _language text, _items jsonb)
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
  v_seq int;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_discount numeric := COALESCE(_discount, 0);
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

  INSERT INTO public.user_counters (user_id, receipt_seq) VALUES (v_user_id, 1)
  ON CONFLICT (user_id) DO UPDATE
    SET receipt_seq = public.user_counters.receipt_seq + 1, updated_at = now()
  RETURNING receipt_seq INTO v_receipt_no;

  SELECT COUNT(*) + 1 INTO v_seq FROM public.invoices
  WHERE date_trunc('year', created_at) = date_trunc('year', now());
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

      v_unit_price := v_product.price;
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (v_invoice_id, v_product.id, v_product.name, NULLIF(v_item->>'serial_number',''),
              COALESCE(NULLIF(v_item->>'color',''), v_product.color), v_qty, v_unit_price, v_item_discount, v_line_total);

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

  UPDATE public.invoices SET subtotal = v_subtotal, total = v_total WHERE id = v_invoice_id;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (v_invoice_id, v_user_id, 'created',
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(_items),
                       'receipt_no', v_receipt_no, 'actor_email', v_actor_email));

  RETURN v_invoice_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_invoice(_invoice_id uuid, _customer_id uuid, _discount numeric, _notes text, _language text, _items jsonb)
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
  v_discount numeric := COALESCE(_discount, 0);
  v_cust_id uuid := NULL;
  v_cust_name text := NULL;
  v_cust_phone text := NULL;
  v_cust_address text := NULL;
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

      v_unit_price := v_product.price;
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (_invoice_id, v_product.id, v_product.name, NULLIF(v_item->>'serial_number',''),
              COALESCE(NULLIF(v_item->>'color',''), v_product.color), v_qty, v_unit_price, v_item_discount, v_line_total);

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

  UPDATE public.invoices
  SET subtotal = v_subtotal, discount = v_discount, total = v_total,
      notes = NULLIF(_notes, ''), language = COALESCE(_language, language),
      customer_id = v_cust_id, customer_name = v_cust_name,
      customer_phone = v_cust_phone, customer_address = v_cust_address,
      updated_at = now(), updated_by = v_user_id, updated_by_email = v_actor_email
  WHERE id = _invoice_id;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (_invoice_id, v_user_id, 'edited',
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(_items),
                       'previous_total', v_invoice.total, 'actor_email', v_actor_email));

  RETURN _invoice_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.void_invoice(_invoice_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_email text;
  v_invoice record;
  v_item record;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = _invoice_id AND public.can_access_user_data(user_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF v_invoice.status = 'voided' THEN RETURN _invoice_id; END IF;

  FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      PERFORM 1 FROM public.products WHERE id = v_item.product_id FOR UPDATE;
      UPDATE public.products SET stock_quantity = stock_quantity + v_item.quantity WHERE id = v_item.product_id;
      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id, actor_id, actor_email)
      SELECT p.user_id, v_item.product_id, v_item.quantity, 'void ' || v_invoice.invoice_number, _invoice_id, v_user_id, v_actor_email
      FROM public.products p WHERE p.id = v_item.product_id;
    END IF;
  END LOOP;

  UPDATE public.invoices SET status = 'voided', updated_at = now(),
    updated_by = v_user_id, updated_by_email = v_actor_email WHERE id = _invoice_id;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (_invoice_id, v_user_id, 'voided', jsonb_build_object('total', v_invoice.total, 'actor_email', v_actor_email));

  RETURN _invoice_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_invoice(_invoice_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_email text;
  v_invoice record;
  v_item record;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = _invoice_id AND public.can_access_user_data(user_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = '22023'; END IF;

  IF v_invoice.status <> 'voided' THEN
    FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
      IF v_item.product_id IS NOT NULL THEN
        PERFORM 1 FROM public.products WHERE id = v_item.product_id FOR UPDATE;
        UPDATE public.products SET stock_quantity = stock_quantity + v_item.quantity WHERE id = v_item.product_id;
        INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id, actor_id, actor_email)
        SELECT p.user_id, v_item.product_id, v_item.quantity, 'delete ' || v_invoice.invoice_number, _invoice_id, v_user_id, v_actor_email
        FROM public.products p WHERE p.id = v_item.product_id;
      END IF;
    END LOOP;
  END IF;

  -- Audit BEFORE delete (so we keep evidence)
  INSERT INTO public.audit_log (actor_id, actor_email, entity_type, entity_id, action, details)
  VALUES (v_user_id, v_actor_email, 'invoices', _invoice_id, 'deleted',
          jsonb_build_object('invoice_number', v_invoice.invoice_number,
                             'total', v_invoice.total,
                             'customer_name', v_invoice.customer_name));

  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;
  DELETE FROM public.invoices WHERE id = _invoice_id;

  RETURN _invoice_id;
END;
$function$;

-- ============================================================
-- 7. PRODUCT IMAGES storage bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "product images public read" ON storage.objects;
CREATE POLICY "product images public read" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "company members upload product images" ON storage.objects;
CREATE POLICY "company members upload product images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND public.is_company_member());

DROP POLICY IF EXISTS "company members update product images" ON storage.objects;
CREATE POLICY "company members update product images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images' AND public.is_company_member());

DROP POLICY IF EXISTS "company members delete product images" ON storage.objects;
CREATE POLICY "company members delete product images" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND public.is_company_member());

-- ============================================================
-- 8. ENABLE REALTIME
-- ============================================================
ALTER TABLE public.products REPLICA IDENTITY FULL;
ALTER TABLE public.customers REPLICA IDENTITY FULL;
ALTER TABLE public.invoices REPLICA IDENTITY FULL;
ALTER TABLE public.invoice_items REPLICA IDENTITY FULL;
ALTER TABLE public.inventory_logs REPLICA IDENTITY FULL;
ALTER TABLE public.invoice_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.products; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.customers; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_items; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_logs; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_events; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
