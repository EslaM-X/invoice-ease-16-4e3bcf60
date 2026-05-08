ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS cost_price numeric NOT NULL DEFAULT 0;