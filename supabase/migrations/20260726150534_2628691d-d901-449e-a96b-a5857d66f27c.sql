-- Delivery receipts: allow visibility/edit via parent invoice access
CREATE POLICY "company sees dr via invoice" ON public.delivery_receipts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = delivery_receipts.invoice_id
      AND (public.can_access_user_data(i.user_id)
           OR (public.is_company_member() AND i.source = 'distributor'))
  ));

CREATE POLICY "company updates dr via invoice" ON public.delivery_receipts
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = delivery_receipts.invoice_id
      AND (public.can_access_user_data(i.user_id)
           OR (public.is_company_member() AND i.source = 'distributor'))
  ));

CREATE POLICY "company inserts dr via invoice" ON public.delivery_receipts
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = delivery_receipts.invoice_id
      AND (public.can_access_user_data(i.user_id)
           OR (public.is_company_member() AND i.source = 'distributor'))
  ));

CREATE POLICY "company deletes dr via invoice" ON public.delivery_receipts
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = delivery_receipts.invoice_id
      AND (public.can_access_user_data(i.user_id)
           OR (public.is_company_member() AND i.source = 'distributor'))
  ));

-- Delivery receipt items: mirror via parent receipt → invoice
CREATE POLICY "dri select via invoice" ON public.delivery_receipt_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.delivery_receipts r
    JOIN public.invoices i ON i.id = r.invoice_id
    WHERE r.id = delivery_receipt_items.receipt_id
      AND (public.can_access_user_data(i.user_id)
           OR (public.is_company_member() AND i.source = 'distributor'))
  ));

CREATE POLICY "dri update via invoice" ON public.delivery_receipt_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.delivery_receipts r
    JOIN public.invoices i ON i.id = r.invoice_id
    WHERE r.id = delivery_receipt_items.receipt_id
      AND (public.can_access_user_data(i.user_id)
           OR (public.is_company_member() AND i.source = 'distributor'))
  ));

CREATE POLICY "dri insert via invoice" ON public.delivery_receipt_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.delivery_receipts r
    JOIN public.invoices i ON i.id = r.invoice_id
    WHERE r.id = delivery_receipt_items.receipt_id
      AND (public.can_access_user_data(i.user_id)
           OR (public.is_company_member() AND i.source = 'distributor'))
  ));

CREATE POLICY "dri delete via invoice" ON public.delivery_receipt_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.delivery_receipts r
    JOIN public.invoices i ON i.id = r.invoice_id
    WHERE r.id = delivery_receipt_items.receipt_id
      AND (public.can_access_user_data(i.user_id)
           OR (public.is_company_member() AND i.source = 'distributor'))
  ));