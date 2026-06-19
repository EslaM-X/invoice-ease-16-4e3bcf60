
-- ============================================================
-- 1) Permission helper: inventory super-admins (two specific emails OR admin role)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_inventory_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
      AND lower(email) IN ('k.elsharbatly@steinheim-eg.com', 'e.hesham@steinheim-eg.com')
  ) OR public.is_admin();
$$;
GRANT EXECUTE ON FUNCTION public.is_inventory_admin() TO authenticated;

-- ============================================================
-- 2) Audit table for bulk receipt operations (append-only via API)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bulk_receipt_ops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  payload jsonb NOT NULL,
  result jsonb,
  po_count int NOT NULL DEFAULT 0,
  batch_count int NOT NULL DEFAULT 0,
  total_qty int NOT NULL DEFAULT 0,
  receipt_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  back_deducted_dri_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  reverted_by_email text,
  revert_reason text
);

GRANT SELECT, INSERT, UPDATE ON public.bulk_receipt_ops TO authenticated;
GRANT ALL ON public.bulk_receipt_ops TO service_role;

ALTER TABLE public.bulk_receipt_ops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bulk ops: read for inventory admins" ON public.bulk_receipt_ops;
CREATE POLICY "bulk ops: read for inventory admins"
  ON public.bulk_receipt_ops FOR SELECT
  TO authenticated
  USING (public.is_inventory_admin());

-- writes happen only via SECURITY DEFINER RPCs below; no client INSERT/UPDATE policies needed
DROP POLICY IF EXISTS "bulk ops: no direct writes" ON public.bulk_receipt_ops;
CREATE POLICY "bulk ops: no direct writes"
  ON public.bulk_receipt_ops AS RESTRICTIVE FOR ALL
  TO authenticated
  USING (false) WITH CHECK (false);

-- realtime
ALTER TABLE public.bulk_receipt_ops REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.bulk_receipt_ops; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ============================================================
-- 3) Preview inventory reset (no writes)
-- ============================================================
CREATE OR REPLACE FUNCTION public.preview_inventory_reset()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_products int; v_logs int; v_recv int; v_dris int; v_poi int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_inventory_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT count(*) INTO v_products FROM public.products WHERE stock_quantity <> 0;
  SELECT count(*) INTO v_logs     FROM public.inventory_logs;
  SELECT count(*) INTO v_recv     FROM public.po_receipts;
  SELECT count(*) INTO v_dris     FROM public.delivery_receipt_items WHERE back_deducted_at IS NOT NULL;
  SELECT count(*) INTO v_poi      FROM public.purchase_order_items WHERE received_qty <> 0;

  RETURN jsonb_build_object(
    'products_to_zero', v_products,
    'logs_to_delete',   v_logs,
    'receipts_to_delete', v_recv,
    'dris_to_reset',    v_dris,
    'po_items_to_reset', v_poi,
    -- explicit guarantees:
    'invoices_kept',    (SELECT count(*) FROM public.invoices),
    'delivery_receipts_kept', (SELECT count(*) FROM public.delivery_receipts),
    'purchase_orders_kept',   (SELECT count(*) FROM public.purchase_orders)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.preview_inventory_reset() TO authenticated;

-- ============================================================
-- 4) Tighten reset_all_inventory to inventory admins only
-- ============================================================
CREATE OR REPLACE FUNCTION public.reset_all_inventory(p_actor_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_logs int; v_recv int; v_prods int; v_dris int; v_poi int;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_inventory_admin() THEN RAISE EXCEPTION 'forbidden: inventory admin only'; END IF;

  DELETE FROM public.inventory_logs; GET DIAGNOSTICS v_logs = ROW_COUNT;
  DELETE FROM public.po_receipts;    GET DIAGNOSTICS v_recv = ROW_COUNT;

  UPDATE public.delivery_receipt_items
     SET back_deducted_at = NULL, back_deducted_by_email = NULL, back_deducted_from_po = NULL
   WHERE back_deducted_at IS NOT NULL;
  GET DIAGNOSTICS v_dris = ROW_COUNT;

  UPDATE public.products SET stock_quantity = 0 WHERE stock_quantity <> 0;
  GET DIAGNOSTICS v_prods = ROW_COUNT;

  UPDATE public.purchase_order_items SET received_qty = 0 WHERE received_qty <> 0;
  GET DIAGNOSTICS v_poi = ROW_COUNT;

  UPDATE public.purchase_orders
     SET stock_applied_at = NULL,
         received_at = NULL,
         received_by = NULL,
         received_by_email = NULL,
         status = CASE WHEN status = 'received' THEN 'in_warehouse' ELSE status END;

  INSERT INTO public.audit_log(actor_id, actor_email, action, entity_type, entity_id, details)
  VALUES (v_actor, p_actor_email, 'reset_all_inventory', 'inventory', NULL,
          jsonb_build_object('logs_deleted', v_logs, 'receipts_deleted', v_recv,
                             'products_zeroed', v_prods, 'dris_reset', v_dris,
                             'po_items_reset', v_poi));

  RETURN jsonb_build_object('ok', true, 'logs_deleted', v_logs,
                            'receipts_deleted', v_recv, 'products_zeroed', v_prods,
                            'dris_reset', v_dris, 'po_items_reset', v_poi);
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_all_inventory(text) TO authenticated;

-- ============================================================
-- 5) Preview bulk apply (no writes) — validates and projects
-- ============================================================
CREATE OR REPLACE FUNCTION public.preview_bulk_apply_po_receipts(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_per_item jsonb := '[]'::jsonb;
  v_per_product jsonb := '{}'::jsonb;
  v_dris jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_po_count int := 0;
  v_batch_count int := 0;
  v_total int := 0;
  rec record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_inventory_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Aggregate requested quantities per (po, po_item)
  WITH po_list AS (
    SELECT (elem->>'po_id')::uuid AS po_id, elem->'batches' AS batches
    FROM jsonb_array_elements(p_payload) elem
  ),
  batches AS (
    SELECT pl.po_id, b.batch
    FROM po_list pl, jsonb_array_elements(pl.batches) AS b(batch)
  ),
  items AS (
    SELECT b.po_id,
           (it->>'po_item_id')::uuid AS po_item_id,
           (it->>'product_id')::uuid AS product_id,
           COALESCE((it->>'quantity')::int, 0) AS qty
    FROM batches b, jsonb_array_elements(b.batch->'items') AS it(it)
  ),
  agg AS (
    SELECT po_id, po_item_id, product_id, SUM(qty)::int AS req_qty
    FROM items GROUP BY po_id, po_item_id, product_id
  )
  SELECT
    jsonb_agg(jsonb_build_object(
      'po_id', a.po_id,
      'po_number', po.po_number,
      'po_item_id', a.po_item_id,
      'product_id', a.product_id,
      'product_name', poi.product_name,
      'requested', a.req_qty,
      'already_received', poi.received_qty,
      'po_qty', poi.quantity,
      'remaining', poi.quantity - poi.received_qty,
      'over', GREATEST(0, a.req_qty - (poi.quantity - poi.received_qty))
    ) ORDER BY po.po_number, poi.product_name)
  INTO v_per_item
  FROM agg a
  JOIN public.purchase_order_items poi ON poi.id = a.po_item_id
  JOIN public.purchase_orders po ON po.id = a.po_id;

  -- Validation errors (over-requested lines)
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) INTO v_errors
  FROM jsonb_array_elements(COALESCE(v_per_item, '[]'::jsonb)) elem
  WHERE COALESCE((elem->>'over')::int, 0) > 0;

  -- Per-product projected stock delta
  SELECT jsonb_object_agg(product_id::text, jsonb_build_object(
    'product_id', product_id,
    'product_name', max(product_name),
    'current_stock', max(current_stock),
    'requested_in', sum(requested),
    'projected_stock_after_add', max(current_stock) + sum(requested)
  ))
  INTO v_per_product
  FROM (
    SELECT (elem->>'product_id')::uuid AS product_id,
           elem->>'product_name' AS product_name,
           COALESCE(p.stock_quantity,0) AS current_stock,
           (elem->>'requested')::int AS requested
    FROM jsonb_array_elements(COALESCE(v_per_item,'[]'::jsonb)) elem
    LEFT JOIN public.products p ON p.id = (elem->>'product_id')::uuid
  ) s
  GROUP BY product_id;

  -- DRIs that would be back-deducted for these POs
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'dri_id', t.dri_id,
    'po_id', t.po_id,
    'product_id', t.product_id,
    'product_name', t.product_name,
    'invoice_number', t.invoice_number,
    'receipt_id', t.receipt_id,
    'quantity', t.quantity
  )), '[]'::jsonb) INTO v_dris
  FROM (
    SELECT DISTINCT (elem->>'po_id')::uuid AS po_id
    FROM jsonb_array_elements(p_payload) elem
  ) pids
  CROSS JOIN LATERAL public.list_pending_back_deductions(pids.po_id) t;

  -- Counts
  SELECT count(DISTINCT po_id), count(*), COALESCE(sum(qty),0)
    INTO v_po_count, v_batch_count, v_total
  FROM (
    SELECT (elem->>'po_id')::uuid AS po_id,
           b.batch,
           COALESCE((it.it->>'quantity')::int,0) AS qty
    FROM jsonb_array_elements(p_payload) elem,
         jsonb_array_elements(elem->'batches') AS b(batch),
         jsonb_array_elements(b.batch->'items') AS it(it)
  ) x;

  RETURN jsonb_build_object(
    'ok', (jsonb_array_length(v_errors) = 0),
    'pos', v_po_count,
    'batches', v_batch_count,
    'total_qty', v_total,
    'per_item', COALESCE(v_per_item, '[]'::jsonb),
    'per_product', COALESCE(v_per_product, '{}'::jsonb),
    'pending_back_deductions', v_dris,
    'errors', v_errors
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.preview_bulk_apply_po_receipts(jsonb) TO authenticated;

-- ============================================================
-- 6) Hardened bulk apply with pre-validation + op audit
-- ============================================================
CREATE OR REPLACE FUNCTION public.bulk_apply_po_receipts(p_payload jsonb, p_actor_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_po record;
  v_batch jsonb;
  v_result jsonb;
  v_op_id uuid := gen_random_uuid();
  v_receipt_ids uuid[] := ARRAY[]::uuid[];
  v_dri_ids uuid[] := ARRAY[]::uuid[];
  v_po_count int := 0;
  v_batch_count int := 0;
  v_total int := 0;
  v_err record;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_inventory_admin() THEN RAISE EXCEPTION 'forbidden: inventory admin only'; END IF;

  -- Pre-validate: aggregate requested per po_item and ensure <= remaining
  FOR v_err IN
    WITH po_list AS (
      SELECT (elem->>'po_id')::uuid AS po_id, elem->'batches' AS batches
      FROM jsonb_array_elements(p_payload) elem
    ),
    items AS (
      SELECT pl.po_id,
             (it.it->>'po_item_id')::uuid AS po_item_id,
             COALESCE((it.it->>'quantity')::int,0) AS qty
      FROM po_list pl,
           jsonb_array_elements(pl.batches) AS b(batch),
           jsonb_array_elements(b.batch->'items') AS it(it)
    ),
    agg AS (
      SELECT po_id, po_item_id, SUM(qty)::int AS req_qty
      FROM items GROUP BY po_id, po_item_id
    )
    SELECT po.po_number, poi.product_name, a.req_qty,
           (poi.quantity - poi.received_qty) AS remaining
    FROM agg a
    JOIN public.purchase_order_items poi ON poi.id = a.po_item_id
    JOIN public.purchase_orders po ON po.id = a.po_id
    WHERE a.req_qty > (poi.quantity - poi.received_qty)
    LIMIT 1
  LOOP
    RAISE EXCEPTION 'QTY_EXCEEDS_REMAINING for PO % product % (requested %, remaining %)',
      v_err.po_number, v_err.product_name, v_err.req_qty, v_err.remaining;
  END LOOP;

  -- Execute
  FOR v_po IN
    SELECT (elem->>'po_id')::uuid AS po_id, elem->'batches' AS batches
      FROM jsonb_array_elements(p_payload) elem
  LOOP
    v_po_count := v_po_count + 1;
    FOR v_batch IN SELECT * FROM jsonb_array_elements(v_po.batches)
    LOOP
      v_batch_count := v_batch_count + 1;
      v_result := public.apply_po_receipt_with_back_deduct(
        v_po.po_id, v_batch->'items',
        COALESCE(v_batch->>'notes', NULL),
        p_actor_email
      );
      IF (v_result->'receipt'->>'receipt_id') IS NOT NULL THEN
        v_receipt_ids := v_receipt_ids || ARRAY[(v_result->'receipt'->>'receipt_id')::uuid];
        v_total := v_total + COALESCE((v_result->'receipt'->>'total_qty')::int, 0);
      END IF;
      IF v_result ? 'back_deduct_dris' THEN
        v_dri_ids := v_dri_ids || ARRAY(
          SELECT (x)::uuid
          FROM jsonb_array_elements_text(v_result->'back_deduct_dris') x
        );
      END IF;
    END LOOP;
  END LOOP;

  INSERT INTO public.bulk_receipt_ops
    (id, actor_id, actor_email, payload, result, po_count, batch_count, total_qty,
     receipt_ids, back_deducted_dri_ids)
  VALUES
    (v_op_id, v_actor, p_actor_email, p_payload,
     jsonb_build_object('receipts', v_receipt_ids, 'back_deducted_dris', v_dri_ids),
     v_po_count, v_batch_count, v_total, v_receipt_ids, v_dri_ids);

  INSERT INTO public.audit_log(actor_id, actor_email, action, entity_type, entity_id, details)
  VALUES (v_actor, p_actor_email, 'bulk_apply_po_receipts', 'bulk_receipt_op', v_op_id,
          jsonb_build_object('pos', v_po_count, 'batches', v_batch_count,
                             'total_qty', v_total,
                             'receipts', v_receipt_ids,
                             'back_deducted_dris', v_dri_ids));

  RETURN jsonb_build_object('ok', true, 'op_id', v_op_id,
                            'pos', v_po_count, 'batches', v_batch_count,
                            'total_qty', v_total,
                            'receipts', v_receipt_ids,
                            'back_deducted_dris', v_dri_ids);
END;
$$;
GRANT EXECUTE ON FUNCTION public.bulk_apply_po_receipts(jsonb, text) TO authenticated;

-- ============================================================
-- 7) Undo a bulk receipt op (reverses back-deductions then deletes receipts)
-- ============================================================
CREATE OR REPLACE FUNCTION public.undo_bulk_receipt_op(p_op_id uuid, p_actor_email text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_op record;
  v_rid uuid;
  v_revert jsonb := '{}'::jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_inventory_admin() THEN RAISE EXCEPTION 'forbidden: inventory admin only'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT * INTO v_op FROM public.bulk_receipt_ops WHERE id = p_op_id FOR UPDATE;
  IF v_op IS NULL THEN RAISE EXCEPTION 'op_not_found'; END IF;
  IF v_op.reverted_at IS NOT NULL THEN RAISE EXCEPTION 'already_reverted'; END IF;

  -- 1) Revert back-deductions first (restores stock on those DRIs)
  IF array_length(v_op.back_deducted_dri_ids, 1) IS NOT NULL THEN
    v_revert := public.revert_back_deductions(v_op.back_deducted_dri_ids, p_actor_email, 'UNDO bulk op: ' || p_reason);
  END IF;

  -- 2) Delete each PO receipt batch (restores stock + PO received_qty)
  FOREACH v_rid IN ARRAY v_op.receipt_ids LOOP
    BEGIN
      PERFORM public.delete_po_receipt_batch(v_rid, p_actor_email);
    EXCEPTION WHEN OTHERS THEN
      -- continue; missing receipts are tolerated to allow partial undo
      NULL;
    END;
  END LOOP;

  UPDATE public.bulk_receipt_ops
     SET reverted_at = now(),
         reverted_by_email = p_actor_email,
         revert_reason = p_reason
   WHERE id = p_op_id;

  INSERT INTO public.audit_log(actor_id, actor_email, action, entity_type, entity_id, details)
  VALUES (v_actor, p_actor_email, 'undo_bulk_receipt_op', 'bulk_receipt_op', p_op_id,
          jsonb_build_object('reason', p_reason, 'revert', v_revert,
                             'receipts', v_op.receipt_ids,
                             'back_deducted_dris', v_op.back_deducted_dri_ids));

  RETURN jsonb_build_object('ok', true, 'op_id', p_op_id, 'back_deduct_revert', v_revert);
END;
$$;
GRANT EXECUTE ON FUNCTION public.undo_bulk_receipt_op(uuid, text, text) TO authenticated;
