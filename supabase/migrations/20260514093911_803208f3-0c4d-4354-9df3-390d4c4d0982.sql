DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_orders;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_order_items;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_receipts;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_receipt_items;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

ALTER TABLE public.purchase_orders REPLICA IDENTITY FULL;
ALTER TABLE public.purchase_order_items REPLICA IDENTITY FULL;
ALTER TABLE public.delivery_receipts REPLICA IDENTITY FULL;
ALTER TABLE public.delivery_receipt_items REPLICA IDENTITY FULL;