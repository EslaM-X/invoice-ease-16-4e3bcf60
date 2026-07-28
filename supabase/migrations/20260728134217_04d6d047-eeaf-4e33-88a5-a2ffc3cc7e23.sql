
-- 1) Audit table
CREATE TABLE IF NOT EXISTS public.invoice_archive_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  invoice_number TEXT,
  event_type TEXT NOT NULL,  -- archived | unarchived | regression_prevented | delivery_state_changed | auto_closed | manual_override
  reason TEXT,
  old_archive_ready BOOLEAN,
  new_archive_ready BOOLEAN,
  old_delivery_status TEXT,
  new_delivery_status TEXT,
  old_computed_state TEXT,
  new_computed_state TEXT,
  paid_amount NUMERIC,
  total_amount NUMERIC,
  affected_items JSONB,
  actor_id UUID,
  actor_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.invoice_archive_audit TO authenticated;
GRANT ALL ON public.invoice_archive_audit TO service_role;
ALTER TABLE public.invoice_archive_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "archive_audit_admin_read"
  ON public.invoice_archive_audit FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND i.user_id = auth.uid())
  );

CREATE POLICY "archive_audit_system_insert"
  ON public.invoice_archive_audit FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_archive_audit_invoice_created
  ON public.invoice_archive_audit (invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_archive_audit_event_type_created
  ON public.invoice_archive_audit (event_type, created_at DESC);

-- 2) Auto-lock + audit-writing archive_ready trigger.
--    Replaces set_invoice_archive_ready to (a) preserve archive_ready when the
--    invoice was previously locked (fully paid + delivered), and (b) surface a
--    regression_prevented audit row when something tries to reopen it.
CREATE OR REPLACE FUNCTION public.set_invoice_archive_ready()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  computed BOOLEAN;
  was_locked BOOLEAN := false;
  actor UUID := auth.uid();
  actor_mail TEXT := public.current_user_email();
BEGIN
  computed :=
    COALESCE(NEW.status, '') NOT IN ('draft','voided','void','cancelled','canceled')
    AND COALESCE(NEW.total, 0) > 0
    AND COALESCE(NEW.paid_amount, 0) >= COALESCE(NEW.total, 0) - 0.001
    AND (
      COALESCE(NEW.delivery_computed_state, '') = 'complete'
      OR COALESCE(NEW.delivery_status, '') = 'delivered'
    );

  IF TG_OP = 'UPDATE' THEN
    -- Auto-lock: previously archive_ready AND still fully paid AND not voided
    was_locked :=
      COALESCE(OLD.archive_ready, false) = true
      AND COALESCE(NEW.paid_amount, 0) >= COALESCE(NEW.total, 0) - 0.001
      AND COALESCE(NEW.status, '') NOT IN ('draft','voided','void','cancelled','canceled');

    IF was_locked AND computed = false THEN
      -- Something (usually a computed_state recompute) tried to reopen a
      -- locked invoice: block the reversion and log it.
      NEW.archive_ready := true;
      -- Force delivery_status back to delivered too so downstream UIs stay consistent
      NEW.delivery_status := 'delivered';

      INSERT INTO public.invoice_archive_audit(
        invoice_id, invoice_number, event_type, reason,
        old_archive_ready, new_archive_ready,
        old_delivery_status, new_delivery_status,
        old_computed_state, new_computed_state,
        paid_amount, total_amount,
        actor_id, actor_email
      ) VALUES (
        NEW.id, NEW.invoice_number, 'regression_prevented',
        'Locked invoice (fully paid + previously archived) attempted to revert to open list',
        OLD.archive_ready, true,
        OLD.delivery_status, 'delivered',
        OLD.delivery_computed_state, NEW.delivery_computed_state,
        NEW.paid_amount, NEW.total,
        actor, actor_mail
      );
    ELSE
      NEW.archive_ready := computed;
    END IF;

    -- Log every genuine flip so admins have a full timeline
    IF COALESCE(OLD.archive_ready, false) IS DISTINCT FROM COALESCE(NEW.archive_ready, false) THEN
      INSERT INTO public.invoice_archive_audit(
        invoice_id, invoice_number, event_type, reason,
        old_archive_ready, new_archive_ready,
        old_delivery_status, new_delivery_status,
        old_computed_state, new_computed_state,
        paid_amount, total_amount,
        actor_id, actor_email
      ) VALUES (
        NEW.id, NEW.invoice_number,
        CASE WHEN NEW.archive_ready THEN 'archived' ELSE 'unarchived' END,
        CASE
          WHEN NEW.archive_ready THEN 'Fully paid and delivered — auto archived'
          ELSE 'Archive flag cleared — invoice re-opened'
        END,
        OLD.archive_ready, NEW.archive_ready,
        OLD.delivery_status, NEW.delivery_status,
        OLD.delivery_computed_state, NEW.delivery_computed_state,
        NEW.paid_amount, NEW.total,
        actor, actor_mail
      );
    ELSIF COALESCE(OLD.delivery_computed_state,'') IS DISTINCT FROM COALESCE(NEW.delivery_computed_state,'') THEN
      INSERT INTO public.invoice_archive_audit(
        invoice_id, invoice_number, event_type, reason,
        old_archive_ready, new_archive_ready,
        old_delivery_status, new_delivery_status,
        old_computed_state, new_computed_state,
        paid_amount, total_amount,
        actor_id, actor_email
      ) VALUES (
        NEW.id, NEW.invoice_number, 'delivery_state_changed',
        'Computed delivery state recalculated',
        OLD.archive_ready, NEW.archive_ready,
        OLD.delivery_status, NEW.delivery_status,
        OLD.delivery_computed_state, NEW.delivery_computed_state,
        NEW.paid_amount, NEW.total,
        actor, actor_mail
      );
    END IF;
  ELSE
    NEW.archive_ready := computed;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3) After a receipt is inserted/updated/signed, re-check the parent invoice and
--    force-close it when quantities are fully covered and the invoice is fully paid.
CREATE OR REPLACE FUNCTION public.tg_auto_close_invoice_from_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  target_invoice UUID := COALESCE(NEW.invoice_id, OLD.invoice_id);
  new_state TEXT;
  inv_paid NUMERIC;
  inv_total NUMERIC;
  inv_status TEXT;
BEGIN
  IF target_invoice IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only act when at least one signed receipt exists for this invoice
  IF NOT EXISTS (
    SELECT 1 FROM public.delivery_receipts
    WHERE invoice_id = target_invoice AND status IN ('signed','paid')
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  new_state := public.compute_invoice_delivery_state_v2(target_invoice);

  SELECT paid_amount, total, status
    INTO inv_paid, inv_total, inv_status
  FROM public.invoices WHERE id = target_invoice;

  IF inv_status IN ('draft','voided','void','cancelled','canceled') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF new_state = 'complete'
     AND COALESCE(inv_paid,0) >= COALESCE(inv_total,0) - 0.001 THEN
    UPDATE public.invoices
       SET delivery_status = 'delivered',
           delivery_completed_at = COALESCE(delivery_completed_at, now())
     WHERE id = target_invoice
       AND (delivery_status IS DISTINCT FROM 'delivered' OR delivery_completed_at IS NULL);

    INSERT INTO public.invoice_archive_audit(
      invoice_id, invoice_number, event_type, reason,
      paid_amount, total_amount, new_computed_state, new_delivery_status
    )
    SELECT id, invoice_number, 'auto_closed',
           'Background audit: receipt signing covered full quantities on a fully-paid invoice',
           paid_amount, total, 'complete', 'delivered'
      FROM public.invoices WHERE id = target_invoice;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_dr_auto_close_invoice ON public.delivery_receipts;
CREATE TRIGGER trg_dr_auto_close_invoice
  AFTER INSERT OR UPDATE OF status ON public.delivery_receipts
  FOR EACH ROW EXECUTE FUNCTION public.tg_auto_close_invoice_from_receipt();
