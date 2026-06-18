
-- Wrapper RPC: apply a PO receipt batch AND auto-apply back-deductions for pending
-- historical delivery receipts of the same products. Runs in a single transaction
-- so a failure rolls everything back.
CREATE OR REPLACE FUNCTION public.apply_po_receipt_with_back_deduct(
  p_po_id uuid,
  items_in jsonb,
  p_notes text,
  p_actor_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt jsonb;
  v_receipt_id uuid;
  v_dri_ids uuid[];
  v_bd jsonb := '{"items":0,"total_qty":0}'::jsonb;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  -- 1) Normal PO receipt (adds to stock, creates po_receipts row)
  v_receipt := public.apply_po_receipt(p_po_id, items_in, p_notes, p_actor_email);
  v_receipt_id := (v_receipt->>'receipt_id')::uuid;

  -- 2) Collect all pending back-deduction DRI ids for products in this PO
  --    (includes archived delivery_receipts — we don't filter status here).
  SELECT COALESCE(array_agg(t.dri_id), ARRAY[]::uuid[])
    INTO v_dri_ids
    FROM public.list_pending_back_deductions(p_po_id) t;

  -- 3) Auto-apply them (writes inventory_logs + audit_log per item)
  IF array_length(v_dri_ids, 1) IS NOT NULL THEN
    v_bd := public.apply_back_deductions(v_dri_ids, p_po_id, p_actor_email);
  END IF;

  RETURN jsonb_build_object(
    'receipt',          v_receipt,
    'back_deduct',      v_bd,
    'back_deduct_dris', v_dri_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_po_receipt_with_back_deduct(uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_po_receipt_with_back_deduct(uuid, jsonb, text, text) TO authenticated;
