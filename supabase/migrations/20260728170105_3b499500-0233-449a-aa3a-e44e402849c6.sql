CREATE OR REPLACE FUNCTION public.get_active_invoice_reservations()
 RETURNS TABLE(invoice_item_id uuid, invoice_id uuid, invoice_number text, customer_name text, product_id uuid, product_name text, reserved_qty bigint, created_at timestamp with time zone)
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
    -- Only SIGNED receipts count as delivered. Draft / out_for_delivery / cancelled
    -- keep the item RESERVED (still needed against stock).
    WHERE COALESCE(dr.status, '') = 'signed'
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