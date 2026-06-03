
-- Make sold qty 100% reflect real, non-voided/cancelled/draft invoices
CREATE OR REPLACE FUNCTION public.get_sold_qty_by_product()
RETURNS TABLE(product_id uuid, sold_qty bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT ii.product_id, SUM(ii.quantity)::bigint AS sold_qty
  FROM public.invoice_items ii
  JOIN public.invoices i ON i.id = ii.invoice_id
  WHERE ii.product_id IS NOT NULL
    AND COALESCE(i.status, '') NOT IN ('cancelled', 'voided', 'draft')
    AND public.can_access_user_data(i.user_id)
  GROUP BY ii.product_id;
$function$;

-- New RPC: per-invoice-item live reservations (real invoice rows, minus delivered)
-- This drives the "Reserved for Invoices" tab so every number/row is real.
CREATE OR REPLACE FUNCTION public.get_active_invoice_reservations()
RETURNS TABLE(
  invoice_item_id uuid,
  invoice_id uuid,
  invoice_number text,
  customer_name text,
  product_id uuid,
  product_name text,
  reserved_qty bigint,
  created_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH delivered AS (
    SELECT dri.invoice_item_id, SUM(dri.quantity)::bigint AS qty
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    WHERE dri.invoice_item_id IS NOT NULL
      AND COALESCE(dr.status, '') <> 'cancelled'
    GROUP BY dri.invoice_item_id
  )
  SELECT ii.id AS invoice_item_id,
         i.id AS invoice_id,
         i.invoice_number,
         i.customer_name,
         ii.product_id,
         ii.product_name,
         (ii.quantity - COALESCE(d.qty, 0))::bigint AS reserved_qty,
         i.created_at
  FROM public.invoice_items ii
  JOIN public.invoices i ON i.id = ii.invoice_id
  LEFT JOIN delivered d ON d.invoice_item_id = ii.id
  WHERE ii.product_id IS NOT NULL
    AND COALESCE(i.status, '') NOT IN ('cancelled', 'voided', 'draft')
    AND (ii.quantity - COALESCE(d.qty, 0)) > 0
    AND public.can_access_user_data(i.user_id)
  ORDER BY i.created_at DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.get_active_invoice_reservations() TO authenticated;
