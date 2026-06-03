
CREATE OR REPLACE FUNCTION public.get_reserved_qty_by_product()
RETURNS TABLE(product_id uuid, reserved_qty bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH invoiced AS (
    SELECT ii.id AS invoice_item_id, ii.product_id, ii.quantity
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE ii.product_id IS NOT NULL
      AND COALESCE(i.status, '') NOT IN ('cancelled', 'voided', 'draft')
      AND COALESCE(i.delivery_status, 'pending') <> 'delivered'
      AND public.can_access_user_data(i.user_id)
  ),
  delivered AS (
    SELECT dri.invoice_item_id, SUM(dri.quantity)::bigint AS qty
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    WHERE dri.invoice_item_id IS NOT NULL
      AND COALESCE(dr.status, '') <> 'cancelled'
    GROUP BY dri.invoice_item_id
  )
  SELECT inv.product_id,
         GREATEST(SUM(inv.quantity) - COALESCE(SUM(d.qty), 0), 0)::bigint AS reserved_qty
  FROM invoiced inv
  LEFT JOIN delivered d ON d.invoice_item_id = inv.invoice_item_id
  GROUP BY inv.product_id
  HAVING GREATEST(SUM(inv.quantity) - COALESCE(SUM(d.qty), 0), 0) > 0;
$$;

GRANT EXECUTE ON FUNCTION public.get_reserved_qty_by_product() TO authenticated;
