
-- Cleanup orphan rows first to allow FKs
DELETE FROM public.invoice_po_reservations r
WHERE NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = r.invoice_id)
   OR NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = r.product_id)
   OR NOT EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = r.po_id)
   OR NOT EXISTS (SELECT 1 FROM public.purchase_order_items poi WHERE poi.id = r.po_item_id);

ALTER TABLE public.invoice_po_reservations
  ADD CONSTRAINT invoice_po_reservations_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE,
  ADD CONSTRAINT invoice_po_reservations_invoice_item_id_fkey
    FOREIGN KEY (invoice_item_id) REFERENCES public.invoice_items(id) ON DELETE CASCADE,
  ADD CONSTRAINT invoice_po_reservations_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id),
  ADD CONSTRAINT invoice_po_reservations_po_id_fkey
    FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id),
  ADD CONSTRAINT invoice_po_reservations_po_item_id_fkey
    FOREIGN KEY (po_item_id) REFERENCES public.purchase_order_items(id);

CREATE INDEX IF NOT EXISTS idx_invoice_po_reservations_product_id ON public.invoice_po_reservations(product_id);
CREATE INDEX IF NOT EXISTS idx_invoice_po_reservations_invoice_id ON public.invoice_po_reservations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_po_reservations_po_id ON public.invoice_po_reservations(po_id);
CREATE INDEX IF NOT EXISTS idx_invoice_po_reservations_status ON public.invoice_po_reservations(status);

-- RPC to get sold quantity per product (scoped to company access)
CREATE OR REPLACE FUNCTION public.get_sold_qty_by_product()
RETURNS TABLE(product_id uuid, sold_qty bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ii.product_id, SUM(ii.quantity)::bigint AS sold_qty
  FROM public.invoice_items ii
  JOIN public.invoices i ON i.id = ii.invoice_id
  WHERE ii.product_id IS NOT NULL
    AND COALESCE(i.status, '') <> 'cancelled'
    AND public.can_access_user_data(i.user_id)
  GROUP BY ii.product_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_sold_qty_by_product() TO authenticated;
