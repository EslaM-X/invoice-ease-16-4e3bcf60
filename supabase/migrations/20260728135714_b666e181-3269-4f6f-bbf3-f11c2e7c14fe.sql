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
    -- Auto-lock ONLY when delivery is still actually complete
    was_locked :=
      COALESCE(OLD.archive_ready, false) = true
      AND COALESCE(NEW.paid_amount, 0) >= COALESCE(NEW.total, 0) - 0.001
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

-- Reopen #134: not truly delivered
UPDATE public.invoices
SET archive_ready = false,
    delivery_status = 'in_transit',
    delivery_computed_state = 'partial',
    delivery_completed_at = NULL
WHERE invoice_number = 'INV-2026-00134';