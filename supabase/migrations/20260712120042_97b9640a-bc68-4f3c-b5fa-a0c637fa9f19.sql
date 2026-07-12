DROP POLICY IF EXISTS "restricted po delete" ON public.purchase_orders;
CREATE POLICY "restricted po delete" ON public.purchase_orders
  FOR DELETE
  USING (
    can_access_user_data(user_id)
    AND has_role(auth.uid(), 'po_deleter'::app_role)
  );