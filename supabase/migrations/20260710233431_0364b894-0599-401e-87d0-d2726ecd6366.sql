-- Speed up the Cost Book aggregations, override lookups, and audit-log queries.
-- All read-only additions; no schema or policy changes.

-- Cost Book aggregates per product across PO items → the join hot path.
CREATE INDEX IF NOT EXISTS idx_po_items_product
  ON public.purchase_order_items(product_id);

-- Cost Book filters POs by status ∈ (priced, partially_received, received, closed)
-- and by shipment_date for fiscal-year windows.
CREATE INDEX IF NOT EXISTS idx_po_status_shipdate
  ON public.purchase_orders(status, shipment_date);

-- Audit log listing scans by time; the product_id+time index already exists but
-- the audit page also lists everything by time and filters by actor email.
CREATE INDEX IF NOT EXISTS idx_pcoh_changed_at
  ON public.profit_cost_overrides_history(changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_pcoh_changed_by_email
  ON public.profit_cost_overrides_history(changed_by_email);

CREATE INDEX IF NOT EXISTS idx_pcoh_action
  ON public.profit_cost_overrides_history(action);

-- Enable realtime for the audit-log table so the new page can reflect changes live.
ALTER PUBLICATION supabase_realtime ADD TABLE public.profit_cost_overrides_history;