ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS payment_installment_1_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_installment_1_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS payment_installment_1_by_email TEXT,
  ADD COLUMN IF NOT EXISTS payment_installment_2_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_installment_2_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS payment_installment_2_by_email TEXT;

-- Migrate any old statuses to the new flow (no records exist today, but keep safe)
UPDATE public.purchase_orders SET status = 'ordered' WHERE status IN ('payment_pending','paid');