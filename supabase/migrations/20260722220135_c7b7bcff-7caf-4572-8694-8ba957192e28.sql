CREATE OR REPLACE FUNCTION public.is_invoice_shortage_eligible(_status text, _delivery_status text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(_status, '') NOT IN ('draft', 'cancelled', 'voided', 'archived', 'closed')
     AND COALESCE(_delivery_status, '') NOT IN ('delivered', 'completed');
$function$;

CREATE OR REPLACE FUNCTION public.get_active_invoice_reservations()
RETURNS TABLE(
  invoice_item_id uuid,
  invoice_id uuid,
  invoice_number text,
  customer_name text,
  product_id uuid,
  product_name text,
  reserved_qty bigint,
  created_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH dr_lines AS (
    SELECT
      dri.id AS dri_id,
      dri.quantity AS qty,
      dri.invoice_item_id AS direct_item,
      dr.invoice_id AS invoice_id,
      dri.product_name,
      dri.color,
      dri.serial_number
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    JOIN public.invoices i ON i.id = dr.invoice_id
    WHERE COALESCE(dr.status, '') <> 'cancelled'
      AND public.is_invoice_shortage_eligible(i.status, i.delivery_status)
  ),
  path_a AS (
    SELECT l.dri_id, l.direct_item AS invoice_item_id, l.qty::bigint AS qty
    FROM dr_lines l
    JOIN public.invoice_items ii ON ii.id = l.direct_item
    WHERE l.direct_item IS NOT NULL AND ii.product_id IS NOT NULL
  ),
  candidates AS (
    SELECT
      l.dri_id,
      l.qty,
      ii.id AS invoice_item_id,
      ii.quantity AS ii_qty,
      CASE
        WHEN l.serial_number IS NOT NULL AND p.serial_number IS NOT NULL
             AND l.serial_number = p.serial_number THEN 3
        WHEN l.color IS NOT NULL AND p.color IS NOT NULL
             AND lower(l.color) = lower(p.color) THEN 2
        ELSE 1
      END AS score
    FROM dr_lines l
    JOIN public.invoice_items ii
      ON ii.invoice_id = l.invoice_id
     AND ii.product_name = l.product_name
    JOIN public.products p ON p.id = ii.product_id
    WHERE l.direct_item IS NULL AND ii.product_id IS NOT NULL
  ),
  best AS (
    SELECT dri_id, MAX(score) AS top
    FROM candidates
    GROUP BY dri_id
  ),
  filtered AS (
    SELECT c.*
    FROM candidates c
    JOIN best b ON b.dri_id = c.dri_id AND b.top = c.score
  ),
  path_b AS (
    SELECT
      f.dri_id,
      f.invoice_item_id,
      (f.qty::numeric * (f.ii_qty::numeric / NULLIF(SUM(f.ii_qty) OVER (PARTITION BY f.dri_id), 0)))::bigint AS qty
    FROM filtered f
  ),
  resolved AS (
    SELECT dri_id, invoice_item_id, qty FROM path_a
    UNION ALL
    SELECT dri_id, invoice_item_id, qty FROM path_b
  ),
  delivered_per_item AS (
    SELECT
      r.invoice_item_id,
      LEAST(ii.quantity, COALESCE(SUM(r.qty), 0))::bigint AS qty
    FROM resolved r
    JOIN public.invoice_items ii ON ii.id = r.invoice_item_id
    GROUP BY r.invoice_item_id, ii.quantity
  )
  SELECT
    ii.id,
    i.id,
    i.invoice_number,
    i.customer_name,
    ii.product_id,
    ii.product_name,
    GREATEST(0, (ii.quantity - COALESCE(d.qty, 0)))::bigint AS reserved_qty,
    i.created_at
  FROM public.invoice_items ii
  JOIN public.invoices i ON i.id = ii.invoice_id
  LEFT JOIN delivered_per_item d ON d.invoice_item_id = ii.id
  WHERE ii.product_id IS NOT NULL
    AND public.is_invoice_shortage_eligible(i.status, i.delivery_status)
    AND (ii.quantity - COALESCE(d.qty, 0)) > 0
    AND public.can_access_user_data(i.user_id)
  ORDER BY i.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_reserved_qty_by_product()
RETURNS TABLE(product_id uuid, reserved_qty bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT product_id, SUM(reserved_qty)::bigint
  FROM public.get_active_invoice_reservations()
  GROUP BY product_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_reserved_invoices_summary()
RETURNS TABLE(invoice_id uuid, invoice_number text, customer_name text, reserved_units bigint, reserved_lines bigint, created_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT invoice_id, invoice_number, customer_name,
         SUM(reserved_qty)::bigint AS reserved_units,
         COUNT(*)::bigint AS reserved_lines,
         MAX(created_at) AS created_at
  FROM public.get_active_invoice_reservations()
  GROUP BY invoice_id, invoice_number, customer_name
  ORDER BY MAX(created_at) DESC;
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
        'quantity', n.qty,
        'created_at', n.created_at,
        'status', i.status,
        'delivery_status', i.delivery_status
      ) ORDER BY n.created_at) AS invoices
    FROM needs n
    JOIN public.invoices i ON i.id = n.invoice_id
    GROUP BY n.product_id
  ),
  incoming AS (
    SELECT
      poi.product_id,
      SUM(GREATEST(0, COALESCE(poi.quantity, 0) - COALESCE(poi.received_qty, 0)))::bigint AS incoming_qty
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.po_id
    WHERE po.status IN ('ordered','shipped','in_warehouse')
    GROUP BY poi.product_id
  )
  SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.serial_number,
    p.color,
    p.collection,
    p.image_url,
    p.is_spare_part,
    COALESCE(p.stock_quantity, 0) AS stock_quantity,
    COALESCE(inc.incoming_qty, 0) AS incoming_qty,
    pp.needed_qty,
    GREATEST(0, pp.needed_qty - (COALESCE(p.stock_quantity, 0) + COALESCE(inc.incoming_qty, 0)))::bigint AS net_shortage,
    pp.invoices
  FROM per_product pp
  JOIN public.products p ON p.id = pp.product_id
  LEFT JOIN incoming inc ON inc.product_id = pp.product_id
  WHERE GREATEST(0, pp.needed_qty - (COALESCE(p.stock_quantity, 0) + COALESCE(inc.incoming_qty, 0))) > 0
  ORDER BY GREATEST(0, pp.needed_qty - (COALESCE(p.stock_quantity, 0) + COALESCE(inc.incoming_qty, 0))) DESC, pp.needed_qty DESC;
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
    SELECT ar.product_id, SUM(ar.reserved_qty)::bigint AS qty
    FROM public.get_active_invoice_reservations() ar
    JOIN invoice_gate g ON g.id = ar.invoice_id
    GROUP BY ar.product_id
  ),
  incoming AS (
    SELECT
      poi.product_id,
      SUM(GREATEST(0, COALESCE(poi.quantity, 0) - COALESCE(poi.received_qty, 0)))::bigint AS incoming_qty
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.po_id
    WHERE po.status IN ('ordered','shipped','in_warehouse')
    GROUP BY poi.product_id
  )
  SELECT
    n.product_id,
    COALESCE(p.name, n.product_id::text) AS product_name,
    p.serial_number,
    p.color,
    p.image_url,
    GREATEST(0, n.qty - (COALESCE(p.stock_quantity, 0) + COALESCE(i.incoming_qty, 0)))::bigint AS quantity,
    COALESCE(p.stock_quantity, 0),
    COALESCE(i.incoming_qty, 0)
  FROM needs n
  LEFT JOIN public.products p ON p.id = n.product_id
  LEFT JOIN incoming i ON i.product_id = n.product_id
  WHERE GREATEST(0, n.qty - (COALESCE(p.stock_quantity, 0) + COALESCE(i.incoming_qty, 0))) > 0;
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

  WITH existing AS (
    SELECT DISTINCT invoice_item_id
    FROM public.invoice_po_reservations
    WHERE invoice_item_id IS NOT NULL
      AND status IN ('active','needs_order','fulfilled')
  ),
  gaps AS (
    SELECT
      ar.invoice_id,
      ar.invoice_item_id,
      ar.product_id,
      ar.reserved_qty::int AS gap,
      i.user_id
    FROM public.get_active_invoice_reservations() ar
    JOIN public.invoices i ON i.id = ar.invoice_id
    LEFT JOIN existing e ON e.invoice_item_id = ar.invoice_item_id
    WHERE e.invoice_item_id IS NULL
      AND ar.reserved_qty > 0
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