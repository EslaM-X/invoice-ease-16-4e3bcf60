CREATE OR REPLACE FUNCTION public.notify_on_invoice_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_email text;
BEGIN
  IF NEW.total IS NOT DISTINCT FROM OLD.total
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.customer_name IS NOT DISTINCT FROM OLD.customer_name
     AND NEW.discount IS NOT DISTINCT FROM OLD.discount
     AND NEW.paid_amount IS NOT DISTINCT FROM OLD.paid_amount THEN
    RETURN NEW;
  END IF;
  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor;
  INSERT INTO public.notifications (recipient_role, type, title, body, link, meta)
  VALUES ('manager', 'invoice_updated',
    CASE WHEN NEW.status='voided' AND OLD.status<>'voided' THEN 'إلغاء فاتورة ' ELSE 'تعديل فاتورة ' END || NEW.invoice_number,
    COALESCE(v_actor_email,'مستخدم') || ' · الإجمالي ' || NEW.total::text,
    '/invoices/' || NEW.id::text,
    jsonb_build_object('invoice_id', NEW.id, 'actor_id', v_actor, 'actor_email', v_actor_email,
                       'old_total', OLD.total, 'new_total', NEW.total));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_invoice_updated ON public.invoices;
CREATE TRIGGER trg_notify_invoice_updated
AFTER UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.notify_on_invoice_updated();