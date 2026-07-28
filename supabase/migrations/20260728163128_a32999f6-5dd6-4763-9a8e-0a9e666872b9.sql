
-- 1) Add stock_flow marker on invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS stock_flow text NOT NULL DEFAULT 'immediate'
  CHECK (stock_flow IN ('immediate','reservation'));

-- 2) Gate old stock deduction inside cover_invoice_item behind the flag
CREATE OR REPLACE FUNCTION public.cover_invoice_item(
  _invoice_id uuid, _invoice_item_id uuid, _product_id uuid, _qty integer,
  _actor_id uuid, _actor_email text, _reason text, _invoice_number text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_product record;
  v_stock_take int := 0;
  v_shortfall int;
  v_po_item record;
  v_take int;
  v_engine_on boolean := public.is_flag_on('reservation_engine');
BEGIN
  IF _product_id IS NULL OR _qty <= 0 THEN RETURN; END IF;
  SELECT id, user_id, stock_quantity INTO v_product FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_engine_on THEN
    -- Reservation engine: DO NOT deduct stock here. Reservation is handled by reserve_invoice_items().
    -- PO shortfall reservations still linked below.
    v_shortfall := _qty - LEAST(_qty, GREATEST(v_product.stock_quantity, 0));
  ELSE
    v_stock_take := LEAST(_qty, GREATEST(v_product.stock_quantity, 0));
    v_shortfall  := _qty - v_stock_take;
    IF v_stock_take > 0 THEN
      UPDATE public.products SET stock_quantity = stock_quantity - v_stock_take WHERE id = v_product.id;
      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id, actor_id, actor_email)
      VALUES (v_product.user_id, v_product.id, -v_stock_take, _reason || ' ' || COALESCE(_invoice_number,''), _invoice_id, _actor_id, _actor_email);
    END IF;
  END IF;

  IF v_shortfall > 0 THEN
    FOR v_po_item IN
      SELECT poi.id AS po_item_id, poi.po_id,
             GREATEST(0, poi.quantity - COALESCE(poi.received_qty,0))
               - COALESCE((SELECT SUM(quantity) FROM public.invoice_po_reservations r
                             WHERE r.po_item_id = poi.id AND r.status = 'active'), 0) AS avail
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders po ON po.id = poi.po_id
      WHERE poi.product_id = v_product.id
        AND po.status IN ('ordered','shipped','in_warehouse')
      ORDER BY COALESCE(po.shipped_at, po.expected_arrival_at, po.created_at) ASC NULLS LAST
    LOOP
      EXIT WHEN v_shortfall <= 0;
      IF v_po_item.avail <= 0 THEN CONTINUE; END IF;
      v_take := LEAST(v_shortfall, v_po_item.avail);
      INSERT INTO public.invoice_po_reservations
        (invoice_id, invoice_item_id, product_id, po_id, po_item_id, quantity, status, created_by, created_by_email)
      VALUES
        (_invoice_id, _invoice_item_id, v_product.id, v_po_item.po_id, v_po_item.po_item_id, v_take, 'active', _actor_id, _actor_email);
      v_shortfall := v_shortfall - v_take;
    END LOOP;
  END IF;

  IF v_shortfall > 0 THEN
    INSERT INTO public.invoice_po_reservations
      (invoice_id, invoice_item_id, product_id, po_id, po_item_id, quantity, status, created_by, created_by_email)
    VALUES
      (_invoice_id, _invoice_item_id, v_product.id, NULL, NULL, v_shortfall, 'needs_order', _actor_id, _actor_email);
  END IF;
END;
$function$;

-- 3a) create_invoice (7-arg) — mark stock_flow and reserve after loop
CREATE OR REPLACE FUNCTION public.create_invoice(
  _customer_id uuid, _discount numeric, _notes text, _language text, _items jsonb,
  _paid_amount numeric DEFAULT NULL::numeric, _system_notes text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_email text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_receipt_no bigint;
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
  v_new_item_id uuid;
  v_engine_on boolean := public.is_flag_on('reservation_engine');
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
  ON CONFLICT (id) DO UPDATE SET receipt_seq = public.company_counters.receipt_seq + 1, updated_at = now()
  RETURNING receipt_seq INTO v_receipt_no;

  INSERT INTO public.user_counters (user_id, receipt_seq) VALUES (v_user_id, 1)
  ON CONFLICT (user_id) DO UPDATE SET receipt_seq = public.user_counters.receipt_seq + 1, updated_at = now();

  v_invoice_number := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_receipt_no::text, 5, '0');

  INSERT INTO public.invoices (
    user_id, invoice_number, receipt_number, customer_id, customer_name, customer_phone, customer_address,
    subtotal, discount, total, notes, system_notes, language, status, created_by, created_by_email, stock_flow
  ) VALUES (
    v_user_id, v_invoice_number, v_receipt_no, v_cust_id, v_cust_name, v_cust_phone, v_cust_address,
    0, v_discount, 0, NULLIF(_notes,''), NULLIF(_system_notes,''), COALESCE(_language,'ar'), 'completed',
    v_user_id, v_actor_email, CASE WHEN v_engine_on THEN 'reservation' ELSE 'immediate' END
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    v_item_discount := COALESCE((v_item->>'discount')::numeric, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023'; END IF;
    IF v_item_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

    IF (v_item->>'product_id') IS NOT NULL AND (v_item->>'product_id') <> '' THEN
      SELECT id, name, price, stock_quantity, serial_number, color, user_id INTO v_product
      FROM public.products WHERE id = (v_item->>'product_id')::uuid AND public.can_access_user_data(user_id) FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PRODUCT' USING ERRCODE = '22023'; END IF;

      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_product.price, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_serial_number := NULLIF(v_item->>'serial_number', '');
      v_color := NULLIF(v_item->>'color', '');
      v_product_name := COALESCE(NULLIF(v_item->>'product_name', ''), v_product.name, 'Item');
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (v_invoice_id, v_product.id, v_product_name, v_serial_number, COALESCE(v_color, v_product.color), v_qty, v_unit_price, v_item_discount, v_line_total)
      RETURNING id INTO v_new_item_id;

      PERFORM public.cover_invoice_item(v_invoice_id, v_new_item_id, v_product.id, v_qty, v_user_id, v_actor_email, 'sale', v_invoice_number);
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
  IF _paid_amount IS NULL THEN v_paid := 0; ELSE v_paid := GREATEST(0, LEAST(_paid_amount, v_total)); END IF;

  UPDATE public.invoices SET subtotal = v_subtotal, discount = v_discount, total = v_total, paid_amount = v_paid WHERE id = v_invoice_id;

  IF v_paid > 0 THEN
    INSERT INTO public.payments (invoice_id, user_id, amount, method, notes, paid_at, created_by, created_by_email)
    VALUES (v_invoice_id, v_user_id, v_paid, 'cash', 'دفعة أولى عند إنشاء الفاتورة', now(), v_user_id, v_actor_email);
  END IF;

  -- Reservation engine: set reserved_qty per line + auto-shortage on deficit
  IF v_engine_on THEN
    PERFORM public.reserve_invoice_items(v_invoice_id);
  END IF;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (v_invoice_id, v_user_id, 'created',
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(_items),
                       'receipt_no', v_receipt_no, 'actor_email', v_actor_email, 'paid_amount', v_paid,
                       'stock_flow', CASE WHEN v_engine_on THEN 'reservation' ELSE 'immediate' END));

  RETURN v_invoice_id;
END;
$function$;

-- 3b) create_invoice (10-arg) — same behavior with sales_channel/event/category
CREATE OR REPLACE FUNCTION public.create_invoice(
  _customer_id uuid, _discount numeric, _notes text, _language text, _items jsonb,
  _paid_amount numeric DEFAULT NULL::numeric, _system_notes text DEFAULT NULL::text,
  _sales_channel text DEFAULT NULL::text, _sales_event_id uuid DEFAULT NULL::uuid,
  _customer_category text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_email text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_receipt_no bigint;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_discount numeric := COALESCE(_discount, 0);
  v_paid numeric;
  v_cust_id uuid := NULL;
  v_cust_name text := NULL;
  v_cust_phone text := NULL;
  v_cust_address text := NULL;
  v_cust_category text := NULL;
  v_item jsonb;
  v_product record;
  v_qty int;
  v_unit_price numeric;
  v_item_discount numeric;
  v_line_total numeric;
  v_serial_number text;
  v_color text;
  v_product_name text;
  v_new_item_id uuid;
  v_engine_on boolean := public.is_flag_on('reservation_engine');
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'NO_ITEMS' USING ERRCODE = '22023'; END IF;
  IF v_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_user_id;

  IF _customer_id IS NOT NULL THEN
    SELECT id, name, phone, address, category
      INTO v_cust_id, v_cust_name, v_cust_phone, v_cust_address, v_cust_category
    FROM public.customers WHERE id = _customer_id AND public.can_access_user_data(user_id);
    IF v_cust_id IS NULL THEN RAISE EXCEPTION 'INVALID_CUSTOMER' USING ERRCODE = '22023'; END IF;
  END IF;

  INSERT INTO public.company_counters (id, receipt_seq) VALUES ('default', 1)
  ON CONFLICT (id) DO UPDATE SET receipt_seq = public.company_counters.receipt_seq + 1, updated_at = now()
  RETURNING receipt_seq INTO v_receipt_no;

  INSERT INTO public.user_counters (user_id, receipt_seq) VALUES (v_user_id, 1)
  ON CONFLICT (user_id) DO UPDATE SET receipt_seq = public.user_counters.receipt_seq + 1, updated_at = now();

  v_invoice_number := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_receipt_no::text, 5, '0');

  INSERT INTO public.invoices (
    user_id, invoice_number, receipt_number, customer_id, customer_name, customer_phone, customer_address,
    customer_category, sales_channel, sales_event_id,
    subtotal, discount, total, notes, system_notes, language, status, created_by, created_by_email, stock_flow
  ) VALUES (
    v_user_id, v_invoice_number, v_receipt_no, v_cust_id, v_cust_name, v_cust_phone, v_cust_address,
    COALESCE(NULLIF(_customer_category,''), v_cust_category), NULLIF(_sales_channel,''), _sales_event_id,
    0, v_discount, 0, NULLIF(_notes,''), NULLIF(_system_notes,''), COALESCE(_language,'ar'), 'completed',
    v_user_id, v_actor_email, CASE WHEN v_engine_on THEN 'reservation' ELSE 'immediate' END
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    v_item_discount := COALESCE((v_item->>'discount')::numeric, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023'; END IF;
    IF v_item_discount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023'; END IF;

    IF (v_item->>'product_id') IS NOT NULL AND (v_item->>'product_id') <> '' THEN
      SELECT id, name, price, stock_quantity, serial_number, color, user_id INTO v_product
      FROM public.products WHERE id = (v_item->>'product_id')::uuid AND public.can_access_user_data(user_id) FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PRODUCT' USING ERRCODE = '22023'; END IF;

      v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_product.price, 0);
      IF v_unit_price < 0 THEN v_unit_price := 0; END IF;
      v_serial_number := NULLIF(v_item->>'serial_number', '');
      v_color := NULLIF(v_item->>'color', '');
      v_product_name := COALESCE(NULLIF(v_item->>'product_name', ''), v_product.name, 'Item');
      v_line_total := (v_unit_price * v_qty) - v_item_discount;
      IF v_line_total < 0 THEN v_line_total := 0; END IF;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, serial_number, color, quantity, unit_price, discount, line_total)
      VALUES (v_invoice_id, v_product.id, v_product_name, v_serial_number, COALESCE(v_color, v_product.color), v_qty, v_unit_price, v_item_discount, v_line_total)
      RETURNING id INTO v_new_item_id;

      PERFORM public.cover_invoice_item(v_invoice_id, v_new_item_id, v_product.id, v_qty, v_user_id, v_actor_email, 'sale', v_invoice_number);
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
  IF _paid_amount IS NULL THEN v_paid := 0; ELSE v_paid := GREATEST(0, LEAST(_paid_amount, v_total)); END IF;

  UPDATE public.invoices SET subtotal = v_subtotal, discount = v_discount, total = v_total, paid_amount = v_paid WHERE id = v_invoice_id;

  IF v_paid > 0 THEN
    INSERT INTO public.payments (invoice_id, user_id, amount, method, notes, paid_at, created_by, created_by_email)
    VALUES (v_invoice_id, v_user_id, v_paid, 'cash', 'دفعة أولى عند إنشاء الفاتورة', now(), v_user_id, v_actor_email);
  END IF;

  IF v_engine_on THEN
    PERFORM public.reserve_invoice_items(v_invoice_id);
  END IF;

  INSERT INTO public.invoice_events (invoice_id, user_id, event_type, details)
  VALUES (v_invoice_id, v_user_id, 'created',
    jsonb_build_object('total', v_total, 'items', jsonb_array_length(_items),
                       'receipt_no', v_receipt_no, 'actor_email', v_actor_email, 'paid_amount', v_paid,
                       'stock_flow', CASE WHEN v_engine_on THEN 'reservation' ELSE 'immediate' END));

  RETURN v_invoice_id;
END;
$function$;

-- 4) delete_invoice: differentiate by stock_flow
CREATE OR REPLACE FUNCTION public.delete_invoice(_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_email text;
  v_invoice record;
  v_item record;
  v_restore int;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = _invoice_id AND public.can_access_user_data(user_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = '22023'; END IF;

  IF v_invoice.status <> 'voided' THEN
    FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
      IF v_item.product_id IS NOT NULL THEN
        IF v_invoice.stock_flow = 'reservation' THEN
          v_restore := COALESCE(v_item.delivered_qty, 0);
        ELSE
          v_restore := v_item.quantity;
        END IF;
        IF v_restore > 0 THEN
          PERFORM 1 FROM public.products WHERE id = v_item.product_id FOR UPDATE;
          UPDATE public.products SET stock_quantity = stock_quantity + v_restore WHERE id = v_item.product_id;
          INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id, actor_id, actor_email)
          SELECT p.user_id, v_item.product_id, v_restore, 'delete ' || v_invoice.invoice_number, _invoice_id, v_user_id, v_actor_email
          FROM public.products p WHERE p.id = v_item.product_id;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Release any active reservations (clears reserved_qty via trigger)
  PERFORM public.release_invoice_reservation(_invoice_id);

  INSERT INTO public.audit_log (actor_id, actor_email, entity_type, entity_id, action, details)
  VALUES (v_user_id, v_actor_email, 'invoices', _invoice_id, 'deleted',
          jsonb_build_object('invoice_number', v_invoice.invoice_number,
                             'total', v_invoice.total,
                             'customer_name', v_invoice.customer_name,
                             'stock_flow', v_invoice.stock_flow));

  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;
  DELETE FROM public.invoices WHERE id = _invoice_id;

  RETURN _invoice_id;
END;
$function$;

-- 5) convert_invoice_to_draft: differentiate by stock_flow
CREATE OR REPLACE FUNCTION public.convert_invoice_to_draft(_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_invoice record;
  v_item record;
  v_restore int;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = _invoice_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF v_invoice.status = 'draft' THEN RETURN _invoice_id; END IF;
  IF v_invoice.status = 'voided' THEN RAISE EXCEPTION 'CANNOT_CONVERT_VOIDED' USING ERRCODE = '22023'; END IF;

  FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      IF v_invoice.stock_flow = 'reservation' THEN
        v_restore := COALESCE(v_item.delivered_qty, 0);
      ELSE
        v_restore := v_item.quantity;
      END IF;
      IF v_restore > 0 THEN
        PERFORM 1 FROM public.products WHERE id = v_item.product_id FOR UPDATE;
        UPDATE public.products SET stock_quantity = stock_quantity + v_restore WHERE id = v_item.product_id;
        INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id)
        VALUES (v_user_id, v_item.product_id, v_restore, 'convert-to-draft ' || v_invoice.invoice_number, _invoice_id);
      END IF;
    END IF;
  END LOOP;

  -- Also reset delivered/reserved accounting so the invoice truly returns to draft.
  UPDATE public.invoice_items
     SET delivered_qty = 0, reserved_qty = 0
   WHERE invoice_id = _invoice_id;

  UPDATE public.invoices SET status = 'draft', updated_at = now() WHERE id = _invoice_id;
  RETURN _invoice_id;
END;
$function$;

-- 6) Auto-release reservations when invoice cancelled/voided
CREATE OR REPLACE FUNCTION public.tg_release_on_status_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('cancelled','voided','draft') THEN
    PERFORM public.release_invoice_reservation(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_on_status_change ON public.invoices;
CREATE TRIGGER trg_release_on_status_change
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_release_on_status_change();

-- 7) Flip the reservation engine ON
INSERT INTO public.system_flags(key, value, updated_at)
VALUES ('reservation_engine', true, now())
ON CONFLICT (key) DO UPDATE SET value = true, updated_at = now();

-- 8) Re-run reservation for all live (non-archived/non-voided) invoices to normalize state
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM public.invoices
    WHERE status NOT IN ('voided','cancelled','archived','draft')
  LOOP
    PERFORM public.reserve_invoice_items(r.id);
  END LOOP;
END $$;
