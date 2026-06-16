ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS received_without_payment boolean NOT NULL DEFAULT false;