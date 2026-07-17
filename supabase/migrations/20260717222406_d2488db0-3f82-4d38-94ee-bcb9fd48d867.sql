
-- Recompute shortages: for every non-draft non-cancelled invoice item with a product,
-- if remaining (quantity - delivered - active/needs_order reservations) > 0, insert
-- a needs_order reservation covering the gap. Idempotent (skips items already tracked).
CREATE OR REPLACE FUNCTION public.recompute_missing_shortages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;

  WITH base AS (
    SELECT
      ii.id AS invoice_item_id,
      ii.invoice_id,
      ii.product_id,
      ii.quantity AS ordered_qty,
      COALESCE((
        SELECT SUM(dri.quantity)::int
        FROM public.delivery_receipt_items dri
        JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
        WHERE dri.invoice_item_id = ii.id AND dr.status <> 'cancelled'
      ), 0) AS delivered_qty,
      COALESCE((
        SELECT SUM(r.quantity)::int
        FROM public.invoice_po_reservations r
        WHERE r.invoice_item_id = ii.id
          AND r.status IN ('active','needs_order','fulfilled')
      ), 0) AS reserved_qty,
      i.user_id
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE ii.product_id IS NOT NULL
      AND i.status NOT IN ('draft','cancelled')
  ),
  gaps AS (
    SELECT * , (ordered_qty - delivered_qty - reserved_qty) AS gap
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
$$;

GRANT EXECUTE ON FUNCTION public.recompute_missing_shortages() TO authenticated;

-- Extend rebuild to also recompute shortages and return the count.
DROP FUNCTION IF EXISTS public.rebuild_inventory_from_source_of_truth();

CREATE OR REPLACE FUNCTION public.rebuild_inventory_from_source_of_truth()
RETURNS TABLE(products_changed integer, total_received bigint, total_delivered bigint, products_zeroed integer, shortages_created integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  delivered AS (
    SELECT ii.product_id, SUM(dri.quantity)::bigint AS qty
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    JOIN public.invoice_items ii ON ii.id = dri.invoice_item_id
    WHERE dr.status <> 'cancelled' AND ii.product_id IS NOT NULL
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

  INSERT INTO public.inventory_logs (product_id, change, reason, user_id, created_at)
  SELECT t.product_id, (t.new_qty - t.old_qty),
    'RECONCILE: rebuilt from PO receipts − delivery receipts', v_actor, now()
  FROM _truth t WHERE t.new_qty <> t.old_qty;

  GET DIAGNOSTICS v_changed = ROW_COUNT;

  UPDATE public.products p
    SET stock_quantity = t.new_qty, updated_at = now()
    FROM _truth t
    WHERE p.id = t.product_id AND p.stock_quantity <> t.new_qty;

  SELECT COUNT(*)::int INTO v_zeroed FROM _truth WHERE new_qty = 0;

  -- Now recompute shortages: create needs_order reservations for any invoice
  -- item on a non-draft, non-cancelled invoice whose remaining demand is not
  -- covered by delivery or existing reservations.
  v_shortages := public.recompute_missing_shortages();

  RETURN QUERY SELECT v_changed, v_recv, v_deliv, v_zeroed, v_shortages;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rebuild_inventory_from_source_of_truth() TO authenticated;
