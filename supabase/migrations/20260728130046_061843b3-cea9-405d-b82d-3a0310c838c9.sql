ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS archive_ready boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_invoice_archive_ready()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.archive_ready :=
    COALESCE(NEW.status, '') NOT IN ('draft', 'voided')
    AND COALESCE(NEW.delivery_computed_state, '') = 'complete'
    AND COALESCE(NEW.total, 0) > 0
    AND COALESCE(NEW.paid_amount, 0) >= COALESCE(NEW.total, 0) - 0.001;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_set_invoice_archive_ready ON public.invoices;
CREATE TRIGGER trg_set_invoice_archive_ready
BEFORE INSERT OR UPDATE OF status, total, paid_amount, delivery_computed_state
ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.set_invoice_archive_ready();

CREATE INDEX IF NOT EXISTS idx_invoices_archive_ready_created_at
  ON public.invoices (archive_ready, created_at DESC)
  WHERE archive_ready = true;

UPDATE public.invoices
SET archive_ready =
  COALESCE(status, '') NOT IN ('draft', 'voided')
  AND COALESCE(delivery_computed_state, '') = 'complete'
  AND COALESCE(total, 0) > 0
  AND COALESCE(paid_amount, 0) >= COALESCE(total, 0) - 0.001
WHERE archive_ready IS DISTINCT FROM (
  COALESCE(status, '') NOT IN ('draft', 'voided')
  AND COALESCE(delivery_computed_state, '') = 'complete'
  AND COALESCE(total, 0) > 0
  AND COALESCE(paid_amount, 0) >= COALESCE(total, 0) - 0.001
);