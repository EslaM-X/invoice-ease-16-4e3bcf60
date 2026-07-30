CREATE OR REPLACE FUNCTION public.set_invoice_archive_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  computed BOOLEAN;
  was_locked BOOLEAN := false;
  actor UUID := auth.uid();
  actor_mail TEXT := public.current_user_email();
  is_paid BOOLEAN := false;
BEGIN
  is_paid := COALESCE(NEW.paid_amount, 0) >= COALESCE(NEW.total, 0) - 0.001;

  computed :=
    COALESCE(NEW.status, '') NOT IN ('draft','voided','void','cancelled','canceled')
    AND COALESCE(NEW.total, 0) > 0
    AND is_paid
    AND (
      COALESCE(NEW.delivery_computed_state, '') = 'complete'
      OR COALESCE(NEW.delivery_status, '') = 'delivered'
    );

  IF TG_OP = 'UPDATE' THEN
    was_locked :=
      COALESCE(OLD.archive_ready, false) = true
      AND is_paid
      AND COALESCE(NEW.status, '') NOT IN ('draft','voided','void','cancelled','canceled')
      AND (
        COALESCE(NEW.delivery_computed_state,'') = 'complete'
        OR COALESCE(NEW.delivery_status,'') = 'delivered'
      );

    IF was_locked AND computed = false THEN
      NEW.archive_ready := true;
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
        'Locked invoice (fully paid + delivered + previously archived) attempted to revert to open list',
        OLD.archive_ready, true,
        OLD.delivery_status, 'delivered',
        OLD.delivery_computed_state, NEW.delivery_computed_state,
        NEW.paid_amount, NEW.total,
        actor, actor_mail
      );
    ELSE
      NEW.archive_ready := computed;
    END IF;

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
          WHEN NEW.archive_ready THEN 'Fully delivered AND fully paid — auto archived'
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
$$;

CREATE OR REPLACE FUNCTION public.sync_invoice_archive_from_delivery_receipt(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state text;
BEGIN
  IF _invoice_id IS NULL THEN
    RETURN;
  END IF;

  v_state := public.compute_invoice_delivery_state_v2(_invoice_id);

  UPDATE public.invoices i
     SET delivery_computed_state = v_state,
         delivery_status = CASE WHEN v_state = 'complete' THEN 'delivered' ELSE COALESCE(i.delivery_status, 'pending') END,
         archive_ready = (
           COALESCE(i.status, '') NOT IN ('draft','voided','void','cancelled','canceled')
           AND COALESCE(i.total, 0) > 0
           AND v_state = 'complete'
           AND COALESCE(i.paid_amount, 0) >= COALESCE(i.total, 0) - 0.001
         ),
         updated_at = now()
   WHERE i.id = _invoice_id
     AND COALESCE(i.status, '') NOT IN ('draft','voided','void','cancelled','canceled');
END;
$$;

-- Re-open currently archived invoices that are not fully paid
UPDATE public.invoices
   SET updated_at = now()
 WHERE COALESCE(archive_ready, false) = true
   AND COALESCE(paid_amount, 0) < COALESCE(total, 0) - 0.001;