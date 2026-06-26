
-- 1. Add commission column to invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS distributor_commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 2. Distributor payouts table
CREATE TABLE IF NOT EXISTS public.distributor_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id UUID NOT NULL REFERENCES public.distributors(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payout_method TEXT,
  notes TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_by UUID,
  paid_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.distributor_payouts TO authenticated;
GRANT ALL ON public.distributor_payouts TO service_role;
ALTER TABLE public.distributor_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company manages payouts" ON public.distributor_payouts;
CREATE POLICY "company manages payouts" ON public.distributor_payouts
  FOR ALL TO authenticated
  USING (is_company_member())
  WITH CHECK (is_company_member());

DROP POLICY IF EXISTS "distributor sees own payouts" ON public.distributor_payouts;
CREATE POLICY "distributor sees own payouts" ON public.distributor_payouts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.distributors d WHERE d.id = distributor_id AND d.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_dist_payouts_distributor ON public.distributor_payouts(distributor_id, paid_at DESC);

-- 3. Replace approve_distributor_invoice: customer pays full, pct = distributor commission
CREATE OR REPLACE FUNCTION public.approve_distributor_invoice(_invoice_id uuid, _discount_pct numeric DEFAULT 0, _notes text DEFAULT NULL::text)
RETURNS invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_inv public.invoices;
  v_dist_user uuid;
BEGIN
  IF NOT is_company_member() THEN
    RAISE EXCEPTION 'Only company members can approve invoices';
  END IF;
  UPDATE public.invoices
  SET approval_status = 'approved',
      approval_discount_pct = COALESCE(_discount_pct, 0),
      distributor_commission_amount = ROUND(subtotal * COALESCE(_discount_pct,0) / 100.0, 2),
      approval_notes = _notes,
      approved_by = auth.uid(),
      approved_at = now(),
      status = 'unpaid',
      discount = 0,
      total = subtotal
  WHERE id = _invoice_id AND source = 'distributor' AND approval_status = 'pending'
  RETURNING * INTO v_inv;
  IF v_inv IS NULL THEN RAISE EXCEPTION 'Invoice not found or not pending'; END IF;

  SELECT user_id INTO v_dist_user FROM public.distributors WHERE id = v_inv.distributor_id;
  IF v_dist_user IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, body, link, meta)
    VALUES (v_dist_user, 'distributor_invoice_approved',
      'تمت الموافقة على فاتورتك',
      'فاتورة ' || v_inv.invoice_number || ' — عمولتك: ' || v_inv.distributor_commission_amount::text || ' ج.م',
      '/distributor',
      jsonb_build_object('invoice_id', v_inv.id, 'commission', v_inv.distributor_commission_amount));
  END IF;
  RETURN v_inv;
END; $$;

-- 4. Reject distributor invoice — also allow rejecting an already-approved invoice; release reservations; notify
CREATE OR REPLACE FUNCTION public.reject_distributor_invoice(_invoice_id uuid, _notes text DEFAULT NULL::text)
RETURNS invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_inv public.invoices;
  v_dist_user uuid;
BEGIN
  IF NOT is_company_member() THEN RAISE EXCEPTION 'Only company members can reject invoices'; END IF;
  UPDATE public.invoices
  SET approval_status = 'rejected',
      approval_notes = _notes,
      rejected_by = auth.uid(),
      rejected_at = now(),
      status = 'cancelled',
      distributor_commission_amount = 0
  WHERE id = _invoice_id AND source = 'distributor' AND approval_status IN ('pending','approved')
  RETURNING * INTO v_inv;
  IF v_inv IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  -- Release any active PO reservations
  UPDATE public.invoice_po_reservations SET status = 'cancelled'
   WHERE invoice_id = v_inv.id AND status = 'active';

  SELECT user_id INTO v_dist_user FROM public.distributors WHERE id = v_inv.distributor_id;
  IF v_dist_user IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, body, link, meta)
    VALUES (v_dist_user, 'distributor_invoice_rejected',
      'تم رفض فاتورتك',
      'فاتورة ' || v_inv.invoice_number || COALESCE(' — ' || _notes, ''),
      '/distributor',
      jsonb_build_object('invoice_id', v_inv.id));
  END IF;
  RETURN v_inv;
END; $$;

-- 5. Delete distributor invoice — admin only; notify distributor; cascade items + release reservations
CREATE OR REPLACE FUNCTION public.delete_distributor_invoice(_invoice_id uuid, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_inv public.invoices;
  v_dist_user uuid;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Only admins can delete distributor invoices'; END IF;
  SELECT * INTO v_inv FROM public.invoices WHERE id = _invoice_id AND source = 'distributor';
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  -- Release reservations
  UPDATE public.invoice_po_reservations SET status = 'cancelled' WHERE invoice_id = v_inv.id AND status = 'active';
  -- Delete items + invoice
  DELETE FROM public.invoice_items WHERE invoice_id = v_inv.id;
  DELETE FROM public.invoices WHERE id = v_inv.id;

  SELECT user_id INTO v_dist_user FROM public.distributors WHERE id = v_inv.distributor_id;
  IF v_dist_user IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, body, link, meta)
    VALUES (v_dist_user, 'distributor_invoice_deleted',
      'تم حذف فاتورتك',
      'فاتورة ' || v_inv.invoice_number || COALESCE(' — ' || _notes, ''),
      '/distributor',
      jsonb_build_object('invoice_number', v_inv.invoice_number));
  END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.delete_distributor_invoice(uuid, text) TO authenticated;

-- 6. Distributor balances view
CREATE OR REPLACE VIEW public.distributor_balances
WITH (security_invoker = true) AS
SELECT
  d.id AS distributor_id,
  d.name AS distributor_name,
  COALESCE(inv.invoice_count, 0) AS approved_invoice_count,
  COALESCE(inv.sales_total, 0) AS total_sales,
  COALESCE(inv.commission_earned, 0) AS commission_earned,
  COALESCE(p.payouts_total, 0) AS payouts_total,
  COALESCE(inv.commission_earned, 0) - COALESCE(p.payouts_total, 0) AS balance_owed
FROM public.distributors d
LEFT JOIN (
  SELECT distributor_id,
         COUNT(*) AS invoice_count,
         SUM(total) AS sales_total,
         SUM(distributor_commission_amount) AS commission_earned
  FROM public.invoices
  WHERE source = 'distributor' AND approval_status = 'approved'
  GROUP BY distributor_id
) inv ON inv.distributor_id = d.id
LEFT JOIN (
  SELECT distributor_id, SUM(amount) AS payouts_total
  FROM public.distributor_payouts
  GROUP BY distributor_id
) p ON p.distributor_id = d.id;

GRANT SELECT ON public.distributor_balances TO authenticated;
