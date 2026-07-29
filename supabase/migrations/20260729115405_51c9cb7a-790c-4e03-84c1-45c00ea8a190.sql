DROP POLICY IF EXISTS archive_audit_system_insert ON public.invoice_archive_audit;

CREATE POLICY archive_audit_scoped_insert ON public.invoice_archive_audit
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_archive_audit.invoice_id
        AND i.user_id = auth.uid()
    )
  );