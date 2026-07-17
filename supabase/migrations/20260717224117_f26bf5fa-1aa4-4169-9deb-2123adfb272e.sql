
-- 1) Upgrade rebuild to handle orphan delivery_receipt_items (invoice_item_id NULL) via serial_number match
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
    JOIN public.invoice_items ii ON ii.id = dri.invoice_item_id
    WHERE dr.status <> 'cancelled' AND ii.product_id IS NOT NULL
    GROUP BY ii.product_id
  ),
  delivered_orphan AS (
    -- invoice_item was deleted (FK SET NULL); recover product via serial_number match
    SELECT p.id AS product_id, SUM(dri.quantity)::bigint AS qty
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    JOIN public.products p ON p.serial_number = dri.serial_number
    WHERE dr.status <> 'cancelled'
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
  LEFT JOIN received r ON r.product_id = p.id
  LEFT JOIN delivered d ON d.product_id = p.id;

  SELECT COALESCE(SUM(recv_qty),0), COALESCE(SUM(deliv_qty),0)
    INTO v_recv, v_deliv FROM _truth;

  INSERT INTO public.inventory_logs (product_id, change, reason, user_id, created_at)
  SELECT t.product_id, (t.new_qty - t.old_qty),
    'RECONCILE: rebuilt from PO receipts − delivery receipts (incl. orphan serial match)', v_actor, now()
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

-- 2) Orphan report: DRIs with no invoice_item link. Flags whether serial matches a product.
CREATE OR REPLACE FUNCTION public.orphan_delivery_items_report()
RETURNS TABLE(
  dri_id uuid,
  receipt_id uuid,
  receipt_number text,
  receipt_status text,
  product_name text,
  serial_number text,
  color text,
  quantity integer,
  matched_product_id uuid,
  match_status text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    dri.id,
    dr.id,
    dr.receipt_number,
    dr.status,
    dri.product_name,
    dri.serial_number,
    dri.color,
    dri.quantity,
    p.id,
    CASE
      WHEN dri.serial_number IS NULL THEN 'no_serial'
      WHEN p.id IS NOT NULL THEN 'matched_by_serial'
      ELSE 'unmatched'
    END,
    dri.created_at
  FROM public.delivery_receipt_items dri
  JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
  LEFT JOIN public.products p ON p.serial_number = dri.serial_number
  WHERE dri.invoice_item_id IS NULL
  ORDER BY dr.created_at DESC, dri.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.orphan_delivery_items_report() TO authenticated;
