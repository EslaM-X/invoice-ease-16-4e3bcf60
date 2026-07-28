-- ============================================================================
-- 1) INVOICES: add computed delivery state + completion timestamp
-- ============================================================================
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS delivery_computed_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivery_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_invoices_delivery_computed_state
  ON public.invoices(delivery_computed_state)
  WHERE status NOT IN ('draft','voided');

CREATE INDEX IF NOT EXISTS idx_invoices_delivery_completed_at
  ON public.invoices(delivery_completed_at);

-- ============================================================================
-- 2) MATCH LOG: audit table for delivery-line matching decisions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.delivery_match_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  invoice_item_id uuid,
  receipt_id uuid,
  receipt_item_id uuid,
  match_rule text NOT NULL,
  matched_qty numeric NOT NULL DEFAULT 0,
  notes text,
  computed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.delivery_match_log TO authenticated;
GRANT ALL ON public.delivery_match_log TO service_role;
ALTER TABLE public.delivery_match_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth can read delivery match log" ON public.delivery_match_log;
CREATE POLICY "auth can read delivery match log"
  ON public.delivery_match_log FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_delivery_match_log_invoice ON public.delivery_match_log(invoice_id);
CREATE INDEX IF NOT EXISTS idx_delivery_match_log_rule ON public.delivery_match_log(match_rule);
CREATE INDEX IF NOT EXISTS idx_delivery_match_log_time ON public.delivery_match_log(computed_at DESC);

-- ============================================================================
-- 3) STATE COMPUTATION FUNCTION (mirrors JS closure logic)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.compute_invoice_delivery_state_v2(_invoice_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  required_total numeric := 0;
  signed_total numeric := 0;
  active_total numeric := 0;
  new_state text := 'pending';
  inv_status text;
BEGIN
  SELECT status INTO inv_status FROM public.invoices WHERE id = _invoice_id;
  IF inv_status IS NULL THEN RETURN NULL; END IF;

  IF inv_status IN ('draft','voided') THEN
    UPDATE public.invoices
       SET delivery_computed_state = 'na',
           delivery_completed_at = NULL
     WHERE id = _invoice_id;
    RETURN 'na';
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO required_total
  FROM public.invoice_items
  WHERE invoice_id = _invoice_id
    AND product_id IS NOT NULL
    AND quantity > 0;

  SELECT COALESCE(SUM(dri.quantity), 0) INTO signed_total
  FROM public.delivery_receipt_items dri
  JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
  WHERE dr.invoice_id = _invoice_id
    AND dr.status IN ('signed', 'paid');

  SELECT COALESCE(SUM(dri.quantity), 0) INTO active_total
  FROM public.delivery_receipt_items dri
  JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
  WHERE dr.invoice_id = _invoice_id
    AND dr.status IN ('out_for_delivery', 'signed', 'paid');

  IF required_total = 0 THEN
    new_state := 'no_items';
  ELSIF signed_total >= required_total THEN
    new_state := 'complete';
  ELSIF active_total >= required_total THEN
    new_state := 'awaiting_signature';
  ELSIF active_total > 0 OR signed_total > 0 THEN
    new_state := 'partial';
  ELSE
    new_state := 'pending';
  END IF;

  UPDATE public.invoices
     SET delivery_computed_state = new_state,
         delivery_completed_at = CASE
           WHEN new_state = 'complete' THEN COALESCE(delivery_completed_at, now())
           ELSE NULL
         END
   WHERE id = _invoice_id;

  -- Auto-archive signed receipts when invoice is complete; unarchive otherwise.
  IF new_state = 'complete' THEN
    UPDATE public.delivery_receipts
       SET archived_at = COALESCE(archived_at, now())
     WHERE invoice_id = _invoice_id
       AND status IN ('signed','paid')
       AND archived_at IS NULL;
  ELSE
    UPDATE public.delivery_receipts
       SET archived_at = NULL
     WHERE invoice_id = _invoice_id
       AND archived_at IS NOT NULL;
  END IF;

  RETURN new_state;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_invoice_delivery_state_v2(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.compute_invoice_delivery_state_v2(uuid) TO authenticated, service_role;

-- ============================================================================
-- 4) TRIGGERS: recompute on any DR / DR-item change
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tg_dr_recompute_state_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_inv uuid := COALESCE(NEW.invoice_id, NULL);
  old_inv uuid := COALESCE(OLD.invoice_id, NULL);
BEGIN
  IF new_inv IS NOT NULL THEN
    PERFORM public.compute_invoice_delivery_state_v2(new_inv);
  END IF;
  IF old_inv IS NOT NULL AND old_inv IS DISTINCT FROM new_inv THEN
    PERFORM public.compute_invoice_delivery_state_v2(old_inv);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_dri_recompute_state_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv_new uuid;
  inv_old uuid;
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.receipt_id IS NOT NULL THEN
    SELECT invoice_id INTO inv_new FROM public.delivery_receipts WHERE id = NEW.receipt_id;
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.receipt_id IS NOT NULL THEN
    SELECT invoice_id INTO inv_old FROM public.delivery_receipts WHERE id = OLD.receipt_id;
  END IF;
  IF inv_new IS NOT NULL THEN
    PERFORM public.compute_invoice_delivery_state_v2(inv_new);
  END IF;
  IF inv_old IS NOT NULL AND inv_old IS DISTINCT FROM inv_new THEN
    PERFORM public.compute_invoice_delivery_state_v2(inv_old);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_dr_recompute_state_v2 ON public.delivery_receipts;
CREATE TRIGGER trg_dr_recompute_state_v2
AFTER INSERT OR UPDATE OR DELETE ON public.delivery_receipts
FOR EACH ROW EXECUTE FUNCTION public.tg_dr_recompute_state_v2();

DROP TRIGGER IF EXISTS trg_dri_recompute_state_v2 ON public.delivery_receipt_items;
CREATE TRIGGER trg_dri_recompute_state_v2
AFTER INSERT OR UPDATE OR DELETE ON public.delivery_receipt_items
FOR EACH ROW EXECUTE FUNCTION public.tg_dri_recompute_state_v2();

-- Recompute when invoice items change (quantity change should re-evaluate)
CREATE OR REPLACE FUNCTION public.tg_inv_items_recompute_state_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv_new uuid := COALESCE(NEW.invoice_id, NULL);
  inv_old uuid := COALESCE(OLD.invoice_id, NULL);
BEGIN
  IF inv_new IS NOT NULL THEN
    PERFORM public.compute_invoice_delivery_state_v2(inv_new);
  END IF;
  IF inv_old IS NOT NULL AND inv_old IS DISTINCT FROM inv_new THEN
    PERFORM public.compute_invoice_delivery_state_v2(inv_old);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_inv_items_recompute_state_v2 ON public.invoice_items;
CREATE TRIGGER trg_inv_items_recompute_state_v2
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.tg_inv_items_recompute_state_v2();

-- ============================================================================
-- 5) ADMIN MANUAL APPROVAL: force-close a stuck invoice's delivery
-- ============================================================================
CREATE OR REPLACE FUNCTION public.approve_invoice_delivery_manual(_invoice_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: only admins can approve delivery closure';
  END IF;

  UPDATE public.invoices
     SET delivery_status = 'delivered',
         delivery_status_override = TRUE,
         delivery_computed_state = 'complete',
         delivery_completed_at = COALESCE(delivery_completed_at, now())
   WHERE id = _invoice_id;

  UPDATE public.delivery_receipts
     SET archived_at = COALESCE(archived_at, now())
   WHERE invoice_id = _invoice_id
     AND status IN ('signed','paid')
     AND archived_at IS NULL;

  INSERT INTO public.delivery_match_log (invoice_id, match_rule, matched_qty, notes)
  VALUES (_invoice_id, 'admin_manual_approval', 0,
          COALESCE(_reason, 'Admin manually approved delivery closure'));
END;
$$;

REVOKE ALL ON FUNCTION public.approve_invoice_delivery_manual(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_invoice_delivery_manual(uuid, text) TO authenticated;

-- ============================================================================
-- 6) BACKFILL existing invoices
-- ============================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.invoices LOOP
    PERFORM public.compute_invoice_delivery_state_v2(r.id);
  END LOOP;
END $$;