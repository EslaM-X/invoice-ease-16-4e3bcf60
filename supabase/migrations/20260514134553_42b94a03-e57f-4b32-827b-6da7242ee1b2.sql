-- 1. Add cumulative received_qty to PO items
ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS received_qty integer NOT NULL DEFAULT 0;

-- Backfill: POs already marked received are fully received
UPDATE public.purchase_order_items poi
SET received_qty = poi.quantity
WHERE EXISTS (
  SELECT 1 FROM public.purchase_orders po
  WHERE po.id = poi.po_id AND po.status = 'received'
)
AND poi.received_qty = 0;

-- 2. Receipt batch tables
CREATE TABLE IF NOT EXISTS public.po_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL,
  user_id uuid NOT NULL,
  receipt_number integer NOT NULL,
  total_qty integer NOT NULL DEFAULT 0,
  notes text,
  actor_id uuid,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_receipts_po ON public.po_receipts(po_id);

CREATE TABLE IF NOT EXISTS public.po_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.po_receipts(id) ON DELETE CASCADE,
  po_item_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_name text NOT NULL,
  serial_number text,
  color text,
  quantity integer NOT NULL,
  stock_before integer,
  stock_after integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_receipt_items_receipt ON public.po_receipt_items(receipt_id);

ALTER TABLE public.po_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_receipt_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company po receipts select"
  ON public.po_receipts FOR SELECT TO authenticated
  USING (can_access_user_data(user_id));

CREATE POLICY "company po receipt items select"
  ON public.po_receipt_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.po_receipts r
    WHERE r.id = po_receipt_items.receipt_id
      AND can_access_user_data(r.user_id)
  ));

-- 3. New batch-aware receive RPC
CREATE OR REPLACE FUNCTION public.apply_po_receipt(
  p_po_id uuid,
  items_in jsonb,
  p_notes text,
  p_actor_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_po record;
  v_item record;
  v_in jsonb;
  v_recv int;
  v_actor uuid := auth.uid();
  v_receipt_id uuid;
  v_receipt_no int;
  v_batch_total int := 0;
  v_total_ordered int;
  v_total_received int;
  v_fully boolean;
  v_stock_before int;
  v_stock_after int;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF v_po IS NULL THEN RAISE EXCEPTION 'PO not found'; END IF;

  IF NOT (is_admin() OR has_role(v_actor, 'purchasing'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT can_access_user_data(v_po.user_id) THEN
    RAISE EXCEPTION 'forbidden (company)';
  END IF;
  IF v_po.status = 'received' THEN RAISE EXCEPTION 'PO already fully received'; END IF;
  IF v_po.status = 'cancelled' THEN RAISE EXCEPTION 'PO cancelled'; END IF;

  SELECT COALESCE(MAX(receipt_number), 0) + 1 INTO v_receipt_no
    FROM po_receipts WHERE po_id = p_po_id;

  INSERT INTO po_receipts (po_id, user_id, receipt_number, notes, actor_id, actor_email)
  VALUES (p_po_id, v_po.user_id, v_receipt_no, NULLIF(p_notes, ''), v_actor, p_actor_email)
  RETURNING id INTO v_receipt_id;

  FOR v_in IN SELECT jsonb_array_elements(items_in) LOOP
    v_recv := COALESCE((v_in->>'received_qty')::int, 0);
    IF v_recv <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_item FROM purchase_order_items
      WHERE id = (v_in->>'item_id')::uuid AND po_id = p_po_id FOR UPDATE;
    IF v_item IS NULL THEN RAISE EXCEPTION 'item not found in PO'; END IF;
    IF v_item.received_qty + v_recv > v_item.quantity THEN
      RAISE EXCEPTION 'received qty (%) exceeds remaining for %', v_recv, v_item.product_name;
    END IF;

    SELECT stock_quantity INTO v_stock_before FROM products WHERE id = v_item.product_id FOR UPDATE;
    v_stock_after := COALESCE(v_stock_before, 0) + v_recv;

    UPDATE products SET stock_quantity = v_stock_after, updated_at = now() WHERE id = v_item.product_id;
    UPDATE purchase_order_items SET received_qty = received_qty + v_recv WHERE id = v_item.id;

    INSERT INTO po_receipt_items
      (receipt_id, po_item_id, product_id, product_name, serial_number, color, quantity, stock_before, stock_after)
    VALUES
      (v_receipt_id, v_item.id, v_item.product_id, v_item.product_name, v_item.serial_number, v_item.color,
       v_recv, v_stock_before, v_stock_after);

    INSERT INTO inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
    VALUES (v_po.user_id, v_item.product_id, v_recv,
            'PO ' || v_po.po_number || ' استلام دفعة #' || v_receipt_no, v_actor, p_actor_email);

    v_batch_total := v_batch_total + v_recv;
  END LOOP;

  IF v_batch_total = 0 THEN
    DELETE FROM po_receipts WHERE id = v_receipt_id;
    RAISE EXCEPTION 'no items received';
  END IF;

  UPDATE po_receipts SET total_qty = v_batch_total WHERE id = v_receipt_id;

  SELECT COALESCE(SUM(quantity),0), COALESCE(SUM(received_qty),0)
    INTO v_total_ordered, v_total_received
    FROM purchase_order_items WHERE po_id = p_po_id;

  v_fully := (v_total_received >= v_total_ordered);

  UPDATE purchase_orders
    SET status = CASE WHEN v_fully THEN 'received' ELSE 'in_warehouse' END,
        received_at = CASE WHEN v_fully THEN now() ELSE received_at END,
        received_by = CASE WHEN v_fully THEN v_actor ELSE received_by END,
        received_by_email = CASE WHEN v_fully THEN p_actor_email ELSE received_by_email END,
        stock_applied_at = COALESCE(stock_applied_at, now()),
        updated_at = now()
    WHERE id = p_po_id;

  INSERT INTO po_status_history (po_id, from_status, to_status, note, actor_id, actor_email)
  VALUES (p_po_id, v_po.status,
          CASE WHEN v_fully THEN 'received' ELSE 'in_warehouse' END,
          'دفعة #' || v_receipt_no || ': ' || v_batch_total || ' (إجمالي ' || v_total_received || '/' || v_total_ordered || ')',
          v_actor, p_actor_email);

  RETURN jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_no,
    'fully_received', v_fully,
    'batch_qty', v_batch_total,
    'total_ordered', v_total_ordered,
    'total_received', v_total_received
  );
END;
$$;