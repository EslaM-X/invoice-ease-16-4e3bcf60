
-- Reservations of in-transit (open PO) quantities by invoice lines
CREATE TABLE public.invoice_po_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  invoice_item_id uuid,
  product_id uuid NOT NULL,
  po_id uuid NOT NULL,
  po_item_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','fulfilled','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_email text,
  fulfilled_at timestamptz
);

CREATE INDEX idx_ipor_invoice ON public.invoice_po_reservations(invoice_id);
CREATE INDEX idx_ipor_product_status ON public.invoice_po_reservations(product_id, status);
CREATE INDEX idx_ipor_po_item ON public.invoice_po_reservations(po_item_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_po_reservations TO authenticated;
GRANT ALL ON public.invoice_po_reservations TO service_role;

ALTER TABLE public.invoice_po_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company reservations select"
  ON public.invoice_po_reservations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND can_access_user_data(i.user_id)));

CREATE POLICY "company reservations insert"
  ON public.invoice_po_reservations FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND can_access_user_data(i.user_id)));

CREATE POLICY "company reservations update"
  ON public.invoice_po_reservations FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND can_access_user_data(i.user_id)));

CREATE POLICY "company reservations delete"
  ON public.invoice_po_reservations FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND can_access_user_data(i.user_id)));

-- When a PO is marked received (status='received'), mark its active reservations as fulfilled
CREATE OR REPLACE FUNCTION public.fulfill_reservations_on_po_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'received' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.invoice_po_reservations
       SET status = 'fulfilled', fulfilled_at = now()
     WHERE po_id = NEW.id AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fulfill_reservations_on_po_received ON public.purchase_orders;
CREATE TRIGGER trg_fulfill_reservations_on_po_received
AFTER UPDATE OF status ON public.purchase_orders
FOR EACH ROW
EXECUTE FUNCTION public.fulfill_reservations_on_po_received();
