
-- 1) Per-distributor visible-stock overrides
CREATE TABLE IF NOT EXISTS public.distributor_stock_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id uuid NOT NULL REFERENCES public.distributors(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  visible_qty integer,
  visible_pct numeric,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS distributor_stock_overrides_unique
  ON public.distributor_stock_overrides (distributor_id, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.distributor_stock_overrides TO authenticated;
GRANT ALL ON public.distributor_stock_overrides TO service_role;
ALTER TABLE public.distributor_stock_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage stock overrides" ON public.distributor_stock_overrides;
CREATE POLICY "admins manage stock overrides" ON public.distributor_stock_overrides
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "distributors read own overrides" ON public.distributor_stock_overrides;
CREATE POLICY "distributors read own overrides" ON public.distributor_stock_overrides
  FOR SELECT TO authenticated USING (
    distributor_id IN (SELECT id FROM public.distributors WHERE user_id = auth.uid())
  );

DROP TRIGGER IF EXISTS trg_dso_updated_at ON public.distributor_stock_overrides;
CREATE TRIGGER trg_dso_updated_at BEFORE UPDATE ON public.distributor_stock_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Distributor catalog: subtract distributor's reserved units + apply visibility overrides
CREATE OR REPLACE FUNCTION public.list_distributor_products()
RETURNS TABLE (
  id uuid, name text, serial_number text, color text, price numeric,
  image_url text, collection text, is_spare_part boolean, parent_product_id uuid,
  low_stock_threshold integer, available_stock integer,
  updated_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_dist_id uuid;
BEGIN
  IF NOT public.is_distributor() THEN RETURN; END IF;
  SELECT d.id INTO v_dist_id FROM public.distributors d WHERE d.user_id = auth.uid() LIMIT 1;
  IF v_dist_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH reserved AS (
    SELECT ii.product_id, SUM(ii.quantity)::int AS reserved_qty
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE i.distributor_id = v_dist_id
      AND COALESCE(i.status,'') <> 'cancelled'
      AND COALESCE(i.delivery_status,'') <> 'delivered'
    GROUP BY ii.product_id
  ),
  global_ov AS (
    SELECT visible_qty, visible_pct FROM public.distributor_stock_overrides
    WHERE distributor_id = v_dist_id AND product_id IS NULL LIMIT 1
  )
  SELECT
    p.id, p.name, p.serial_number, p.color, p.price, p.image_url, p.collection,
    p.is_spare_part, p.parent_product_id, p.low_stock_threshold,
    GREATEST(0, LEAST(
      GREATEST(COALESCE(p.stock_quantity,0) - COALESCE(p.safety_margin,0) - COALESCE(r.reserved_qty,0), 0),
      COALESCE(
        po.visible_qty,
        CASE WHEN po.visible_pct IS NOT NULL THEN
          FLOOR(GREATEST(COALESCE(p.stock_quantity,0) - COALESCE(p.safety_margin,0),0) * po.visible_pct / 100.0)::int
        END,
        (SELECT visible_qty FROM global_ov),
        CASE WHEN (SELECT visible_pct FROM global_ov) IS NOT NULL THEN
          FLOOR(GREATEST(COALESCE(p.stock_quantity,0) - COALESCE(p.safety_margin,0),0) * (SELECT visible_pct FROM global_ov) / 100.0)::int
        END,
        2147483647
      )
    ))::int AS available_stock,
    p.updated_at, p.created_at
  FROM public.products p
  LEFT JOIN reserved r ON r.product_id = p.id
  LEFT JOIN public.distributor_stock_overrides po
         ON po.distributor_id = v_dist_id AND po.product_id = p.id;
END;
$$;
REVOKE ALL ON FUNCTION public.list_distributor_products() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_distributor_products() TO authenticated;

-- 3) approve_distributor_invoice: accept optional category + event, persist to invoice & customer
DROP FUNCTION IF EXISTS public.approve_distributor_invoice(uuid, numeric, text);
CREATE OR REPLACE FUNCTION public.approve_distributor_invoice(
  _invoice_id uuid,
  _discount_pct numeric DEFAULT 0,
  _notes text DEFAULT NULL,
  _customer_category text DEFAULT NULL,
  _sales_event_id uuid DEFAULT NULL
)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv public.invoices;
  v_dist_user uuid;
  v_customer_id uuid;
BEGIN
  IF NOT is_company_member() THEN RAISE EXCEPTION 'Only company members can approve invoices'; END IF;

  UPDATE public.invoices
  SET approval_status = 'approved',
      approval_discount_pct = COALESCE(_discount_pct, 0),
      distributor_commission_amount = ROUND(subtotal * COALESCE(_discount_pct,0) / 100.0, 2),
      approval_notes = _notes,
      approved_by = auth.uid(),
      approved_at = now(),
      status = 'unpaid',
      discount = 0,
      total = subtotal,
      sales_channel = COALESCE(sales_channel, 'distributor'),
      customer_category = COALESCE(_customer_category, customer_category),
      sales_event_id    = COALESCE(_sales_event_id, sales_event_id)
  WHERE id = _invoice_id AND source = 'distributor' AND approval_status = 'pending'
  RETURNING * INTO v_inv;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found or not pending'; END IF;

  IF v_inv.customer_id IS NULL AND COALESCE(NULLIF(trim(v_inv.customer_name), ''), '') <> '' THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE user_id = v_inv.user_id
      AND lower(trim(name)) = lower(trim(v_inv.customer_name))
      AND COALESCE(phone,'') = COALESCE(v_inv.customer_phone,'')
    LIMIT 1;

    IF v_customer_id IS NULL THEN
      INSERT INTO public.customers(user_id, name, phone, address, category, sales_channel, sales_event_id, source_notes)
      VALUES (v_inv.user_id, v_inv.customer_name, v_inv.customer_phone,
              COALESCE(v_inv.shipping_address, v_inv.customer_address),
              v_inv.customer_category,
              COALESCE(v_inv.sales_channel, 'distributor'),
              v_inv.sales_event_id,
              'تم إنشاؤه تلقائياً من فاتورة موزّع ' || v_inv.invoice_number)
      RETURNING id INTO v_customer_id;
    ELSE
      UPDATE public.customers
      SET address       = COALESCE(address, v_inv.shipping_address, v_inv.customer_address),
          category      = COALESCE(category, v_inv.customer_category),
          sales_channel = COALESCE(sales_channel, 'distributor'),
          sales_event_id= COALESCE(sales_event_id, v_inv.sales_event_id)
      WHERE id = v_customer_id;
    END IF;

    UPDATE public.invoices SET customer_id = v_customer_id WHERE id = v_inv.id;
    v_inv.customer_id := v_customer_id;
  END IF;

  SELECT user_id INTO v_dist_user FROM public.distributors WHERE id = v_inv.distributor_id;
  IF v_dist_user IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, body, link, meta)
    VALUES (v_dist_user, 'distributor_invoice_approved',
      'تمت الموافقة على فاتورتك',
      'فاتورة ' || v_inv.invoice_number || ' — عمولتك: ' || v_inv.distributor_commission_amount::text || ' ج.م',
      '/distributor',
      jsonb_build_object('invoice_id', v_inv.id, 'commission', v_inv.distributor_commission_amount));
  END IF;

  RETURN v_inv;
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_distributor_invoice(uuid,numeric,text,text,uuid) TO authenticated;
