
CREATE TABLE IF NOT EXISTS public.stock_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  intake_number text NOT NULL,
  supplier_name text,
  invoice_reference text,
  pricing_mode text NOT NULL DEFAULT 'per_unit',
  bulk_total numeric,
  notes text,
  total_cost numeric NOT NULL DEFAULT 0,
  total_qty integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_email text
);

CREATE TABLE IF NOT EXISTS public.stock_intake_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES public.stock_intakes(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  product_name text NOT NULL,
  serial_number text,
  color text,
  quantity integer NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  previous_cost numeric,
  previous_stock integer,
  new_avg_cost numeric,
  line_total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_intake_items_intake ON public.stock_intake_items(intake_id);
CREATE INDEX IF NOT EXISTS idx_stock_intake_items_product ON public.stock_intake_items(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_intakes_created ON public.stock_intakes(created_at DESC);

ALTER TABLE public.stock_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_intake_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company stock_intakes select" ON public.stock_intakes
  FOR SELECT TO authenticated USING (public.can_access_user_data(user_id));
CREATE POLICY "company stock_intakes insert" ON public.stock_intakes
  FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id) OR public.is_company_member());
CREATE POLICY "company stock_intakes update" ON public.stock_intakes
  FOR UPDATE TO authenticated USING (public.can_access_user_data(user_id));
CREATE POLICY "company stock_intakes delete" ON public.stock_intakes
  FOR DELETE TO authenticated USING (public.can_access_user_data(user_id));

CREATE POLICY "company stock_intake_items select" ON public.stock_intake_items
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.stock_intakes s WHERE s.id = stock_intake_items.intake_id AND public.can_access_user_data(s.user_id))
  );
CREATE POLICY "company stock_intake_items insert" ON public.stock_intake_items
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.stock_intakes s WHERE s.id = stock_intake_items.intake_id AND public.can_access_user_data(s.user_id))
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_intakes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_intake_items;

CREATE OR REPLACE FUNCTION public.record_stock_intake(
  _supplier_name text,
  _invoice_reference text,
  _pricing_mode text,
  _bulk_total numeric,
  _notes text,
  _items jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_intake_id uuid;
  v_intake_no bigint;
  v_intake_number text;
  v_item jsonb;
  v_product record;
  v_qty int;
  v_unit_cost numeric;
  v_line_total numeric;
  v_total_cost numeric := 0;
  v_total_qty int := 0;
  v_new_avg numeric;
  v_prev_value numeric;
  v_pricing text := COALESCE(NULLIF(_pricing_mode,''),'per_unit');
  v_total_units_for_bulk int := 0;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'NO_ITEMS' USING ERRCODE='22023'; END IF;
  IF v_pricing NOT IN ('per_unit','bulk') THEN RAISE EXCEPTION 'INVALID_PRICING_MODE' USING ERRCODE='22023'; END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  INSERT INTO public.company_counters (id, receipt_seq) VALUES ('stock_intake', 1)
  ON CONFLICT (id) DO UPDATE SET receipt_seq = public.company_counters.receipt_seq + 1, updated_at = now()
  RETURNING receipt_seq INTO v_intake_no;
  v_intake_number := 'IN-' || to_char(now(), 'YYYY') || '-' || lpad(v_intake_no::text, 5, '0');

  -- For bulk pricing, compute total units to spread cost
  IF v_pricing = 'bulk' THEN
    IF _bulk_total IS NULL OR _bulk_total < 0 THEN RAISE EXCEPTION 'INVALID_BULK_TOTAL' USING ERRCODE='22023'; END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
      v_total_units_for_bulk := v_total_units_for_bulk + COALESCE((v_item->>'quantity')::int, 0);
    END LOOP;
    IF v_total_units_for_bulk <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE='22023'; END IF;
  END IF;

  INSERT INTO public.stock_intakes (
    user_id, intake_number, supplier_name, invoice_reference, pricing_mode,
    bulk_total, notes, created_by, created_by_email
  ) VALUES (
    v_user_id, v_intake_number, NULLIF(_supplier_name,''), NULLIF(_invoice_reference,''),
    v_pricing, _bulk_total, NULLIF(_notes,''), v_user_id, v_email
  ) RETURNING id INTO v_intake_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE='22023'; END IF;

    SELECT * INTO v_product FROM public.products
      WHERE id = (v_item->>'product_id')::uuid AND public.can_access_user_data(user_id) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE='22023'; END IF;

    IF v_pricing = 'bulk' THEN
      v_unit_cost := ROUND(_bulk_total / v_total_units_for_bulk, 4);
    ELSE
      v_unit_cost := COALESCE((v_item->>'unit_cost')::numeric, 0);
      IF v_unit_cost < 0 THEN RAISE EXCEPTION 'INVALID_UNIT_COST' USING ERRCODE='22023'; END IF;
    END IF;

    v_line_total := ROUND(v_unit_cost * v_qty, 2);
    v_total_cost := v_total_cost + v_line_total;
    v_total_qty := v_total_qty + v_qty;

    -- Weighted average cost calculation
    v_prev_value := COALESCE(v_product.cost_price, 0) * GREATEST(v_product.stock_quantity, 0);
    IF (v_product.stock_quantity + v_qty) > 0 THEN
      v_new_avg := ROUND((v_prev_value + (v_unit_cost * v_qty)) / (GREATEST(v_product.stock_quantity, 0) + v_qty), 4);
    ELSE
      v_new_avg := v_unit_cost;
    END IF;

    INSERT INTO public.stock_intake_items (
      intake_id, product_id, product_name, serial_number, color,
      quantity, unit_cost, previous_cost, previous_stock, new_avg_cost, line_total
    ) VALUES (
      v_intake_id, v_product.id, v_product.name, v_product.serial_number, v_product.color,
      v_qty, v_unit_cost, v_product.cost_price, v_product.stock_quantity, v_new_avg, v_line_total
    );

    UPDATE public.products
       SET stock_quantity = stock_quantity + v_qty,
           cost_price = v_new_avg,
           updated_at = now(),
           updated_by = v_user_id,
           updated_by_email = v_email
     WHERE id = v_product.id;

    INSERT INTO public.inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
    VALUES (v_product.user_id, v_product.id, v_qty,
            'intake ' || v_intake_number ||
            CASE WHEN _supplier_name IS NOT NULL AND _supplier_name <> '' THEN ' · ' || _supplier_name ELSE '' END ||
            ' @ ' || v_unit_cost::text,
            v_user_id, v_email);
  END LOOP;

  UPDATE public.stock_intakes
     SET total_cost = v_total_cost, total_qty = v_total_qty
   WHERE id = v_intake_id;

  RETURN v_intake_id;
END $$;
