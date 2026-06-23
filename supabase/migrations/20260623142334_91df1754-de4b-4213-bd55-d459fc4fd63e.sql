
-- ============================================================
-- Distributor system: data model + RLS + realtime
-- ============================================================

-- 1) Products: safety margin (hidden stock buffer for distributors)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS safety_margin integer NOT NULL DEFAULT 0;

-- 2) Distributors table
CREATE TABLE IF NOT EXISTS public.distributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  showroom_name text,
  location text,
  city text,
  address text,
  phone text,
  email text,
  branches_count integer NOT NULL DEFAULT 1,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.distributors TO authenticated;
GRANT ALL ON public.distributors TO service_role;

ALTER TABLE public.distributors ENABLE ROW LEVEL SECURITY;

-- 3) Helper: is_distributor()
CREATE OR REPLACE FUNCTION public.is_distributor(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.distributors WHERE user_id = _user_id AND is_active);
$$;

-- Distributors RLS
DROP POLICY IF EXISTS "distributors self select" ON public.distributors;
CREATE POLICY "distributors self select" ON public.distributors
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_company_member());

DROP POLICY IF EXISTS "company manages distributors" ON public.distributors;
CREATE POLICY "company manages distributors" ON public.distributors
  FOR ALL TO authenticated
  USING (is_company_member())
  WITH CHECK (is_company_member());

DROP POLICY IF EXISTS "distributor updates own profile" ON public.distributors;
CREATE POLICY "distributor updates own profile" ON public.distributors
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND is_active = true);

-- 4) Invoices: distributor / approval columns
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS distributor_id uuid REFERENCES public.distributors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approval_discount_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approval_notes text,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_invoices_distributor ON public.invoices(distributor_id);
CREATE INDEX IF NOT EXISTS idx_invoices_approval_status ON public.invoices(approval_status) WHERE source = 'distributor';

-- 5) Distributor view of products (masked stock, no cost)
CREATE OR REPLACE VIEW public.distributor_products_view
WITH (security_invoker = off) AS
SELECT
  p.id,
  p.name,
  p.serial_number,
  p.color,
  p.price,
  p.image_url,
  p.collection,
  p.is_spare_part,
  p.parent_product_id,
  p.low_stock_threshold,
  GREATEST(COALESCE(p.stock_quantity,0) - COALESCE(p.safety_margin,0), 0) AS available_stock,
  p.updated_at,
  p.created_at
FROM public.products p;

REVOKE ALL ON public.distributor_products_view FROM PUBLIC;
GRANT SELECT ON public.distributor_products_view TO authenticated;

-- 6) Invoices RLS additions for distributors
DROP POLICY IF EXISTS "distributor insert own invoice" ON public.invoices;
CREATE POLICY "distributor insert own invoice" ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    is_distributor()
    AND user_id = auth.uid()
    AND source = 'distributor'
    AND approval_status = 'pending'
    AND status = 'draft'
  );

DROP POLICY IF EXISTS "distributor select own invoices" ON public.invoices;
CREATE POLICY "distributor select own invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (is_distributor() AND user_id = auth.uid());

DROP POLICY IF EXISTS "distributor update pending invoice" ON public.invoices;
CREATE POLICY "distributor update pending invoice" ON public.invoices
  FOR UPDATE TO authenticated
  USING (is_distributor() AND user_id = auth.uid() AND approval_status = 'pending')
  WITH CHECK (is_distributor() AND user_id = auth.uid() AND approval_status = 'pending' AND status = 'draft');

DROP POLICY IF EXISTS "distributor delete pending invoice" ON public.invoices;
CREATE POLICY "distributor delete pending invoice" ON public.invoices
  FOR DELETE TO authenticated
  USING (is_distributor() AND user_id = auth.uid() AND approval_status = 'pending');

DROP POLICY IF EXISTS "company sees distributor invoices" ON public.invoices;
CREATE POLICY "company sees distributor invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (is_company_member() AND source = 'distributor');

DROP POLICY IF EXISTS "company updates distributor invoices" ON public.invoices;
CREATE POLICY "company updates distributor invoices" ON public.invoices
  FOR UPDATE TO authenticated
  USING (is_company_member() AND source = 'distributor')
  WITH CHECK (is_company_member() AND source = 'distributor');

-- 7) Invoice items RLS additions for distributors
DROP POLICY IF EXISTS "distributor manages items on own pending invoice" ON public.invoice_items;
CREATE POLICY "distributor manages items on own pending invoice" ON public.invoice_items
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_items.invoice_id
      AND i.user_id = auth.uid()
      AND i.source = 'distributor'
      AND i.approval_status = 'pending'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_items.invoice_id
      AND i.user_id = auth.uid()
      AND i.source = 'distributor'
      AND i.approval_status = 'pending'
  ));

DROP POLICY IF EXISTS "company sees distributor invoice items" ON public.invoice_items;
CREATE POLICY "company sees distributor invoice items" ON public.invoice_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_items.invoice_id
      AND i.source = 'distributor'
      AND is_company_member()
  ));

DROP POLICY IF EXISTS "company manages distributor invoice items" ON public.invoice_items;
CREATE POLICY "company manages distributor invoice items" ON public.invoice_items
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_items.invoice_id
      AND i.source = 'distributor'
      AND is_company_member()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_items.invoice_id
      AND i.source = 'distributor'
      AND is_company_member()
  ));

-- 8) Trigger: prevent distributor from tampering with approval fields
CREATE OR REPLACE FUNCTION public.prevent_distributor_approval_tamper()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF is_distributor() AND NOT is_company_member() THEN
    IF NEW.approval_status IS DISTINCT FROM OLD.approval_status
       OR NEW.approval_discount_pct IS DISTINCT FROM OLD.approval_discount_pct
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.rejected_by IS DISTINCT FROM OLD.rejected_by
       OR NEW.rejected_at IS DISTINCT FROM OLD.rejected_at
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.distributor_id IS DISTINCT FROM OLD.distributor_id
       OR NEW.status IS DISTINCT FROM OLD.status
    THEN
      RAISE EXCEPTION 'Distributors cannot modify approval / status fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_distributor_approval_tamper ON public.invoices;
CREATE TRIGGER trg_prevent_distributor_approval_tamper
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.prevent_distributor_approval_tamper();

-- 9) Approve / reject RPCs (company-only)
CREATE OR REPLACE FUNCTION public.approve_distributor_invoice(
  _invoice_id uuid,
  _discount_pct numeric DEFAULT 0,
  _notes text DEFAULT NULL
) RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv public.invoices;
BEGIN
  IF NOT is_company_member() THEN
    RAISE EXCEPTION 'Only company members can approve invoices';
  END IF;
  UPDATE public.invoices
  SET approval_status = 'approved',
      approval_discount_pct = COALESCE(_discount_pct, 0),
      approval_notes = _notes,
      approved_by = auth.uid(),
      approved_at = now(),
      status = 'unpaid',
      discount = ROUND(subtotal * COALESCE(_discount_pct,0) / 100.0, 2),
      total = ROUND(subtotal - (subtotal * COALESCE(_discount_pct,0) / 100.0), 2)
  WHERE id = _invoice_id AND source = 'distributor' AND approval_status = 'pending'
  RETURNING * INTO v_inv;
  IF v_inv IS NULL THEN
    RAISE EXCEPTION 'Invoice not found or not pending';
  END IF;
  RETURN v_inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_distributor_invoice(
  _invoice_id uuid,
  _notes text DEFAULT NULL
) RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv public.invoices;
BEGIN
  IF NOT is_company_member() THEN
    RAISE EXCEPTION 'Only company members can reject invoices';
  END IF;
  UPDATE public.invoices
  SET approval_status = 'rejected',
      approval_notes = _notes,
      rejected_by = auth.uid(),
      rejected_at = now(),
      status = 'cancelled'
  WHERE id = _invoice_id AND source = 'distributor' AND approval_status = 'pending'
  RETURNING * INTO v_inv;
  IF v_inv IS NULL THEN
    RAISE EXCEPTION 'Invoice not found or not pending';
  END IF;
  RETURN v_inv;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_distributor_invoice(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_distributor_invoice(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_distributor(uuid) TO authenticated;

-- 10) updated_at trigger
DROP TRIGGER IF EXISTS trg_distributors_updated ON public.distributors;
CREATE TRIGGER trg_distributors_updated
BEFORE UPDATE ON public.distributors
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 11) Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.distributors;
