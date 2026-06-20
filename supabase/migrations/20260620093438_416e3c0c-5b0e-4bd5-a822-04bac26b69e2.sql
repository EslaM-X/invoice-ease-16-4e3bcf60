CREATE OR REPLACE FUNCTION public.fulfill_reservations_on_po_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  END IF;

  IF NEW.status = 'received' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    FOR r IN
      SELECT id, product_id, quantity, invoice_id
        FROM public.invoice_po_reservations
       WHERE po_id = NEW.id AND status = 'active'
    LOOP
      UPDATE public.invoice_po_reservations
         SET status = 'fulfilled', fulfilled_at = now()
       WHERE id = r.id;
      UPDATE public.products SET stock_quantity = GREATEST(0, stock_quantity - r.quantity) WHERE id = r.product_id;
      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id, actor_id, actor_email)
      SELECT p.user_id, p.id, -r.quantity, 'reservation-fulfilled PO ' || NEW.po_number, r.invoice_id, v_uid, v_email
      FROM public.products p WHERE p.id = r.product_id;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;