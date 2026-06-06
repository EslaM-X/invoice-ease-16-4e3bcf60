
-- 1) Hide HMAC secret from any authenticated reads; only service_role can read it.
REVOKE SELECT (hmac_secret) ON public.notification_dispatch_config FROM authenticated;
REVOKE SELECT (hmac_secret) ON public.notification_dispatch_config FROM anon;

-- 2) Lock down direct writes on tables whose mutations must go through SECURITY DEFINER RPCs.
--    These already have no INSERT/UPDATE/DELETE policies (so RLS denies by default), but we
--    also revoke the table privileges to make the intent explicit and survive future policy edits.
REVOKE INSERT, UPDATE, DELETE ON public.delivery_receipt_audit_log FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.invoice_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.po_receipt_items FROM authenticated;

-- service_role retains full access for SECURITY DEFINER functions and edge functions.
GRANT ALL ON public.notification_dispatch_config TO service_role;
GRANT ALL ON public.delivery_receipt_audit_log TO service_role;
GRANT ALL ON public.invoice_events TO service_role;
GRANT ALL ON public.po_receipt_items TO service_role;
