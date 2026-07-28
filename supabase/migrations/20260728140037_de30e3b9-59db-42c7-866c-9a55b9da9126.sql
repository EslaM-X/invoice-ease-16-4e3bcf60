DO $$
DECLARE
  v_po_id uuid := 'ae9efc14-d44c-4d70-afe9-28ba21da9be0';
  v_po_number text;
  v_user_id uuid;
  rec record;
  new_receipt_id uuid;
  v_stock int;
  v_delta int;
  v_total int := 0;
BEGIN
  SELECT user_id, po_number INTO v_user_id, v_po_number FROM public.purchase_orders WHERE id = v_po_id;

  -- 1) Roll back stock effect of every existing receipt line
  FOR rec IN
    SELECT pri.product_id, pri.stock_before, pri.stock_after
    FROM public.po_receipt_items pri
    JOIN public.po_receipts pr ON pr.id = pri.receipt_id
    WHERE pr.po_id = v_po_id
  LOOP
    v_delta := COALESCE(rec.stock_after, rec.stock_before, 0) - COALESCE(rec.stock_before, 0);
    IF v_delta <> 0 AND rec.product_id IS NOT NULL THEN
      SELECT stock_quantity INTO v_stock FROM public.products WHERE id = rec.product_id FOR UPDATE;
      UPDATE public.products
        SET stock_quantity = GREATEST(0, COALESCE(v_stock,0) - v_delta), updated_at = now()
        WHERE id = rec.product_id;
      INSERT INTO public.inventory_logs(user_id, product_id, change, reason)
        VALUES (v_user_id, rec.product_id, -v_delta,
                'PO ' || v_po_number || ' full rollback of prior receipts (data correction)');
    END IF;
  END LOOP;

  -- 2) Delete existing receipts
  DELETE FROM public.po_receipt_items
    WHERE receipt_id IN (SELECT id FROM public.po_receipts WHERE po_id = v_po_id);
  DELETE FROM public.po_receipts WHERE po_id = v_po_id;

  -- 3) Reset received qty
  UPDATE public.purchase_order_items SET received_qty = 0 WHERE po_id = v_po_id;

  -- 4) Total for the new receipt header
  SELECT COALESCE(SUM(quantity),0) INTO v_total
    FROM public.purchase_order_items WHERE po_id = v_po_id;

  -- 5) Create one new receipt
  INSERT INTO public.po_receipts(po_id, user_id, receipt_number, total_qty, notes, receipt_code)
    VALUES (v_po_id, v_user_id, 1, v_total,
            'Full corrected shipment — auto-generated after PO items were fixed', 'R-CORRECTED')
    RETURNING id INTO new_receipt_id;

  -- 6) Apply each corrected item to inventory and log
  FOR rec IN
    SELECT id, product_id, product_name, serial_number, color, quantity
    FROM public.purchase_order_items WHERE po_id = v_po_id
  LOOP
    IF rec.product_id IS NULL OR COALESCE(rec.quantity,0) <= 0 THEN CONTINUE; END IF;
    SELECT stock_quantity INTO v_stock FROM public.products WHERE id = rec.product_id FOR UPDATE;
    INSERT INTO public.po_receipt_items(
      receipt_id, po_item_id, product_id, product_name,
      serial_number, color, quantity, stock_before, stock_after)
    VALUES (new_receipt_id, rec.id, rec.product_id, rec.product_name,
            rec.serial_number, rec.color, rec.quantity,
            COALESCE(v_stock,0), COALESCE(v_stock,0) + rec.quantity);
    UPDATE public.products
      SET stock_quantity = COALESCE(v_stock,0) + rec.quantity, updated_at = now()
      WHERE id = rec.product_id;
    UPDATE public.purchase_order_items
      SET received_qty = rec.quantity WHERE id = rec.id;
    INSERT INTO public.inventory_logs(user_id, product_id, change, reason)
      VALUES (v_user_id, rec.product_id, rec.quantity,
              'PO ' || v_po_number || ' corrected receipt R-CORRECTED');
  END LOOP;

  -- 7) Refresh PO state
  PERFORM public.recalculate_po_receipt_state(v_po_id);
END $$;