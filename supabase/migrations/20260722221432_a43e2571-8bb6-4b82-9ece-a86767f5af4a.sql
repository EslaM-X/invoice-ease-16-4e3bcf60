
CREATE OR REPLACE FUNCTION public.get_inventory_shortage_alerts()
RETURNS TABLE(
  product_id uuid,
  product_name text,
  serial_number text,
  color text,
  collection text,
  image_url text,
  is_spare_part boolean,
  stock_quantity integer,
  incoming_qty bigint,
  needed_qty bigint,
  from_stock bigint,
  from_incoming bigint,
  net_shortage bigint,
  severity text,
  sources jsonb,
  incoming_pos jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH needs_by_invoice AS (
    SELECT
      ar.product_id,
      ar.invoice_id,
      ar.invoice_number,
      ar.customer_name,
      ar.created_at,
      SUM(ar.reserved_qty)::bigint AS qty
    FROM public.get_active_invoice_reservations() ar
    GROUP BY ar.product_id, ar.invoice_id, ar.invoice_number, ar.customer_name, ar.created_at
  ),
  per_product AS (
    SELECT
      n.product_id,
      SUM(n.qty)::bigint AS needed_qty,
      jsonb_agg(jsonb_build_object(
        'invoice_id', n.invoice_id,
        'invoice_number', n.invoice_number,
        'customer_name', n.customer_name,
        'reserved_qty', n.qty,
        'quantity', n.qty,
        'created_at', n.created_at,
        'status', i.status,
        'delivery_status', i.delivery_status
      ) ORDER BY n.created_at) AS sources
    FROM needs_by_invoice n
    JOIN public.invoices i ON i.id = n.invoice_id
    GROUP BY n.product_id
  ),
  incoming_per_po AS (
    SELECT
      poi.product_id,
      po.id AS po_id,
      po.po_number,
      po.supplier_name,
      po.status,
      po.shipment_code,
      po.expected_arrival_at,
      GREATEST(0, COALESCE(poi.quantity,0) - COALESCE(poi.received_qty,0))::bigint AS qty
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.po_id
    WHERE po.status IN ('ordered','shipped','in_warehouse')
      AND GREATEST(0, COALESCE(poi.quantity,0) - COALESCE(poi.received_qty,0)) > 0
  ),
  incoming AS (
    SELECT
      ip.product_id,
      SUM(ip.qty)::bigint AS incoming_qty,
      jsonb_agg(jsonb_build_object(
        'po_id', ip.po_id,
        'po_number', ip.po_number,
        'supplier_name', ip.supplier_name,
        'status', ip.status,
        'shipment_code', ip.shipment_code,
        'expected_arrival_at', ip.expected_arrival_at,
        'qty', ip.qty
      ) ORDER BY ip.expected_arrival_at NULLS LAST) AS incoming_pos
    FROM incoming_per_po ip
    GROUP BY ip.product_id
  )
  SELECT
    p.id,
    p.name,
    p.serial_number,
    p.color,
    p.collection,
    p.image_url,
    p.is_spare_part,
    COALESCE(p.stock_quantity, 0),
    COALESCE(inc.incoming_qty, 0),
    pp.needed_qty,
    LEAST(pp.needed_qty, COALESCE(p.stock_quantity, 0))::bigint AS from_stock,
    LEAST(
      GREATEST(0::bigint, pp.needed_qty - COALESCE(p.stock_quantity, 0)::bigint),
      COALESCE(inc.incoming_qty, 0)
    )::bigint AS from_incoming,
    GREATEST(0::bigint, pp.needed_qty - (COALESCE(p.stock_quantity,0)::bigint + COALESCE(inc.incoming_qty,0)))::bigint AS net_shortage,
    CASE
      WHEN COALESCE(p.stock_quantity,0) = 0 AND COALESCE(inc.incoming_qty,0) = 0 THEN 'critical'
      WHEN pp.needed_qty > (COALESCE(p.stock_quantity,0)::bigint + COALESCE(inc.incoming_qty,0)) THEN 'shortfall'
      WHEN pp.needed_qty > COALESCE(p.stock_quantity,0) THEN 'awaiting'
      ELSE 'covered'
    END AS severity,
    pp.sources,
    COALESCE(inc.incoming_pos, '[]'::jsonb) AS incoming_pos
  FROM per_product pp
  JOIN public.products p ON p.id = pp.product_id
  LEFT JOIN incoming inc ON inc.product_id = pp.product_id
  WHERE pp.needed_qty > COALESCE(p.stock_quantity, 0)
  ORDER BY
    CASE
      WHEN COALESCE(p.stock_quantity,0) = 0 AND COALESCE(inc.incoming_qty,0) = 0 THEN 0
      WHEN pp.needed_qty > (COALESCE(p.stock_quantity,0)::bigint + COALESCE(inc.incoming_qty,0)) THEN 1
      ELSE 2
    END,
    GREATEST(0::bigint, pp.needed_qty - (COALESCE(p.stock_quantity,0)::bigint + COALESCE(inc.incoming_qty,0))) DESC,
    pp.needed_qty DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_inventory_shortage_alerts() TO authenticated;
