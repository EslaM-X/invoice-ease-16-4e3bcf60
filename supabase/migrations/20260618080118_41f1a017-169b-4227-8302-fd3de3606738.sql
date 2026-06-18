
-- 1) Editable receipt date
ALTER TABLE public.po_receipts
  ADD COLUMN IF NOT EXISTS receipt_date timestamptz NOT NULL DEFAULT now();

UPDATE public.po_receipts SET receipt_date = created_at WHERE receipt_date = created_at;

-- 2) Helper: rewrite inventory_logs reason for a receipt batch
-- 3) Edit a PO receipt batch (date + items). Adjusts stock & logs delta only.
CREATE OR REPLACE FUNCTION public.update_po_receipt_batch(
  p_receipt_id uuid,
  p_receipt_date timestamptz,
  p_items jsonb,           -- [{po_item_id, new_qty}]
  p_actor_email text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt record;
  v_po record;
  v_actor uuid := auth.uid();
  v_in jsonb;
  v_po_item record;
  v_existing record;
  v_new_qty int;
  v_delta int;
  v_stock_before int;
  v_stock_after int;
  v_total int := 0;
  v_changes int := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_receipt FROM po_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF v_receipt IS NULL THEN RAISE EXCEPTION 'receipt not found'; END IF;
  SELECT * INTO v_po FROM purchase_orders WHERE id = v_receipt.po_id FOR UPDATE;
  IF NOT (is_admin() OR has_role(v_actor, 'purchasing'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT can_access_user_data(v_po.user_id) THEN
    RAISE EXCEPTION 'forbidden (company)';
  END IF;

  IF p_receipt_date IS NOT NULL AND p_receipt_date <> v_receipt.receipt_date THEN
    UPDATE po_receipts SET receipt_date = p_receipt_date WHERE id = p_receipt_id;
  END IF;

  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    FOR v_in IN SELECT jsonb_array_elements(p_items) LOOP
      v_new_qty := GREATEST(0, COALESCE((v_in->>'new_qty')::int, 0));
      SELECT * INTO v_po_item FROM purchase_order_items
        WHERE id = (v_in->>'po_item_id')::uuid AND po_id = v_receipt.po_id FOR UPDATE;
      IF v_po_item IS NULL THEN CONTINUE; END IF;

      SELECT * INTO v_existing FROM po_receipt_items
        WHERE receipt_id = p_receipt_id AND po_item_id = v_po_item.id;

      IF v_existing IS NULL AND v_new_qty = 0 THEN CONTINUE; END IF;

      v_delta := v_new_qty - COALESCE(v_existing.quantity, 0);
      IF v_delta = 0 THEN
        v_total := v_total + v_new_qty;
        CONTINUE;
      END IF;

      -- Enforce: total received across all batches cannot exceed ordered qty
      IF v_po_item.received_qty + v_delta > v_po_item.quantity THEN
        RAISE EXCEPTION 'qty for % exceeds ordered (%)', v_po_item.product_name, v_po_item.quantity;
      END IF;
      IF v_po_item.received_qty + v_delta < 0 THEN
        RAISE EXCEPTION 'qty for % would go negative', v_po_item.product_name;
      END IF;

      SELECT stock_quantity INTO v_stock_before FROM products WHERE id = v_po_item.product_id FOR UPDATE;
      v_stock_after := GREATEST(0, COALESCE(v_stock_before,0) + v_delta);

      UPDATE products SET stock_quantity = v_stock_after, updated_at = now() WHERE id = v_po_item.product_id;
      UPDATE purchase_order_items SET received_qty = received_qty + v_delta WHERE id = v_po_item.id;

      IF v_existing IS NULL THEN
        INSERT INTO po_receipt_items (receipt_id, po_item_id, product_id, product_name, serial_number, color, quantity, stock_before, stock_after)
        VALUES (p_receipt_id, v_po_item.id, v_po_item.product_id, v_po_item.product_name, v_po_item.serial_number, v_po_item.color, v_new_qty, v_stock_before, v_stock_after);
      ELSIF v_new_qty = 0 THEN
        DELETE FROM po_receipt_items WHERE id = v_existing.id;
      ELSE
        UPDATE po_receipt_items SET quantity = v_new_qty, stock_after = v_stock_after WHERE id = v_existing.id;
      END IF;

      INSERT INTO inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
      VALUES (v_po.user_id, v_po_item.product_id, v_delta,
              'PO ' || v_po.po_number || ' تعديل دفعة #' || v_receipt.receipt_number || ' (' || COALESCE(v_existing.quantity,0)::text || '→' || v_new_qty::text || ')',
              v_actor, p_actor_email);
      v_changes := v_changes + 1;
      v_total := v_total + v_new_qty;
    END LOOP;
  ELSE
    SELECT COALESCE(SUM(quantity),0) INTO v_total FROM po_receipt_items WHERE receipt_id = p_receipt_id;
  END IF;

  UPDATE po_receipts SET total_qty = v_total WHERE id = p_receipt_id;
  RETURN jsonb_build_object('ok', true, 'changes', v_changes, 'total_qty', v_total);
END $$;

GRANT EXECUTE ON FUNCTION public.update_po_receipt_batch(uuid, timestamptz, jsonb, text) TO authenticated;

-- 4) Delete a single receipt batch and reverse its stock additions
CREATE OR REPLACE FUNCTION public.delete_po_receipt_batch(
  p_receipt_id uuid,
  p_actor_email text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt record;
  v_po record;
  v_actor uuid := auth.uid();
  rec record;
  v_stock int;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_receipt FROM po_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF v_receipt IS NULL THEN RAISE EXCEPTION 'receipt not found'; END IF;
  SELECT * INTO v_po FROM purchase_orders WHERE id = v_receipt.po_id FOR UPDATE;
  IF NOT is_admin() THEN RAISE EXCEPTION 'forbidden (admin only)'; END IF;
  IF NOT can_access_user_data(v_po.user_id) THEN RAISE EXCEPTION 'forbidden (company)'; END IF;

  FOR rec IN SELECT * FROM po_receipt_items WHERE receipt_id = p_receipt_id LOOP
    SELECT stock_quantity INTO v_stock FROM products WHERE id = rec.product_id FOR UPDATE;
    UPDATE products SET stock_quantity = GREATEST(0, COALESCE(v_stock,0) - rec.quantity), updated_at = now()
      WHERE id = rec.product_id;
    UPDATE purchase_order_items SET received_qty = GREATEST(0, received_qty - rec.quantity)
      WHERE id = rec.po_item_id;
    INSERT INTO inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
    VALUES (v_po.user_id, rec.product_id, -rec.quantity,
            'PO ' || v_po.po_number || ' حذف دفعة #' || v_receipt.receipt_number, v_actor, p_actor_email);
  END LOOP;

  DELETE FROM po_receipts WHERE id = p_receipt_id;
  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.delete_po_receipt_batch(uuid, text) TO authenticated;

-- 5) Delete an entire PO + reverse stock, refuse if products sold in invoices
CREATE OR REPLACE FUNCTION public.delete_po_with_inventory_rollback(
  p_po_id uuid,
  p_actor_email text,
  p_force boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_po record;
  v_actor uuid := auth.uid();
  rec record;
  v_stock int;
  v_reserved_count int := 0;
  v_sold_count int := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT is_admin() THEN RAISE EXCEPTION 'forbidden (admin only)'; END IF;
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF v_po IS NULL THEN RAISE EXCEPTION 'PO not found'; END IF;
  IF NOT can_access_user_data(v_po.user_id) THEN RAISE EXCEPTION 'forbidden (company)'; END IF;

  -- Block if any PO item is reserved or fulfilled by an invoice
  SELECT count(*) INTO v_reserved_count
    FROM invoice_po_reservations r
    JOIN purchase_order_items poi ON poi.id = r.po_item_id
   WHERE poi.po_id = p_po_id;

  IF v_reserved_count > 0 AND NOT p_force THEN
    RAISE EXCEPTION 'cannot delete: % invoice reservation(s) linked to this PO. Cancel those invoices first.', v_reserved_count;
  END IF;

  -- Reverse each receipt batch
  FOR rec IN
    SELECT pri.product_id, SUM(pri.quantity)::int AS qty
      FROM po_receipt_items pri
      JOIN po_receipts pr ON pr.id = pri.receipt_id
     WHERE pr.po_id = p_po_id
     GROUP BY pri.product_id
  LOOP
    SELECT stock_quantity INTO v_stock FROM products WHERE id = rec.product_id FOR UPDATE;
    UPDATE products SET stock_quantity = GREATEST(0, COALESCE(v_stock,0) - rec.qty), updated_at = now()
      WHERE id = rec.product_id;
    INSERT INTO inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
    VALUES (v_po.user_id, rec.product_id, -rec.qty,
            'PO ' || v_po.po_number || ' حذف أمر شراء', v_actor, p_actor_email);
  END LOOP;

  -- Remove reservations if forced
  IF v_reserved_count > 0 AND p_force THEN
    DELETE FROM invoice_po_reservations r
      USING purchase_order_items poi
     WHERE r.po_item_id = poi.id AND poi.po_id = p_po_id;
  END IF;

  -- Cascades: po_receipt_items via po_receipts FK, purchase_order_items via po FK
  DELETE FROM po_receipts WHERE po_id = p_po_id;
  DELETE FROM purchase_order_items WHERE po_id = p_po_id;
  DELETE FROM purchase_orders WHERE id = p_po_id;

  RETURN jsonb_build_object('ok', true, 'reservations_removed', CASE WHEN p_force THEN v_reserved_count ELSE 0 END);
END $$;

GRANT EXECUTE ON FUNCTION public.delete_po_with_inventory_rollback(uuid, text, boolean) TO authenticated;

-- 6) Stock reconciliation report: compare products.stock_quantity vs SUM(inventory_logs.change)
CREATE OR REPLACE FUNCTION public.stock_reconciliation_report()
RETURNS TABLE(
  product_id uuid,
  product_name text,
  serial_number text,
  color text,
  current_stock int,
  logs_sum int,
  diff int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.serial_number, p.color,
         COALESCE(p.stock_quantity,0)::int AS current_stock,
         COALESCE(SUM(l.change),0)::int AS logs_sum,
         (COALESCE(p.stock_quantity,0) - COALESCE(SUM(l.change),0))::int AS diff
    FROM products p
    LEFT JOIN inventory_logs l ON l.product_id = p.id
   WHERE can_access_user_data(p.user_id)
   GROUP BY p.id, p.name, p.serial_number, p.color, p.stock_quantity
$$;

GRANT EXECUTE ON FUNCTION public.stock_reconciliation_report() TO authenticated;

-- 7) Rebuild stock for one product (or all) from inventory_logs sum
CREATE OR REPLACE FUNCTION public.rebuild_product_stock(p_product_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec record;
  v_count int := 0;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  FOR rec IN
    SELECT p.id, GREATEST(0, COALESCE(SUM(l.change),0))::int AS new_stock
      FROM products p
      LEFT JOIN inventory_logs l ON l.product_id = p.id
     WHERE (p_product_id IS NULL OR p.id = p_product_id)
       AND can_access_user_data(p.user_id)
     GROUP BY p.id
  LOOP
    UPDATE products SET stock_quantity = rec.new_stock, updated_at = now() WHERE id = rec.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'rebuilt', v_count);
END $$;

GRANT EXECUTE ON FUNCTION public.rebuild_product_stock(uuid) TO authenticated;
