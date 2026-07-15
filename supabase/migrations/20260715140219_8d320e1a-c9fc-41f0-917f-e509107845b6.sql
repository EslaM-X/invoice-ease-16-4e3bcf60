
CREATE TABLE IF NOT EXISTS public.shortage_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  notes text,
  status text NOT NULL DEFAULT 'open',
  po_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shortage_requests TO authenticated;
GRANT ALL ON public.shortage_requests TO service_role;

ALTER TABLE public.shortage_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shortage_requests_select_company"
  ON public.shortage_requests FOR SELECT
  TO authenticated
  USING (public.can_access_user_data(requested_by));

CREATE POLICY "shortage_requests_insert_own"
  ON public.shortage_requests FOR INSERT
  TO authenticated
  WITH CHECK (requested_by = auth.uid());

CREATE POLICY "shortage_requests_update_company"
  ON public.shortage_requests FOR UPDATE
  TO authenticated
  USING (public.can_access_user_data(requested_by))
  WITH CHECK (public.can_access_user_data(requested_by));

CREATE POLICY "shortage_requests_delete_own"
  ON public.shortage_requests FOR DELETE
  TO authenticated
  USING (requested_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_shortage_requests_product ON public.shortage_requests(product_id);
CREATE INDEX IF NOT EXISTS idx_shortage_requests_invoice ON public.shortage_requests(invoice_id);
CREATE INDEX IF NOT EXISTS idx_shortage_requests_status ON public.shortage_requests(status);

CREATE TRIGGER trg_shortage_requests_updated_at
  BEFORE UPDATE ON public.shortage_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
