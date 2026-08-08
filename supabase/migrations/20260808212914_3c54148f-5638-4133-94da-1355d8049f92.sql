CREATE OR REPLACE FUNCTION public.fulfill_reservations_on_po_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  -- When a PO is received, reservations tied to it are simply marked fulfilled.
  -- Stock must NOT be deducted here: the received quantity is added by the PO
  -- receipt, historical delivery receipts are back-deducted separately, and the
  -- real deduction happens on delivery-receipt signature (apply_delivery_signature).
  IF NEW.status = 'received' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    FOR r IN
      SELECT id FROM public.invoice_po_reservations
       WHERE po_id = NEW.id AND status = 'active'
    LOOP
      UPDATE public.invoice_po_reservations
         SET status = 'fulfilled', fulfilled_at = now()
       WHERE id = r.id;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;