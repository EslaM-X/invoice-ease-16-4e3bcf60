ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_receipt_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
CREATE INDEX IF NOT EXISTS tasks_invoice_id_idx ON public.tasks(invoice_id);