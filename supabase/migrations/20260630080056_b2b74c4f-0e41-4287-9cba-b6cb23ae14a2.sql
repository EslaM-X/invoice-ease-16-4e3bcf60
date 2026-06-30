
CREATE OR REPLACE FUNCTION public.get_delivered_qty_by_product()
RETURNS TABLE(product_id uuid, delivered_qty bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH dr_lines AS (
    SELECT
      dri.id              AS dri_id,
      dri.quantity        AS qty,
      dri.invoice_item_id AS direct_item,
      dr.invoice_id       AS invoice_id,
      dri.product_name    AS product_name,
      dri.color           AS color,
      dri.serial_number   AS serial_number
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    WHERE COALESCE(dr.status, '') <> 'cancelled'
      AND public.can_access_user_data(dr.user_id)
  ),
  -- Path A: direct link, trust it.
  path_a AS (
    SELECT l.dri_id, ii.product_id, l.qty
    FROM dr_lines l
    JOIN public.invoice_items ii ON ii.id = l.direct_item
    WHERE l.direct_item IS NOT NULL AND ii.product_id IS NOT NULL
  ),
  -- Path B: legacy rows. Match within invoice using name + (color/serial when present).
  candidates AS (
    SELECT l.dri_id, l.qty, ii.product_id, ii.quantity AS ii_qty,
           -- best score: serial > color > name only
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
    SELECT dri_id, MAX(score) AS top FROM candidates GROUP BY dri_id
  ),
  filtered AS (
    SELECT c.* FROM candidates c
    JOIN best b ON b.dri_id = c.dri_id AND b.top = c.score
  ),
  path_b AS (
    SELECT f.dri_id, f.product_id,
           (f.qty::numeric * (f.ii_qty::numeric
              / NULLIF(SUM(f.ii_qty) OVER (PARTITION BY f.dri_id), 0)
           ))::bigint AS qty
    FROM filtered f
  ),
  all_resolved AS (
    SELECT * FROM path_a
    UNION ALL
    SELECT * FROM path_b
  )
  SELECT product_id, SUM(qty)::bigint AS delivered_qty
  FROM all_resolved
  WHERE product_id IS NOT NULL
  GROUP BY product_id;
$function$;
