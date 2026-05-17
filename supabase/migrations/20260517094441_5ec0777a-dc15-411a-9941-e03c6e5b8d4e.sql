
CREATE OR REPLACE FUNCTION public.convert_invoice_to_draft(_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_invoice record;
  v_item record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = _invoice_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  IF v_invoice.status = 'draft' THEN
    RETURN _invoice_id;
  END IF;

  IF v_invoice.status = 'voided' THEN
    RAISE EXCEPTION 'CANNOT_CONVERT_VOIDED' USING ERRCODE = '22023';
  END IF;

  -- Restore stock for each line item (mirrors void_invoice behaviour)
  FOR v_item IN
    SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id
  LOOP
    IF v_item.product_id IS NOT NULL THEN
      PERFORM 1 FROM public.products WHERE id = v_item.product_id FOR UPDATE;
      UPDATE public.products
        SET stock_quantity = stock_quantity + v_item.quantity
        WHERE id = v_item.product_id;
      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id)
      VALUES (v_user_id, v_item.product_id, v_item.quantity,
              'convert-to-draft ' || v_invoice.invoice_number, _invoice_id);
    END IF;
  END LOOP;

  UPDATE public.invoices
    SET status = 'draft', updated_at = now()
    WHERE id = _invoice_id;

  RETURN _invoice_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_invoice_to_draft(uuid) TO authenticated;
