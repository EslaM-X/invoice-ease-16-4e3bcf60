REVOKE ALL ON FUNCTION public.resolve_delivery_receipt_item_invoice_item() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_delivery_receipt_item_invoice_item() FROM anon;
REVOKE ALL ON FUNCTION public.resolve_delivery_receipt_item_invoice_item() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_delivery_receipt_item_invoice_item() TO service_role;