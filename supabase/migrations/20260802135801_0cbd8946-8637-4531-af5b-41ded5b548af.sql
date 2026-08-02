CREATE OR REPLACE FUNCTION public.get_inventory_tracker()
RETURNS TABLE(
  product_id uuid,
  product_name text,
  serial_number text,
  color text,
  collection text,
  image_url text,
  is_spare_part boolean,
  stock_quantity integer,
  reserved_quantity integer,
  available_quantity integer,
  out_for_delivery_qty bigint,
  incoming_qty bigint,
  delivered_qty bigint,
  sold_qty bigint,
  open_demand_qty bigint,
  shortage_qty bigint,
  net_after_incoming bigint,
  low_stock_threshold integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH ofd AS (
    SELECT ii.product_id, SUM(dri.quantity)::bigint AS qty
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    JOIN public.invoice_items ii ON ii.id = dri.invoice_item_id
    WHERE COALESCE(dr.status,'') = 'out_for_delivery'
      AND ii.product_id IS NOT NULL
    GROUP BY ii.product_id
  ),
  delivered AS (
    SELECT ii.product_id, SUM(dri.quantity)::bigint AS qty
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    JOIN public.invoice_items ii ON ii.id = dri.invoice_item_id
    WHERE COALESCE(dr.status,'') = 'signed'
      AND ii.product_id IS NOT NULL
    GROUP BY ii.product_id
  ),
  incoming AS (
    SELECT poi.product_id,
           SUM(GREATEST(0, poi.quantity - COALESCE(poi.received_qty,0)))::bigint AS qty
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.po_id
    WHERE COALESCE(po.status,'') NOT IN ('received','cancelled','draft')
    GROUP BY poi.product_id
  ),
  sold AS (
    SELECT ii.product_id, SUM(ii.quantity)::bigint AS qty
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE ii.product_id IS NOT NULL
      AND COALESCE(i.status,'') NOT IN ('voided','cancelled','draft')
    GROUP BY ii.product_id
  ),
  open_demand AS (
    SELECT ii.product_id, SUM(ii.quantity)::bigint AS qty
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE ii.product_id IS NOT NULL
      AND public.is_invoice_shortage_eligible(i.status, i.delivery_status)
    GROUP BY ii.product_id
  )
  SELECT
    p.id,
    p.name,
    p.serial_number,
    p.color,
    p.collection,
    p.image_url,
    p.is_spare_part,
    COALESCE(p.stock_quantity,0),
    COALESCE(p.reserved_quantity,0),
    COALESCE(p.available_quantity, COALESCE(p.stock_quantity,0) - COALESCE(p.reserved_quantity,0)),
    COALESCE(o.qty,0),
    COALESCE(inc.qty,0),
    COALESCE(dl.qty,0),
    COALESCE(s.qty,0),
    COALESCE(od.qty,0),
    GREATEST(0, COALESCE(p.reserved_quantity,0) - COALESCE(p.stock_quantity,0))::bigint,
    (COALESCE(p.stock_quantity,0) - COALESCE(p.reserved_quantity,0) + COALESCE(inc.qty,0))::bigint,
    COALESCE(p.low_stock_threshold,0)
  FROM public.products p
  LEFT JOIN ofd o ON o.product_id = p.id
  LEFT JOIN delivered dl ON dl.product_id = p.id
  LEFT JOIN incoming inc ON inc.product_id = p.id
  LEFT JOIN sold s ON s.product_id = p.id
  LEFT JOIN open_demand od ON od.product_id = p.id
  WHERE public.can_access_user_data(p.user_id)
  ORDER BY p.serial_number NULLS LAST, p.name;
$function$;

REVOKE ALL ON FUNCTION public.get_inventory_tracker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inventory_tracker() TO authenticated;