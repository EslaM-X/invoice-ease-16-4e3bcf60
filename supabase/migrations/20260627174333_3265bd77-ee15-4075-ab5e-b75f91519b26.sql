
-- 1) shipping_address column on invoices (used by distributor portal + builder)
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS shipping_address text;

-- 2) Delete a distributor payout (admin only) + notify distributor
CREATE OR REPLACE FUNCTION public.delete_distributor_payout(_payout_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout public.distributor_payouts;
  v_dist_user uuid;
  v_dist_name text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can delete payouts';
  END IF;
  SELECT * INTO v_payout FROM public.distributor_payouts WHERE id = _payout_id;
  IF v_payout.id IS NULL THEN RAISE EXCEPTION 'Payout not found'; END IF;

  DELETE FROM public.distributor_payouts WHERE id = _payout_id;

  SELECT user_id, name INTO v_dist_user, v_dist_name
  FROM public.distributors WHERE id = v_payout.distributor_id;

  IF v_dist_user IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, body, link, meta)
    VALUES (v_dist_user, 'distributor_payout_deleted',
      'تم تعديل/حذف دفعة',
      'تم حذف دفعة بقيمة ' || v_payout.amount::text || ' ج.م من سجل دفعاتك',
      '/distributor',
      jsonb_build_object('amount', v_payout.amount, 'paid_at', v_payout.paid_at));
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_distributor_payout(uuid) TO authenticated;

-- 3) Upgrade approve_distributor_invoice to upsert customer record + carry classification
CREATE OR REPLACE FUNCTION public.approve_distributor_invoice(_invoice_id uuid, _discount_pct numeric DEFAULT 0, _notes text DEFAULT NULL)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.invoices;
  v_dist_user uuid;
  v_customer_id uuid;
BEGIN
  IF NOT is_company_member() THEN
    RAISE EXCEPTION 'Only company members can approve invoices';
  END IF;

  UPDATE public.invoices
  SET approval_status = 'approved',
      approval_discount_pct = COALESCE(_discount_pct, 0),
      distributor_commission_amount = ROUND(subtotal * COALESCE(_discount_pct,0) / 100.0, 2),
      approval_notes = _notes,
      approved_by = auth.uid(),
      approved_at = now(),
      status = 'unpaid',
      discount = 0,
      total = subtotal,
      sales_channel = COALESCE(sales_channel, 'distributor')
  WHERE id = _invoice_id AND source = 'distributor' AND approval_status = 'pending'
  RETURNING * INTO v_inv;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found or not pending'; END IF;

  -- Auto-create / link customer record on the company owner side
  IF v_inv.customer_id IS NULL AND COALESCE(NULLIF(trim(v_inv.customer_name), ''), '') <> '' THEN
    -- Try to match an existing customer by name+phone on the invoice's user_id
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE user_id = v_inv.user_id
      AND lower(trim(name)) = lower(trim(v_inv.customer_name))
      AND COALESCE(phone,'') = COALESCE(v_inv.customer_phone,'')
    LIMIT 1;

    IF v_customer_id IS NULL THEN
      INSERT INTO public.customers(user_id, name, phone, address, sales_channel, source_notes)
      VALUES (v_inv.user_id, v_inv.customer_name, v_inv.customer_phone,
              COALESCE(v_inv.shipping_address, v_inv.customer_address),
              'distributor',
              'تم إنشاؤه تلقائياً من فاتورة موزّع ' || v_inv.invoice_number)
      RETURNING id INTO v_customer_id;
    ELSE
      -- Refresh address if missing
      UPDATE public.customers
      SET address = COALESCE(address, v_inv.shipping_address, v_inv.customer_address),
          sales_channel = COALESCE(sales_channel, 'distributor')
      WHERE id = v_customer_id;
    END IF;

    UPDATE public.invoices SET customer_id = v_customer_id WHERE id = v_inv.id;
    v_inv.customer_id := v_customer_id;
  END IF;

  -- Notify distributor
  SELECT user_id INTO v_dist_user FROM public.distributors WHERE id = v_inv.distributor_id;
  IF v_dist_user IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, body, link, meta)
    VALUES (v_dist_user, 'distributor_invoice_approved',
      'تمت الموافقة على فاتورتك',
      'فاتورة ' || v_inv.invoice_number || ' — عمولتك: ' || v_inv.distributor_commission_amount::text || ' ج.م',
      '/distributor',
      jsonb_build_object('invoice_id', v_inv.id, 'commission', v_inv.distributor_commission_amount));
  END IF;

  RETURN v_inv;
END;
$$;
