
-- Active invoices by date (used by Profits page: excludes voided/draft, filters by created_at range)
CREATE INDEX IF NOT EXISTS idx_invoices_active_created
  ON public.invoices (created_at DESC)
  WHERE status NOT IN ('voided','draft');

-- General (status, created_at) for status-scoped listings
CREATE INDEX IF NOT EXISTS idx_invoices_status_created
  ON public.invoices (status, created_at DESC);

-- Customer + created (customer detail views scoped by date)
CREATE INDEX IF NOT EXISTS idx_invoices_customer_created
  ON public.invoices (customer_id, created_at DESC);

-- invoice_items: per-product analytics (Per-Product Profit table)
CREATE INDEX IF NOT EXISTS idx_invoice_items_product_invoice
  ON public.invoice_items (product_id, invoice_id);

-- inventory_logs: product timeline lookups in Inventory Traceability details dialog
CREATE INDEX IF NOT EXISTS idx_inventory_logs_product_created
  ON public.inventory_logs (product_id, created_at DESC);

ANALYZE public.invoices;
ANALYZE public.invoice_items;
ANALYZE public.inventory_logs;
