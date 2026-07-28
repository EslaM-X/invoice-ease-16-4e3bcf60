CREATE OR REPLACE FUNCTION public.set_invoice_archive_ready()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.archive_ready :=
    COALESCE(NEW.status, '') NOT IN ('draft', 'voided', 'void', 'cancelled', 'canceled')
    AND COALESCE(NEW.total, 0) > 0
    AND COALESCE(NEW.paid_amount, 0) >= COALESCE(NEW.total, 0) - 0.001
    AND (
      COALESCE(NEW.delivery_computed_state, '') = 'complete'
      OR COALESCE(NEW.delivery_status, '') = 'delivered'
    );

  RETURN NEW;
END;
$function$;

UPDATE public.invoices
SET archive_ready =
  COALESCE(status, '') NOT IN ('draft', 'voided', 'void', 'cancelled', 'canceled')
  AND COALESCE(total, 0) > 0
  AND COALESCE(paid_amount, 0) >= COALESCE(total, 0) - 0.001
  AND (
    COALESCE(delivery_computed_state, '') = 'complete'
    OR COALESCE(delivery_status, '') = 'delivered'
  );