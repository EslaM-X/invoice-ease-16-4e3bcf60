
-- 1) Add weight columns
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS weight_grams numeric;
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS unit_weight_grams numeric;

-- 2) Backfill PO item snapshots from products
UPDATE public.purchase_order_items poi
SET unit_weight_grams = p.weight_grams
FROM public.products p
WHERE poi.product_id = p.id AND poi.unit_weight_grams IS NULL AND p.weight_grams IS NOT NULL;

-- 3) Rebuild cost book RPC: shipping by weight, customs/taxes/other by USD value
CREATE OR REPLACE FUNCTION public.get_product_cost_book(p_fy_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_fy_end timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_default_rate numeric;
  v_result jsonb;
BEGIN
  IF NOT public.is_company_member() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT COALESCE(MAX(dashboard_usd_rate), 50) INTO v_default_rate FROM public.settings;

  WITH po_items AS (
    SELECT
      poi.po_id,
      poi.product_id,
      poi.quantity::numeric AS qty,
      poi.unit_cost_usd::numeric AS unit_usd,
      COALESCE(poi.unit_weight_grams, p.weight_grams, 0)::numeric AS unit_weight_g,
      COALESCE(po.usd_rate, v_default_rate)::numeric AS usd_rate,
      po.shipment_code, po.shipment_date, po.status,
      po.po_number,
      po.customs_mode, COALESCE(po.customs_value,0)::numeric AS customs_value,
      po.taxes_mode,   COALESCE(po.taxes_value,0)::numeric   AS taxes_value,
      po.shipping_mode,COALESCE(po.shipping_value,0)::numeric AS shipping_value,
      po.other_mode,   COALESCE(po.other_value,0)::numeric   AS other_value
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.po_id
    LEFT JOIN public.products p ON p.id = poi.product_id
    WHERE po.status IN ('priced','partially_received','received','in_warehouse','closed')
      AND poi.quantity > 0
      AND (p_fy_start IS NULL OR po.shipment_date >= p_fy_start)
      AND (p_fy_end   IS NULL OR po.shipment_date <  p_fy_end)
  ),
  po_totals AS (
    SELECT
      po_id,
      SUM(qty*unit_usd) AS base_usd,
      SUM(qty)          AS total_qty,
      SUM(qty*unit_weight_g) AS total_weight_g
    FROM po_items
    GROUP BY po_id
  ),
  po_overheads AS (
    SELECT
      pi.po_id,
      pi.usd_rate,
      pt.base_usd,
      pt.total_qty,
      pt.total_weight_g,
      (pt.base_usd * pi.usd_rate) AS base_egp,
      CASE WHEN pi.customs_mode  = 'percent' THEN (pt.base_usd * pi.usd_rate) * pi.customs_value  / 100.0 ELSE pi.customs_value  END AS customs_egp,
      CASE WHEN pi.taxes_mode    = 'percent' THEN (pt.base_usd * pi.usd_rate) * pi.taxes_value    / 100.0 ELSE pi.taxes_value    END AS taxes_egp,
      CASE WHEN pi.shipping_mode = 'percent' THEN (pt.base_usd * pi.usd_rate) * pi.shipping_value / 100.0 ELSE pi.shipping_value END AS shipping_egp,
      CASE WHEN pi.other_mode    = 'percent' THEN (pt.base_usd * pi.usd_rate) * pi.other_value    / 100.0 ELSE pi.other_value    END AS other_egp
    FROM (SELECT DISTINCT po_id, usd_rate, customs_mode, customs_value, taxes_mode, taxes_value, shipping_mode, shipping_value, other_mode, other_value FROM po_items) pi
    JOIN po_totals pt ON pt.po_id = pi.po_id
  ),
  lots AS (
    SELECT
      pi.product_id,
      pi.qty,
      pi.unit_usd,
      pi.unit_weight_g,
      pi.usd_rate,
      (pi.unit_usd * pi.usd_rate) AS unit_egp,
      pi.po_id, pi.po_number, pi.shipment_code, pi.shipment_date, pi.status,
      ov.customs_egp, ov.taxes_egp, ov.shipping_egp, ov.other_egp,
      -- value_share: for customs/taxes/other
      CASE
        WHEN ov.base_usd > 0 THEN (pi.qty * pi.unit_usd) / ov.base_usd
        WHEN ov.total_qty > 0 THEN pi.qty / ov.total_qty
        ELSE 0
      END AS value_share,
      -- weight_share: for shipping — fallback to value_share if no weights recorded
      CASE
        WHEN ov.total_weight_g > 0 THEN (pi.qty * pi.unit_weight_g) / ov.total_weight_g
        WHEN ov.base_usd > 0 THEN (pi.qty * pi.unit_usd) / ov.base_usd
        WHEN ov.total_qty > 0 THEN pi.qty / ov.total_qty
        ELSE 0
      END AS weight_share
    FROM po_items pi
    JOIN po_overheads ov ON ov.po_id = pi.po_id
  ),
  lots_calc AS (
    SELECT
      l.*,
      -- line_share kept for backward-compat (used by client to reconstruct per-line overheads)
      l.value_share AS line_share,
      (l.customs_egp + l.taxes_egp + l.shipping_egp + l.other_egp) AS overheads_egp,
      (l.qty * l.unit_usd * l.usd_rate) AS raw_line_egp,
      (l.qty * l.unit_usd * l.usd_rate)
        + (l.value_share  * (l.customs_egp + l.taxes_egp + l.other_egp))
        + (l.weight_share * l.shipping_egp) AS landed_line_egp
    FROM lots l
  ),
  lots_full AS (
    SELECT
      lc.*,
      CASE WHEN lc.qty > 0 THEN lc.landed_line_egp / lc.qty ELSE 0 END AS landed_unit_egp,
      CASE WHEN lc.qty > 0 AND lc.usd_rate > 0 THEN (lc.landed_line_egp / lc.qty) / lc.usd_rate ELSE 0 END AS landed_unit_usd
    FROM lots_calc lc
  ),
  per_product AS (
    SELECT
      product_id,
      SUM(qty) AS total_qty,
      CASE WHEN SUM(qty)>0 THEN SUM(qty*unit_usd)/SUM(qty) ELSE 0 END AS wac_usd,
      CASE WHEN SUM(qty)>0 THEN SUM(qty*unit_egp)/SUM(qty) ELSE 0 END AS wac_egp,
      CASE WHEN SUM(qty)>0 THEN SUM(landed_line_egp)/SUM(qty) ELSE 0 END AS wac_landed_egp,
      CASE WHEN SUM(qty)>0 AND SUM(qty*usd_rate)>0
           THEN SUM(landed_line_egp) / SUM(qty*usd_rate)
           ELSE 0 END AS wac_landed_usd,
      SUM(landed_line_egp) AS total_landed_egp,
      MIN(unit_usd) AS min_usd,
      MAX(unit_usd) AS max_usd,
      (ARRAY_AGG(unit_usd ORDER BY shipment_date DESC))[1] AS latest_usd,
      (ARRAY_AGG(unit_egp ORDER BY shipment_date DESC))[1] AS latest_egp,
      jsonb_agg(
        jsonb_build_object(
          'po_id', po_id,
          'po_number', po_number,
          'shipment_code', shipment_code,
          'shipment_date', shipment_date,
          'status', status,
          'qty', qty,
          'unit_usd', unit_usd,
          'unit_weight_g', unit_weight_g,
          'usd_rate', usd_rate,
          'unit_egp', unit_egp,
          'line_total_egp', qty * unit_egp,
          'customs_egp', customs_egp,
          'taxes_egp', taxes_egp,
          'shipping_egp', shipping_egp,
          'other_egp', other_egp,
          'overheads_egp', overheads_egp,
          'line_share', line_share,
          'value_share', value_share,
          'weight_share', weight_share,
          'landed_unit_usd', landed_unit_usd,
          'landed_unit_egp', landed_unit_egp,
          'landed_line_egp', landed_line_egp
        ) ORDER BY shipment_date ASC
      ) AS lots
    FROM lots_full
    GROUP BY product_id
  )
  SELECT jsonb_build_object(
    'default_rate', v_default_rate,
    'products', COALESCE(jsonb_object_agg(product_id::text, jsonb_build_object(
      'total_qty', total_qty,
      'wac_usd', wac_usd,
      'wac_egp', wac_egp,
      'wac_landed_usd', wac_landed_usd,
      'wac_landed_egp', wac_landed_egp,
      'total_landed_egp', total_landed_egp,
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
$function$;
