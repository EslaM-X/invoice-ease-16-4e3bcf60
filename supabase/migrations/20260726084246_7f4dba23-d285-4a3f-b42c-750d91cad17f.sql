
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS delivery_assignee_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_assignee_label text NULL;
