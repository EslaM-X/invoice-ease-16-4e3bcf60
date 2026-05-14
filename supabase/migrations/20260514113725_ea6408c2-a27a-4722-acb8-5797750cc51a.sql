
-- 1. PO status history
CREATE TABLE IF NOT EXISTS public.po_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  note text,
  actor_id uuid,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_status_history_po ON public.po_status_history(po_id, created_at DESC);

ALTER TABLE public.po_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members read po history"
ON public.po_status_history FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.purchase_orders p WHERE p.id = po_status_history.po_id AND can_access_user_data(p.user_id)));

CREATE POLICY "purchasing insert po history"
ON public.po_status_history FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.purchase_orders p WHERE p.id = po_status_history.po_id AND can_access_user_data(p.user_id))
  AND (is_admin() OR has_role(auth.uid(), 'purchasing'::app_role) OR has_role(auth.uid(), 'cfo'::app_role))
  AND actor_id = auth.uid()
);

-- 2. Tracking columns on purchase_orders
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by uuid,
  ADD COLUMN IF NOT EXISTS paid_by_email text,
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS expected_arrival_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_by uuid,
  ADD COLUMN IF NOT EXISTS received_by_email text,
  ADD COLUMN IF NOT EXISTS stock_applied_at timestamptz;

-- 3. Atomic receive function: applies received quantities to inventory exactly once.
-- items_in: jsonb array of { item_id: uuid, received_qty: int }
CREATE OR REPLACE FUNCTION public.apply_po_to_inventory(
  p_po_id uuid,
  items_in jsonb,
  p_actor_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po record;
  v_item record;
  v_in jsonb;
  v_recv int;
  v_total_requested int := 0;
  v_total_received int := 0;
  v_fully_received boolean;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF v_po IS NULL THEN
    RAISE EXCEPTION 'PO not found';
  END IF;

  -- Permission: admin or purchasing within company
  IF NOT (is_admin() OR has_role(v_actor, 'purchasing'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT can_access_user_data(v_po.user_id) THEN
    RAISE EXCEPTION 'forbidden (company)';
  END IF;

  -- Idempotency guard
  IF v_po.stock_applied_at IS NOT NULL THEN
    RAISE EXCEPTION 'stock already applied for this PO';
  END IF;

  -- Apply each item
  FOR v_in IN SELECT jsonb_array_elements(items_in) LOOP
    SELECT * INTO v_item FROM public.purchase_order_items
      WHERE id = (v_in->>'item_id')::uuid AND po_id = p_po_id FOR UPDATE;
    IF v_item IS NULL THEN
      RAISE EXCEPTION 'item not found in PO';
    END IF;
    v_recv := COALESCE((v_in->>'received_qty')::int, 0);
    IF v_recv < 0 OR v_recv > v_item.quantity THEN
      RAISE EXCEPTION 'invalid received_qty for item %', v_item.id;
    END IF;
    v_total_requested := v_total_requested + v_item.quantity;
    v_total_received := v_total_received + v_recv;

    IF v_recv > 0 THEN
      UPDATE public.products
        SET stock_quantity = stock_quantity + v_recv,
            updated_at = now()
        WHERE id = v_item.product_id;

      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
      VALUES (v_po.user_id, v_item.product_id, v_recv,
              'PO ' || v_po.po_number || ' استلام', v_actor, p_actor_email);
    END IF;
  END LOOP;

  v_fully_received := (v_total_received >= v_total_requested);

  UPDATE public.purchase_orders
    SET status = CASE WHEN v_fully_received THEN 'received' ELSE 'in_warehouse' END,
        received_at = CASE WHEN v_fully_received THEN now() ELSE received_at END,
        received_by = CASE WHEN v_fully_received THEN v_actor ELSE received_by END,
        received_by_email = CASE WHEN v_fully_received THEN p_actor_email ELSE received_by_email END,
        stock_applied_at = now(),
        updated_at = now()
    WHERE id = p_po_id;

  INSERT INTO public.po_status_history (po_id, from_status, to_status, note, actor_id, actor_email)
  VALUES (p_po_id, v_po.status,
          CASE WHEN v_fully_received THEN 'received' ELSE 'in_warehouse' END,
          'استلام ' || v_total_received || '/' || v_total_requested,
          v_actor, p_actor_email);

  RETURN jsonb_build_object(
    'fully_received', v_fully_received,
    'total_requested', v_total_requested,
    'total_received', v_total_received
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_po_to_inventory(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_po_to_inventory(uuid, jsonb, text) TO authenticated;
