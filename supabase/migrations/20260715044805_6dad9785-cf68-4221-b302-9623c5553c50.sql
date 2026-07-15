ALTER TABLE public.delivery_receipts
  ADD COLUMN IF NOT EXISTS layout_version smallint NOT NULL DEFAULT 2;

-- Freeze every existing receipt to the legacy layout so their PDFs stay identical
UPDATE public.delivery_receipts SET layout_version = 1 WHERE layout_version = 2;