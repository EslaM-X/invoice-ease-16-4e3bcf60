ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_delivery_days_valid;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_delivery_days_valid
  CHECK (delivery_days IS NULL OR delivery_days IN (7, 21, 30, 45, 60));