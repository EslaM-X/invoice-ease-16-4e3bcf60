CREATE OR REPLACE FUNCTION public.is_invoice_shortage_eligible(_status text, _delivery_status text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(_status, '') NOT IN ('draft', 'cancelled', 'voided', 'completed', 'closed', 'archived', 'paid')
     AND COALESCE(_delivery_status, '') NOT IN ('delivered', 'completed');
$function$;

CREATE OR REPLACE FUNCTION public.get_stock_shortages()
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
  net_shortage bigint,
  invoices jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH needs AS (
    SELECT r.product_id, r.invoice_id, SUM(r.quantity)::bigint AS qty
    FROM public.invoice_po_reservations r
    JOIN public.invoices i ON i.id = r.invoice_id
    WHERE r.status = 'needs_order'
      AND public.is_invoice_shortage_eligible(i.status, i.delivery_status)
      AND public.can_access_user_data(i.user_id)
    GROUP BY r.product_id, r.invoice_id
  ),
  per_product AS (
    SELECT n.product_id,
           SUM(n.qty)::bigint AS needed_qty,
           jsonb_agg(jsonb_build_object(
             'invoice_id', i.id,
             'invoice_number', i.invoice_number,
             'customer_name', i.customer_name,
             'quantity', n.qty,
             'created_at', i.created_at,
             'status', i.status,
             'delivery_status', i.delivery_status
           ) ORDER BY i.created_at) AS invoices
    FROM needs n
    JOIN public.invoices i ON i.id = n.invoice_id
    GROUP BY n.product_id
  ),
  incoming AS (
    SELECT poi.product_id,
           SUM(GREATEST(0, poi.quantity - COALESCE(poi.received_qty,0)))::bigint AS incoming_qty
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.po_id
    WHERE po.status IN ('ordered','shipped','in_warehouse')
    GROUP BY poi.product_id
  )
  SELECT p.id AS product_id,
         p.name AS product_name,
         p.serial_number,
         p.color,
         p.collection,
         p.image_url,
         p.is_spare_part,
         p.stock_quantity,
         COALESCE(inc.incoming_qty, 0) AS incoming_qty,
         pp.needed_qty,
         GREATEST(0, pp.needed_qty - COALESCE(inc.incoming_qty, 0))::bigint AS net_shortage,
         pp.invoices
  FROM per_product pp
  JOIN public.products p ON p.id = pp.product_id
  LEFT JOIN incoming inc ON inc.product_id = pp.product_id
  WHERE GREATEST(0, pp.needed_qty - COALESCE(inc.incoming_qty, 0)) > 0
  ORDER BY GREATEST(0, pp.needed_qty - COALESCE(inc.incoming_qty, 0)) DESC, pp.needed_qty DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.invoice_uncovered_shortage(_invoice_id uuid)
RETURNS TABLE(product_id uuid, product_name text, serial_number text, color text, image_url text, quantity bigint, stock_quantity integer, incoming_qty bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH invoice_gate AS (
    SELECT id
    FROM public.invoices i
    WHERE i.id = _invoice_id
      AND public.is_invoice_shortage_eligible(i.status, i.delivery_status)
      AND public.can_access_user_data(i.user_id)
  ),
  needs AS (
    SELECT r.product_id, SUM(r.quantity)::bigint AS qty
    FROM public.invoice_po_reservations r
    JOIN invoice_gate g ON g.id = r.invoice_id
    WHERE r.status = 'needs_order'
    GROUP BY r.product_id
  ),
  incoming AS (
    SELECT poi.product_id,
           SUM(GREATEST(0, poi.quantity - COALESCE(poi.received_qty, 0)))::bigint AS incoming_qty
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.po_id
    WHERE po.status IN ('ordered','shipped','in_warehouse')
    GROUP BY poi.product_id
  )
  SELECT n.product_id,
         COALESCE(p.name, n.product_id::text) AS product_name,
         p.serial_number,
         p.color,
         p.image_url,
         GREATEST(0, n.qty - COALESCE(i.incoming_qty, 0))::bigint AS quantity,
         COALESCE(p.stock_quantity, 0),
         COALESCE(i.incoming_qty, 0)
  FROM needs n
  LEFT JOIN public.products p ON p.id = n.product_id
  LEFT JOIN incoming i ON i.product_id = n.product_id
  WHERE GREATEST(0, n.qty - COALESCE(i.incoming_qty, 0)) > 0;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_missing_shortages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;

  WITH delivered_per_item AS (
    SELECT
      dri.invoice_item_id,
      LEAST(ii.quantity, COALESCE(SUM(dri.quantity), 0))::int AS delivered_qty
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    JOIN public.invoice_items ii ON ii.id = dri.invoice_item_id
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE dri.invoice_item_id IS NOT NULL
      AND COALESCE(dr.status, '') <> 'cancelled'
      AND public.is_invoice_shortage_eligible(i.status, i.delivery_status)
    GROUP BY dri.invoice_item_id, ii.quantity
  ),
  base AS (
    SELECT
      ii.id AS invoice_item_id,
      ii.invoice_id,
      ii.product_id,
      ii.quantity AS ordered_qty,
      COALESCE(d.delivered_qty, 0) AS delivered_qty,
      COALESCE((
        SELECT SUM(r.quantity)::int
        FROM public.invoice_po_reservations r
        WHERE r.invoice_item_id = ii.id
          AND r.status IN ('active','needs_order','fulfilled')
      ), 0) AS reserved_qty,
      i.user_id
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    LEFT JOIN delivered_per_item d ON d.invoice_item_id = ii.id
    WHERE ii.product_id IS NOT NULL
      AND public.is_invoice_shortage_eligible(i.status, i.delivery_status)
  ),
  gaps AS (
    SELECT *, (ordered_qty - delivered_qty - reserved_qty) AS gap
    FROM base
    WHERE (ordered_qty - delivered_qty - reserved_qty) > 0
  ),
  ins AS (
    INSERT INTO public.invoice_po_reservations
      (invoice_id, invoice_item_id, product_id, quantity, status, created_by)
    SELECT invoice_id, invoice_item_id, product_id, gap, 'needs_order', user_id
    FROM gaps
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_inserted FROM ins;

  RETURN v_inserted;
END;
$function$;