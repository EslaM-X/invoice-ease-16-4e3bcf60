-- =========================================================
-- Wave 2 — Reservation Engine RPCs + Delivery Hooks (dormant)
-- =========================================================

-- 1) Feature-flag table
CREATE TABLE IF NOT EXISTS public.system_flags (
  key        text PRIMARY KEY,
  value      boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT ON public.system_flags TO authenticated;
GRANT ALL    ON public.system_flags TO service_role;

ALTER TABLE public.system_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_flags_read_all"     ON public.system_flags;
DROP POLICY IF EXISTS "system_flags_admin_write"  ON public.system_flags;

CREATE POLICY "system_flags_read_all" ON public.system_flags
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "system_flags_admin_write" ON public.system_flags
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.system_flags(key, value)
VALUES ('reservation_engine', false)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_flag_on(_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT value FROM public.system_flags WHERE key = _key), false);
$$;

-- 2) Idempotency marker on receipt lines
ALTER TABLE public.delivery_receipt_items
  ADD COLUMN IF NOT EXISTS stock_applied_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_dri_stock_applied_at
  ON public.delivery_receipt_items(stock_applied_at)
  WHERE stock_applied_at IS NOT NULL;

-- =========================================================
-- 3) reserve_invoice_items(invoice_id)
-- =========================================================
CREATE OR REPLACE FUNCTION public.reserve_invoice_items(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row       record;
  v_available integer;
  v_needed    integer;
  v_reserve   integer;
  v_shortage  integer;
  v_shortages jsonb := '[]'::jsonb;
  v_updated   integer := 0;
  v_owner     uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.invoices WHERE id = p_invoice_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id;
  END IF;

  FOR v_row IN
    SELECT ii.id, ii.product_id, ii.quantity, ii.delivered_qty, ii.reserved_qty
    FROM public.invoice_items ii
    WHERE ii.invoice_id = p_invoice_id
      AND ii.product_id IS NOT NULL
    FOR UPDATE
  LOOP
    v_needed := GREATEST(0, v_row.quantity - v_row.delivered_qty);

    -- available = stock - (reserved by OTHERS)
    SELECT p.stock_quantity
         - GREATEST(0, COALESCE(p.reserved_quantity,0) - v_row.reserved_qty)
      INTO v_available
    FROM public.products p
    WHERE p.id = v_row.product_id
    FOR UPDATE;

    v_available := COALESCE(v_available, 0);
    v_reserve   := LEAST(v_needed, GREATEST(v_available, 0));
    v_shortage  := v_needed - v_reserve;

    UPDATE public.invoice_items
       SET reserved_qty = v_reserve
     WHERE id = v_row.id;

    v_updated := v_updated + 1;

    IF v_shortage > 0 THEN
      INSERT INTO public.shortage_requests(product_id, invoice_id, quantity, notes, status, requested_by)
      SELECT v_row.product_id, p_invoice_id, v_shortage,
             'Auto-created by reserve_invoice_items (shortage on reservation)', 'open', v_owner
      WHERE NOT EXISTS (
        SELECT 1 FROM public.shortage_requests sr
        WHERE sr.invoice_id = p_invoice_id
          AND sr.product_id = v_row.product_id
          AND sr.status = 'open'
      );
      v_shortages := v_shortages || jsonb_build_object(
        'product_id', v_row.product_id,
        'shortage_qty', v_shortage
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'items_updated', v_updated,
    'shortages', v_shortages
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_invoice_items(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_invoice_items(uuid) TO authenticated;

-- =========================================================
-- 4) release_invoice_reservation(invoice_id)
-- =========================================================
CREATE OR REPLACE FUNCTION public.release_invoice_reservation(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.invoice_items
     SET reserved_qty = 0
   WHERE invoice_id = p_invoice_id
     AND reserved_qty <> 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'items_cleared', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.release_invoice_reservation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_invoice_reservation(uuid) TO authenticated;

-- =========================================================
-- 5) apply_delivery_signature(receipt_id) — idempotent
-- =========================================================
CREATE OR REPLACE FUNCTION public.apply_delivery_signature(p_receipt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt  record;
  v_line     record;
  v_applied  integer := 0;
  v_deduct   integer;
  v_reduce   integer;
BEGIN
  SELECT id, invoice_id, status INTO v_receipt
  FROM public.delivery_receipts WHERE id = p_receipt_id FOR UPDATE;

  IF v_receipt.id IS NULL THEN
    RAISE EXCEPTION 'Receipt % not found', p_receipt_id;
  END IF;

  FOR v_line IN
    SELECT dri.id, dri.invoice_item_id, dri.quantity,
           ii.product_id, ii.reserved_qty, ii.delivered_qty, ii.quantity AS invoice_qty
    FROM public.delivery_receipt_items dri
    LEFT JOIN public.invoice_items ii ON ii.id = dri.invoice_item_id
    WHERE dri.receipt_id = p_receipt_id
      AND dri.stock_applied_at IS NULL
    FOR UPDATE
  LOOP
    v_deduct := COALESCE(v_line.quantity, 0);

    IF v_line.product_id IS NOT NULL AND v_deduct > 0 THEN
      -- Deduct from real stock
      UPDATE public.products
         SET stock_quantity = stock_quantity - v_deduct,
             updated_at = now()
       WHERE id = v_line.product_id;

      -- Log inventory movement
      INSERT INTO public.inventory_logs(product_id, change, reason, user_id)
      VALUES (v_line.product_id, -v_deduct,
              'delivery_deduction:receipt:' || p_receipt_id::text,
              auth.uid());
    END IF;

    -- Update invoice item accounting
    IF v_line.invoice_item_id IS NOT NULL THEN
      v_reduce := LEAST(v_deduct, COALESCE(v_line.reserved_qty, 0));
      UPDATE public.invoice_items
         SET reserved_qty  = GREATEST(0, COALESCE(reserved_qty, 0) - v_reduce),
             delivered_qty = COALESCE(delivered_qty, 0) + v_deduct
       WHERE id = v_line.invoice_item_id;
    END IF;

    UPDATE public.delivery_receipt_items
       SET stock_applied_at = now()
     WHERE id = v_line.id;

    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object('receipt_id', p_receipt_id, 'lines_applied', v_applied);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_delivery_signature(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_delivery_signature(uuid) TO authenticated;

-- =========================================================
-- 6) reverse_delivery_signature(receipt_id) — idempotent
-- =========================================================
CREATE OR REPLACE FUNCTION public.reverse_delivery_signature(p_receipt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line    record;
  v_undone  integer := 0;
  v_qty     integer;
  v_restore integer;
BEGIN
  FOR v_line IN
    SELECT dri.id, dri.invoice_item_id, dri.quantity,
           ii.product_id, ii.reserved_qty, ii.delivered_qty, ii.quantity AS invoice_qty
    FROM public.delivery_receipt_items dri
    LEFT JOIN public.invoice_items ii ON ii.id = dri.invoice_item_id
    WHERE dri.receipt_id = p_receipt_id
      AND dri.stock_applied_at IS NOT NULL
    FOR UPDATE
  LOOP
    v_qty := COALESCE(v_line.quantity, 0);

    IF v_line.product_id IS NOT NULL AND v_qty > 0 THEN
      UPDATE public.products
         SET stock_quantity = stock_quantity + v_qty,
             updated_at = now()
       WHERE id = v_line.product_id;

      INSERT INTO public.inventory_logs(product_id, change, reason, user_id)
      VALUES (v_line.product_id, v_qty,
              'delivery_reversal:receipt:' || p_receipt_id::text,
              auth.uid());
    END IF;

    IF v_line.invoice_item_id IS NOT NULL THEN
      -- Restore reservation up to remaining need (quantity - delivered_qty after reversal)
      v_restore := LEAST(v_qty, GREATEST(0, COALESCE(v_line.invoice_qty,0) - GREATEST(0, COALESCE(v_line.delivered_qty,0) - v_qty)));
      UPDATE public.invoice_items
         SET delivered_qty = GREATEST(0, COALESCE(delivered_qty,0) - v_qty),
             reserved_qty  = COALESCE(reserved_qty,0) + v_restore
       WHERE id = v_line.invoice_item_id;
    END IF;

    UPDATE public.delivery_receipt_items
       SET stock_applied_at = NULL
     WHERE id = v_line.id;

    v_undone := v_undone + 1;
  END LOOP;

  RETURN jsonb_build_object('receipt_id', p_receipt_id, 'lines_reversed', v_undone);
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_delivery_signature(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_delivery_signature(uuid) TO authenticated;

-- =========================================================
-- 7) Trigger — dormant until reservation_engine flag is on
-- =========================================================
CREATE OR REPLACE FUNCTION public.tg_dr_reservation_hook()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_flag_on('reservation_engine') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'signed' THEN
      PERFORM public.reverse_delivery_signature(OLD.id);
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'signed' THEN
      PERFORM public.apply_delivery_signature(NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.status = 'signed' AND OLD.status IS DISTINCT FROM 'signed' THEN
    PERFORM public.apply_delivery_signature(NEW.id);
  ELSIF OLD.status = 'signed' AND NEW.status IS DISTINCT FROM 'signed' THEN
    PERFORM public.reverse_delivery_signature(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_dr_reservation_hook ON public.delivery_receipts;
CREATE TRIGGER tg_dr_reservation_hook
  AFTER INSERT OR UPDATE OF status OR DELETE
  ON public.delivery_receipts
  FOR EACH ROW EXECUTE FUNCTION public.tg_dr_reservation_hook();
