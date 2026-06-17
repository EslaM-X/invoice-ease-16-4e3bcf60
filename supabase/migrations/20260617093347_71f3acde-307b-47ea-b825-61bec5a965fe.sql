-- 1) Update apply_back_deductions to also write to immutable audit_log
CREATE OR REPLACE FUNCTION public.apply_back_deductions(
  p_dri_ids uuid[],
  p_from_po uuid,
  p_actor_email text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row record;
  v_stock_before int;
  v_stock_after int;
  v_count int := 0;
  v_total_qty int := 0;
  v_po_number text;
  v_user_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT (is_admin() OR has_role(v_actor, 'purchasing'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT po_number, user_id INTO v_po_number, v_user_id
    FROM public.purchase_orders WHERE id = p_from_po;

  FOR v_row IN
    SELECT dri.id AS dri_id, dri.quantity, ii.product_id, dri.receipt_id, dri.serial_number
    FROM public.delivery_receipt_items dri
    JOIN public.invoice_items ii ON ii.id = dri.invoice_item_id
    WHERE dri.id = ANY(p_dri_ids)
      AND dri.back_deducted_at IS NULL
      AND ii.product_id IS NOT NULL
  LOOP
    SELECT stock_quantity INTO v_stock_before
      FROM public.products WHERE id = v_row.product_id FOR UPDATE;
    v_stock_after := COALESCE(v_stock_before, 0) - v_row.quantity;

    UPDATE public.products
       SET stock_quantity = v_stock_after, updated_at = now()
     WHERE id = v_row.product_id;

    UPDATE public.delivery_receipt_items
       SET back_deducted_at = now(),
           back_deducted_by_email = p_actor_email,
           back_deducted_from_po = p_from_po
     WHERE id = v_row.dri_id;

    INSERT INTO public.inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
    VALUES (
      COALESCE(v_user_id, v_actor),
      v_row.product_id,
      -v_row.quantity,
      'خصم محضر استلام تاريخي (PO ' || COALESCE(v_po_number, p_from_po::text) || ')',
      v_actor,
      p_actor_email
    );

    INSERT INTO public.audit_log (actor_id, actor_email, entity_type, entity_id, action, details)
    VALUES (
      v_actor, p_actor_email,
      'delivery_receipt_item', v_row.dri_id,
      'back_deduct_applied',
      jsonb_build_object(
        'po_id', p_from_po,
        'po_number', v_po_number,
        'product_id', v_row.product_id,
        'receipt_id', v_row.receipt_id,
        'serial_number', v_row.serial_number,
        'quantity', v_row.quantity,
        'stock_before', v_stock_before,
        'stock_after', v_stock_after
      )
    );

    v_count := v_count + 1;
    v_total_qty := v_total_qty + v_row.quantity;
  END LOOP;

  RETURN jsonb_build_object('items', v_count, 'total_qty', v_total_qty);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_back_deductions(uuid[], uuid, text) TO authenticated;

-- 2) Revert back-deductions with mandatory reason
CREATE OR REPLACE FUNCTION public.revert_back_deductions(
  p_dri_ids uuid[],
  p_actor_email text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row record;
  v_stock_before int;
  v_stock_after int;
  v_count int := 0;
  v_total_qty int := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT (is_admin() OR has_role(v_actor, 'purchasing'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  FOR v_row IN
    SELECT dri.id AS dri_id, dri.quantity, ii.product_id,
           dri.receipt_id, dri.serial_number,
           dri.back_deducted_from_po, dri.back_deducted_by_email, dri.back_deducted_at,
           po.po_number, po.user_id AS po_user_id
    FROM public.delivery_receipt_items dri
    JOIN public.invoice_items ii ON ii.id = dri.invoice_item_id
    LEFT JOIN public.purchase_orders po ON po.id = dri.back_deducted_from_po
    WHERE dri.id = ANY(p_dri_ids)
      AND dri.back_deducted_at IS NOT NULL
      AND ii.product_id IS NOT NULL
  LOOP
    SELECT stock_quantity INTO v_stock_before
      FROM public.products WHERE id = v_row.product_id FOR UPDATE;
    v_stock_after := COALESCE(v_stock_before, 0) + v_row.quantity;

    UPDATE public.products
       SET stock_quantity = v_stock_after, updated_at = now()
     WHERE id = v_row.product_id;

    UPDATE public.delivery_receipt_items
       SET back_deducted_at = NULL,
           back_deducted_by_email = NULL,
           back_deducted_from_po = NULL
     WHERE id = v_row.dri_id;

    INSERT INTO public.inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
    VALUES (
      COALESCE(v_row.po_user_id, v_actor),
      v_row.product_id,
      v_row.quantity,
      'تراجع عن خصم محضر استلام تاريخي (PO ' || COALESCE(v_row.po_number, v_row.back_deducted_from_po::text) || ') — ' || p_reason,
      v_actor,
      p_actor_email
    );

    INSERT INTO public.audit_log (actor_id, actor_email, entity_type, entity_id, action, details)
    VALUES (
      v_actor, p_actor_email,
      'delivery_receipt_item', v_row.dri_id,
      'back_deduct_reverted',
      jsonb_build_object(
        'reason', p_reason,
        'po_id', v_row.back_deducted_from_po,
        'po_number', v_row.po_number,
        'product_id', v_row.product_id,
        'receipt_id', v_row.receipt_id,
        'serial_number', v_row.serial_number,
        'quantity', v_row.quantity,
        'stock_before', v_stock_before,
        'stock_after', v_stock_after,
        'original_applied_at', v_row.back_deducted_at,
        'original_applied_by', v_row.back_deducted_by_email
      )
    );

    v_count := v_count + 1;
    v_total_qty := v_total_qty + v_row.quantity;
  END LOOP;

  RETURN jsonb_build_object('items', v_count, 'total_qty', v_total_qty);
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_back_deductions(uuid[], text, text) TO authenticated;

-- 3) Reconciliation report
CREATE OR REPLACE FUNCTION public.back_deduction_report()
RETURNS TABLE (
  dri_id uuid,
  applied_at timestamptz,
  applied_by_email text,
  po_id uuid,
  po_number text,
  shipment_code text,
  shipment_date date,
  receipt_id uuid,
  receipt_delivered_at timestamptz,
  invoice_id uuid,
  invoice_number text,
  customer_name text,
  product_id uuid,
  product_name text,
  serial_number text,
  color text,
  quantity int,
  current_stock int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    dri.id AS dri_id,
    dri.back_deducted_at AS applied_at,
    dri.back_deducted_by_email AS applied_by_email,
    po.id AS po_id,
    po.po_number,
    po.shipment_code,
    po.shipment_date,
    dr.id AS receipt_id,
    COALESCE(dr.delivered_at, dr.created_at) AS receipt_delivered_at,
    inv.id AS invoice_id,
    inv.invoice_number,
    inv.customer_name,
    ii.product_id,
    COALESCE(p.name, dri.product_name) AS product_name,
    COALESCE(p.serial_number, dri.serial_number) AS serial_number,
    COALESCE(p.color, dri.color) AS color,
    dri.quantity,
    COALESCE(p.stock_quantity, 0) AS current_stock
  FROM public.delivery_receipt_items dri
  JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
  LEFT JOIN public.purchase_orders po ON po.id = dri.back_deducted_from_po
  LEFT JOIN public.invoice_items ii ON ii.id = dri.invoice_item_id
  LEFT JOIN public.invoices inv ON inv.id = ii.invoice_id
  LEFT JOIN public.products p ON p.id = ii.product_id
  WHERE dri.back_deducted_at IS NOT NULL
  ORDER BY dri.back_deducted_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.back_deduction_report() TO authenticated;