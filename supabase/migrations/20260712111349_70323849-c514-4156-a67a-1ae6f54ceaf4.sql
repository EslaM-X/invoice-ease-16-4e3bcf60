ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS delivery_days integer NULL;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_delivery_days_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_delivery_days_check CHECK (delivery_days IS NULL OR delivery_days IN (7,21,30,45,60));