
-- Authoritative "delivered units per product" that does NOT depend on
-- delivery_receipt_items.invoice_item_id being populated (272 legacy rows
-- have it as NULL). Falls back to matching by (delivery_receipts.invoice_id,
-- dri.product_name) so historical receipts count correctly.
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
      dr.user_id          AS owner
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    WHERE COALESCE(dr.status, '') <> 'cancelled'
      AND public.can_access_user_data(dr.user_id)
  ),
  resolved AS (
    -- Path A: invoice_item_id is set -> trust it
    SELECT l.dri_id, ii.product_id, l.qty
    FROM dr_lines l
    JOIN public.invoice_items ii ON ii.id = l.direct_item
    WHERE l.direct_item IS NOT NULL AND ii.product_id IS NOT NULL

    UNION ALL

    -- Path B: invoice_item_id is NULL -> match within the same invoice by
    -- product_name. If multiple lines match, split quantity proportionally
    -- so each product still gets its share.
    SELECT l.dri_id, ii.product_id,
           (l.qty::numeric * (ii.quantity::numeric
              / NULLIF(SUM(ii.quantity) OVER (PARTITION BY l.dri_id), 0)
           ))::bigint AS qty
    FROM dr_lines l
    JOIN public.invoice_items ii
      ON ii.invoice_id = l.invoice_id
     AND ii.product_name = l.product_name
    WHERE l.direct_item IS NULL AND ii.product_id IS NOT NULL
  )
  SELECT product_id, SUM(qty)::bigint AS delivered_qty
  FROM resolved
  WHERE product_id IS NOT NULL
  GROUP BY product_id;
$function$;

GRANT EXECUTE ON FUNCTION public.get_delivered_qty_by_product() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_delivered_qty_by_product() TO service_role;
