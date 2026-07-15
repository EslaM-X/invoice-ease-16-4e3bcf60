
CREATE OR REPLACE FUNCTION public.notify_shortage_request_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_name text;
  v_invoice_number text;
  v_invoice_id uuid;
  v_link text;
  v_meta jsonb;
  v_title text;
  v_body text;
BEGIN
  SELECT name INTO v_product_name FROM public.products WHERE id = NEW.product_id;
  v_invoice_id := NEW.invoice_id;
  IF v_invoice_id IS NOT NULL THEN
    SELECT invoice_number INTO v_invoice_number FROM public.invoices WHERE id = v_invoice_id;
    v_link := '/invoices/' || v_invoice_id::text;
  ELSE
    v_link := '/stock-shortages';
  END IF;

  v_meta := jsonb_build_object(
    'shortage_request_id', NEW.id,
    'product_id', NEW.product_id,
    'invoice_id', NEW.invoice_id,
    'quantity', NEW.quantity,
    'status', NEW.status
  );

  IF TG_OP = 'INSERT' THEN
    v_title := 'طلب كمية ناقصة جديد';
    v_body := COALESCE(v_product_name, 'منتج') || ' — كمية ' || NEW.quantity::text
              || COALESCE(' · فاتورة ' || v_invoice_number, '');

    -- Notify admins and purchasing team
    INSERT INTO public.notifications (recipient_role, type, title, body, link, meta)
    VALUES
      ('admin'::app_role, 'shortage_request_created', v_title, v_body, v_link, v_meta),
      ('purchasing'::app_role, 'shortage_request_created', v_title, v_body, v_link, v_meta);

  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_title := 'تحديث حالة طلب النقص: ' || NEW.status;
    v_body := COALESCE(v_product_name, 'منتج') || ' — كمية ' || NEW.quantity::text
              || COALESCE(' · فاتورة ' || v_invoice_number, '');

    -- Notify the requester
    IF NEW.requested_by IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link, meta)
      VALUES (NEW.requested_by, 'shortage_request_status', v_title, v_body, v_link, v_meta);
    END IF;

    -- Also notify admins on resolution transitions (ordered/received/cancelled)
    IF NEW.status IN ('ordered','received','cancelled') THEN
      INSERT INTO public.notifications (recipient_role, type, title, body, link, meta)
      VALUES ('admin'::app_role, 'shortage_request_status', v_title, v_body, v_link, v_meta);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shortage_requests_notify_ins ON public.shortage_requests;
DROP TRIGGER IF EXISTS trg_shortage_requests_notify_upd ON public.shortage_requests;

CREATE TRIGGER trg_shortage_requests_notify_ins
AFTER INSERT ON public.shortage_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_shortage_request_change();

CREATE TRIGGER trg_shortage_requests_notify_upd
AFTER UPDATE OF status ON public.shortage_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_shortage_request_change();
