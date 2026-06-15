
ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_number text;

CREATE INDEX IF NOT EXISTS idx_call_logs_invoice ON public.call_logs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_invoice_number ON public.call_logs(invoice_number);
CREATE INDEX IF NOT EXISTS idx_call_logs_phone ON public.call_logs(customer_phone);
