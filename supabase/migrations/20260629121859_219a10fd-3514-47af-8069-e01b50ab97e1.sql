
-- Fix: customers created from distributor invoice approval must be owned by a company member (the approving admin) so they show in /customers
CREATE OR REPLACE FUNCTION public.approve_distributor_invoice(_invoice_id uuid, _discount_pct numeric DEFAULT 0, _notes text DEFAULT NULL::text, _customer_category text DEFAULT NULL::text, _sales_event_id uuid DEFAULT NULL::uuid)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inv public.invoices;
  v_dist_user uuid;
  v_customer_id uuid;
  v_owner uuid;
BEGIN
  IF NOT is_company_member() THEN RAISE EXCEPTION 'Only company members can approve invoices'; END IF;

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
      sales_channel = COALESCE(sales_channel, 'distributor'),
      customer_category = COALESCE(_customer_category, customer_category),
      sales_event_id    = COALESCE(_sales_event_id, sales_event_id)
  WHERE id = _invoice_id AND source = 'distributor' AND approval_status = 'pending'
  RETURNING * INTO v_inv;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found or not pending'; END IF;

  -- Owner for customer record must be a company member so admins can see it via RLS.
  v_owner := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM public.company_members WHERE user_id = v_owner) THEN
    SELECT user_id INTO v_owner FROM public.company_members ORDER BY added_at LIMIT 1;
  END IF;

  IF COALESCE(NULLIF(trim(v_inv.customer_name), ''), '') <> '' THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE user_id = v_owner
      AND lower(trim(name)) = lower(trim(v_inv.customer_name))
      AND COALESCE(phone,'') = COALESCE(v_inv.customer_phone,'')
    LIMIT 1;

    IF v_customer_id IS NULL THEN
      INSERT INTO public.customers(user_id, name, phone, address, category, sales_channel, sales_event_id, source_notes)
      VALUES (v_owner, v_inv.customer_name, v_inv.customer_phone,
              COALESCE(v_inv.shipping_address, v_inv.customer_address),
              v_inv.customer_category,
              COALESCE(v_inv.sales_channel, 'distributor'),
              v_inv.sales_event_id,
              'تم إنشاؤه تلقائياً من فاتورة موزّع ' || v_inv.invoice_number)
      RETURNING id INTO v_customer_id;
    ELSE
      UPDATE public.customers
      SET address       = COALESCE(NULLIF(address,''), v_inv.shipping_address, v_inv.customer_address),
          category      = COALESCE(NULLIF(category,''), v_inv.customer_category),
          sales_channel = COALESCE(NULLIF(sales_channel,''), 'distributor'),
          sales_event_id= COALESCE(sales_event_id, v_inv.sales_event_id)
      WHERE id = v_customer_id;
    END IF;

    UPDATE public.invoices SET customer_id = v_customer_id WHERE id = v_inv.id;
    v_inv.customer_id := v_customer_id;
  END IF;

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
$function$;

-- Backfill: reassign customers that were created under a distributor's user_id (so admins see them on /customers)
DO $$
DECLARE v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.company_members ORDER BY added_at LIMIT 1;
  IF v_owner IS NULL THEN RETURN; END IF;

  UPDATE public.customers c
  SET user_id = v_owner
  WHERE c.user_id IN (SELECT user_id FROM public.distributors)
    AND c.user_id NOT IN (SELECT user_id FROM public.company_members);
END $$;
