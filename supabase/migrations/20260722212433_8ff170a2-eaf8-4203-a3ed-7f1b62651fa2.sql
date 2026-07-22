
-- 1) get_delivered_qty_by_product: exclude DR lines whose invoice is draft/voided/cancelled;
--    align user-scope with sold (invoice.user_id).
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
    JOIN public.invoices i           ON i.id  = dr.invoice_id
    WHERE COALESCE(dr.status, '') <> 'cancelled'
      AND COALESCE(i.status,  '') NOT IN ('draft','voided','cancelled')
      AND public.can_access_user_data(i.user_id)
  ),
  path_a AS (
    SELECT l.dri_id, ii.product_id, l.qty
    FROM dr_lines l
    JOIN public.invoice_items ii ON ii.id = l.direct_item
    WHERE l.direct_item IS NOT NULL AND ii.product_id IS NOT NULL
  ),
  candidates AS (
    SELECT l.dri_id, l.qty, ii.product_id, ii.quantity AS ii_qty,
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

GRANT EXECUTE ON FUNCTION public.get_delivered_qty_by_product() TO authenticated;

-- 2) rebuild_inventory_from_source_of_truth: apply same invoice-status filter
CREATE OR REPLACE FUNCTION public.rebuild_inventory_from_source_of_truth()
RETURNS TABLE(products_changed integer, total_received bigint, total_delivered bigint, products_zeroed integer, shortages_created integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_changed integer := 0;
  v_zeroed integer := 0;
  v_recv bigint := 0;
  v_deliv bigint := 0;
  v_shortages integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;

  CREATE TEMP TABLE _truth ON COMMIT DROP AS
  WITH received AS (
    SELECT product_id, SUM(quantity)::bigint AS qty
    FROM public.po_receipt_items GROUP BY product_id
  ),
  delivered_linked AS (
    SELECT ii.product_id, SUM(dri.quantity)::bigint AS qty
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    JOIN public.invoices i           ON i.id  = dr.invoice_id
    JOIN public.invoice_items ii     ON ii.id = dri.invoice_item_id
    WHERE COALESCE(dr.status,'') <> 'cancelled'
      AND COALESCE(i.status, '') NOT IN ('draft','voided','cancelled')
      AND ii.product_id IS NOT NULL
    GROUP BY ii.product_id
  ),
  delivered_orphan AS (
    SELECT p.id AS product_id, SUM(dri.quantity)::bigint AS qty
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    JOIN public.invoices i           ON i.id  = dr.invoice_id
    JOIN public.products p           ON p.serial_number = dri.serial_number
    WHERE COALESCE(dr.status,'') <> 'cancelled'
      AND COALESCE(i.status, '') NOT IN ('draft','voided','cancelled')
      AND dri.invoice_item_id IS NULL
      AND dri.serial_number IS NOT NULL
    GROUP BY p.id
  ),
  delivered AS (
    SELECT product_id, SUM(qty)::bigint AS qty
    FROM (
      SELECT * FROM delivered_linked
      UNION ALL
      SELECT * FROM delivered_orphan
    ) x
    GROUP BY product_id
  )
  SELECT
    p.id AS product_id,
    p.stock_quantity AS old_qty,
    GREATEST(COALESCE(r.qty, 0) - COALESCE(d.qty, 0), 0)::integer AS new_qty,
    COALESCE(r.qty, 0) AS recv_qty,
    COALESCE(d.qty, 0) AS deliv_qty
  FROM public.products p
  LEFT JOIN received r  ON r.product_id = p.id
  LEFT JOIN delivered d ON d.product_id = p.id;

  SELECT COALESCE(SUM(recv_qty),0), COALESCE(SUM(deliv_qty),0)
    INTO v_recv, v_deliv FROM _truth;

  INSERT INTO public.inventory_logs (product_id, change, reason, user_id, created_at)
  SELECT t.product_id, (t.new_qty - t.old_qty),
    'RECONCILE: rebuilt from PO receipts − delivery receipts (active invoices only)', v_actor, now()
  FROM _truth t WHERE t.new_qty <> t.old_qty;

  GET DIAGNOSTICS v_changed = ROW_COUNT;

  UPDATE public.products p
    SET stock_quantity = t.new_qty, updated_at = now()
    FROM _truth t
    WHERE p.id = t.product_id AND p.stock_quantity <> t.new_qty;

  SELECT COUNT(*)::int INTO v_zeroed FROM _truth WHERE new_qty = 0;

  v_shortages := public.recompute_missing_shortages();

  RETURN QUERY SELECT v_changed, v_recv, v_deliv, v_zeroed, v_shortages;
END;
$function$;

-- 3) Diagnostic report
CREATE OR REPLACE FUNCTION public.inventory_discrepancy_report()
RETURNS TABLE(
  product_id uuid,
  product_name text,
  serial_number text,
  received bigint,
  delivered_counted bigint,
  delivered_excluded_by_invoice_status bigint,
  sold bigint,
  stock_quantity_now integer,
  expected_stock integer,
  delta integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH received AS (
    SELECT product_id, SUM(quantity)::bigint AS qty
    FROM public.po_receipt_items GROUP BY product_id
  ),
  dr_lines AS (
    SELECT
      dri.id AS dri_id, dri.quantity AS qty,
      dri.invoice_item_id AS direct_item,
      dr.invoice_id AS invoice_id,
      dri.product_name, dri.color, dri.serial_number,
      COALESCE(i.status,'') AS inv_status,
      COALESCE(dr.status,'') AS dr_status
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    JOIN public.invoices i ON i.id = dr.invoice_id
  ),
  resolved AS (
    SELECT l.dri_id, ii.product_id, l.qty, l.inv_status, l.dr_status
    FROM dr_lines l
    JOIN public.invoice_items ii ON ii.id = l.direct_item
    WHERE l.direct_item IS NOT NULL AND ii.product_id IS NOT NULL
  ),
  counted AS (
    SELECT product_id, SUM(qty)::bigint AS qty
    FROM resolved
    WHERE dr_status <> 'cancelled'
      AND inv_status NOT IN ('draft','voided','cancelled')
    GROUP BY product_id
  ),
  excluded AS (
    SELECT product_id, SUM(qty)::bigint AS qty
    FROM resolved
    WHERE dr_status <> 'cancelled'
      AND inv_status IN ('draft','voided','cancelled')
    GROUP BY product_id
  ),
  sold AS (
    SELECT ii.product_id, SUM(ii.quantity)::bigint AS qty
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE ii.product_id IS NOT NULL
      AND COALESCE(i.status,'') NOT IN ('draft','voided','cancelled')
    GROUP BY ii.product_id
  )
  SELECT
    p.id, p.name, p.serial_number,
    COALESCE(r.qty,0),
    COALESCE(c.qty,0),
    COALESCE(e.qty,0),
    COALESCE(s.qty,0),
    p.stock_quantity,
    GREATEST(COALESCE(r.qty,0) - COALESCE(c.qty,0), 0)::integer,
    (GREATEST(COALESCE(r.qty,0) - COALESCE(c.qty,0), 0)::integer - p.stock_quantity)
  FROM public.products p
  LEFT JOIN received r ON r.product_id = p.id
  LEFT JOIN counted  c ON c.product_id = p.id
  LEFT JOIN excluded e ON e.product_id = p.id
  LEFT JOIN sold     s ON s.product_id = p.id
  WHERE public.is_admin();
$function$;

GRANT EXECUTE ON FUNCTION public.inventory_discrepancy_report() TO authenticated;
