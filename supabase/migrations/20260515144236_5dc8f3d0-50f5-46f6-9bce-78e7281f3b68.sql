
-- 1) Biometric auth log: restrict SELECT to owner + admin
DROP POLICY IF EXISTS "users view own biometric attempts" ON public.biometric_auth_log;
CREATE POLICY "users view own biometric attempts"
ON public.biometric_auth_log
FOR SELECT
TO authenticated
USING ((auth.uid() = user_id) OR is_admin());

-- 2) Revoke EXECUTE from anon/public on SECURITY DEFINER functions.
--    Trigger functions don't need EXECUTE grants; user-callable RPCs are
--    invoked by authenticated users only.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname IN (
        'record_stock_intake','revert_po_inventory','create_delivery_receipt',
        'update_delivery_receipt','apply_po_to_inventory','apply_po_receipt',
        'recalc_invoice_delivery_status','tg_recalc_delivery_status',
        'tg_recalc_on_receipt_delete','log_product_price_changes',
        'dispatch_push_for_notification','prevent_profile_approval_self_edit',
        'assign_admin_on_signup','tg_dr_audit','current_user_email',
        'notify_on_invoice_created','notify_on_call_logged','notify_on_low_stock',
        'trg_po_before_delete','trg_po_after_cancel','handle_new_user',
        'notify_invoice_event','notify_po_status_change','notify_low_stock',
        'notify_on_invoice_updated','set_audit_columns','set_inventory_actor',
        'write_audit_log','add_company_member_on_signup','auto_assign_special_roles',
        'log_invoice_system_notes_change'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon;',
                   r.proname, r.args);
  END LOOP;
END $$;
