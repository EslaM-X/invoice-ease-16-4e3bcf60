
CREATE OR REPLACE FUNCTION public.rebuild_inventory_from_source_of_truth()
RETURNS TABLE(
  products_changed integer,
  total_received bigint,
  total_delivered bigint,
  products_zeroed integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_changed integer := 0;
  v_zeroed integer := 0;
  v_recv bigint := 0;
  v_deliv bigint := 0;
BEGIN
  -- authorization: super admin only
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;

  -- compute truth per product
  CREATE TEMP TABLE _truth ON COMMIT DROP AS
  WITH received AS (
    SELECT product_id, SUM(quantity)::bigint AS qty
    FROM public.po_receipt_items
    GROUP BY product_id
  ),
  delivered AS (
    SELECT ii.product_id, SUM(dri.quantity)::bigint AS qty
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    JOIN public.invoice_items ii ON ii.id = dri.invoice_item_id
    WHERE dr.status <> 'cancelled'
      AND ii.product_id IS NOT NULL
    GROUP BY ii.product_id
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

  -- audit log for every product whose value changes
  INSERT INTO public.inventory_logs (product_id, change, reason, user_id, created_at)
  SELECT
    t.product_id,
    (t.new_qty - t.old_qty),
    'RECONCILE: rebuilt from PO receipts − delivery receipts',
    v_actor,
    now()
  FROM _truth t
  WHERE t.new_qty <> t.old_qty;

  GET DIAGNOSTICS v_changed = ROW_COUNT;

  -- apply new stock
  UPDATE public.products p
     SET stock_quantity = t.new_qty,
         updated_at = now()
    FROM _truth t
   WHERE p.id = t.product_id
     AND p.stock_quantity <> t.new_qty;

  SELECT COUNT(*)::int INTO v_zeroed FROM _truth WHERE new_qty = 0;

  RETURN QUERY SELECT v_changed, v_recv, v_deliv, v_zeroed;
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_inventory_from_source_of_truth() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rebuild_inventory_from_source_of_truth() TO authenticated;
