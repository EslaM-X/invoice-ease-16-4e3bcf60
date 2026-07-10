
-- 1) Manual per-product cost overrides (Profits page only)
CREATE TABLE IF NOT EXISTS public.profit_cost_overrides (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  cost_egp numeric NOT NULL DEFAULT 0,
  note text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profit_cost_overrides TO authenticated;
GRANT ALL ON public.profit_cost_overrides TO service_role;

ALTER TABLE public.profit_cost_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pco read" ON public.profit_cost_overrides;
CREATE POLICY "pco read" ON public.profit_cost_overrides
  FOR SELECT TO authenticated
  USING (public.is_company_member());

DROP POLICY IF EXISTS "pco write" ON public.profit_cost_overrides;
CREATE POLICY "pco write" ON public.profit_cost_overrides
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS trg_pco_updated_at ON public.profit_cost_overrides;
CREATE TRIGGER trg_pco_updated_at
  BEFORE UPDATE ON public.profit_cost_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Cost book RPC — weighted-average cost per product, in USD & EGP
CREATE OR REPLACE FUNCTION public.get_product_cost_book(
  p_fy_start timestamptz DEFAULT NULL,
  p_fy_end   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default_rate numeric;
  v_result jsonb;
BEGIN
  IF NOT public.is_company_member() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT COALESCE(MAX(dashboard_usd_rate), 50) INTO v_default_rate FROM public.settings;

  WITH lots AS (
    SELECT
      poi.product_id,
      poi.quantity::numeric AS qty,
      poi.unit_cost_usd::numeric AS unit_usd,
      COALESCE(po.usd_rate, v_default_rate)::numeric AS usd_rate,
      (poi.unit_cost_usd * COALESCE(po.usd_rate, v_default_rate))::numeric AS unit_egp,
      po.id AS po_id,
      po.shipment_code,
      po.shipment_date,
      po.status
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.po_id
    WHERE po.status IN ('priced','partially_received','received','in_warehouse','closed')
      AND poi.quantity > 0
      AND (p_fy_start IS NULL OR po.shipment_date >= p_fy_start)
      AND (p_fy_end   IS NULL OR po.shipment_date <  p_fy_end)
  ),
  per_product AS (
    SELECT
      product_id,
      SUM(qty) AS total_qty,
      CASE WHEN SUM(qty) > 0 THEN SUM(qty*unit_usd)/SUM(qty) ELSE 0 END AS wac_usd,
      CASE WHEN SUM(qty) > 0 THEN SUM(qty*unit_egp)/SUM(qty) ELSE 0 END AS wac_egp,
      MIN(unit_usd) AS min_usd,
      MAX(unit_usd) AS max_usd,
      (ARRAY_AGG(unit_usd ORDER BY shipment_date DESC))[1] AS latest_usd,
      (ARRAY_AGG(unit_egp ORDER BY shipment_date DESC))[1] AS latest_egp,
      jsonb_agg(
        jsonb_build_object(
          'po_id', po_id,
          'shipment_code', shipment_code,
          'shipment_date', shipment_date,
          'status', status,
          'qty', qty,
          'unit_usd', unit_usd,
          'usd_rate', usd_rate,
          'unit_egp', unit_egp,
          'line_total_egp', qty * unit_egp
        ) ORDER BY shipment_date ASC
      ) AS lots
    FROM lots
    GROUP BY product_id
  )
  SELECT jsonb_build_object(
    'default_rate', v_default_rate,
    'products', COALESCE(jsonb_object_agg(product_id::text, jsonb_build_object(
      'total_qty', total_qty,
      'wac_usd', wac_usd,
      'wac_egp', wac_egp,
      'min_usd', min_usd,
      'max_usd', max_usd,
      'latest_usd', latest_usd,
      'latest_egp', latest_egp,
      'lots', lots
    )), '{}'::jsonb)
  )
  INTO v_result
  FROM per_product;

  RETURN COALESCE(v_result, jsonb_build_object('default_rate', v_default_rate, 'products', '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.get_product_cost_book(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_cost_book(timestamptz, timestamptz) TO authenticated;
