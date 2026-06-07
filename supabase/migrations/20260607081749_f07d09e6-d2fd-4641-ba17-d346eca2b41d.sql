
-- delivery_receipt_audit_log: allow inserts by users that can access the parent receipt
CREATE POLICY "company dr audit insert" ON public.delivery_receipt_audit_log
FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.delivery_receipts r
  WHERE r.id = delivery_receipt_audit_log.receipt_id
    AND can_access_user_data(r.user_id)
));

-- invoice_events: allow inserts by company members for their own user_id
CREATE POLICY "company invoice events insert" ON public.invoice_events
FOR INSERT TO authenticated
WITH CHECK (can_access_user_data(user_id));

-- po_receipts: writes scoped to user_id with company access
CREATE POLICY "company po receipts insert" ON public.po_receipts
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND can_access_user_data(user_id));

CREATE POLICY "company po receipts update" ON public.po_receipts
FOR UPDATE TO authenticated
USING (can_access_user_data(user_id))
WITH CHECK (can_access_user_data(user_id));

CREATE POLICY "admin po receipts delete" ON public.po_receipts
FOR DELETE TO authenticated
USING (is_admin());

-- po_receipt_items: writes via parent receipt access
CREATE POLICY "company po receipt items insert" ON public.po_receipt_items
FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.po_receipts r
  WHERE r.id = po_receipt_items.receipt_id
    AND can_access_user_data(r.user_id)
));

CREATE POLICY "company po receipt items update" ON public.po_receipt_items
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.po_receipts r
  WHERE r.id = po_receipt_items.receipt_id
    AND can_access_user_data(r.user_id)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.po_receipts r
  WHERE r.id = po_receipt_items.receipt_id
    AND can_access_user_data(r.user_id)
));

CREATE POLICY "admin po receipt items delete" ON public.po_receipt_items
FOR DELETE TO authenticated
USING (is_admin());

-- price_list_price_history: restrict reads to company members
DROP POLICY IF EXISTS "authenticated view price history" ON public.price_list_price_history;
CREATE POLICY "company members view price history" ON public.price_list_price_history
FOR SELECT TO authenticated
USING (is_company_member());

-- stock_intake_items: add update/delete via parent
CREATE POLICY "company stock_intake_items update" ON public.stock_intake_items
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.stock_intakes s
  WHERE s.id = stock_intake_items.intake_id
    AND can_access_user_data(s.user_id)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.stock_intakes s
  WHERE s.id = stock_intake_items.intake_id
    AND can_access_user_data(s.user_id)
));

CREATE POLICY "company stock_intake_items delete" ON public.stock_intake_items
FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.stock_intakes s
  WHERE s.id = stock_intake_items.intake_id
    AND can_access_user_data(s.user_id)
));

-- zoho_sync_state: writes restricted to admins
CREATE POLICY "admins insert zoho sync state" ON public.zoho_sync_state
FOR INSERT TO authenticated
WITH CHECK (is_admin());

CREATE POLICY "admins update zoho sync state" ON public.zoho_sync_state
FOR UPDATE TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

CREATE POLICY "admins delete zoho sync state" ON public.zoho_sync_state
FOR DELETE TO authenticated
USING (is_admin());
