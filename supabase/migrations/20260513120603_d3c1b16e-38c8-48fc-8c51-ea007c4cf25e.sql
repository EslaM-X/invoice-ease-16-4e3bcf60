ALTER TABLE public.purchase_orders
ADD COLUMN IF NOT EXISTS final_discount_percent NUMERIC NOT NULL DEFAULT 0;