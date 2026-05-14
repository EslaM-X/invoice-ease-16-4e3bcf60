-- Restrict PO deletion to a single authorized user, and reverse inventory
-- when a PO is deleted or cancelled after stock was applied.

-- 1) Helper: check current actor's email
CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM auth.users WHERE id = auth.uid();
$$;

-- 2) Replace DELETE policy on purchase_orders -> only K.elsharbatly@steinheim-eg.com
DROP POLICY IF EXISTS "admin po delete" ON public.purchase_orders;
CREATE POLICY "restricted po delete"
ON public.purchase_orders
FOR DELETE
TO authenticated
USING (lower(public.current_user_email()) = 'k.elsharbatly@steinheim-eg.com');

-- 3) Reversal function: reverses any stock added by this PO if not already reversed.
CREATE OR REPLACE FUNCTION public.revert_po_inventory(p_po_id uuid, p_actor_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po record;
  v_reason_apply text;
  v_reason_revert text;
  v_already int;
  rec record;
BEGIN
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po_id;
  IF v_po IS NULL THEN RETURN; END IF;
  IF v_po.stock_applied_at IS NULL THEN RETURN; END IF;

  v_reason_apply  := 'PO ' || v_po.po_number || ' استلام';
  v_reason_revert := 'PO ' || v_po.po_number || ' عكس استلام';

  -- Idempotency: skip if a reversal already exists
  SELECT count(*) INTO v_already
    FROM public.inventory_logs
   WHERE user_id = v_po.user_id AND reason = v_reason_revert;
  IF v_already > 0 THEN
    UPDATE public.purchase_orders SET stock_applied_at = NULL WHERE id = p_po_id;
    RETURN;
  END IF;

  FOR rec IN
    SELECT product_id, SUM(change)::int AS total_added
      FROM public.inventory_logs
     WHERE user_id = v_po.user_id AND reason = v_reason_apply
     GROUP BY product_id
  LOOP
    IF rec.total_added > 0 THEN
      UPDATE public.products
         SET stock_quantity = GREATEST(0, stock_quantity - rec.total_added),
             updated_at = now()
       WHERE id = rec.product_id;

      INSERT INTO public.inventory_logs (user_id, product_id, change, reason, actor_id, actor_email)
      VALUES (v_po.user_id, rec.product_id, -rec.total_added, v_reason_revert, auth.uid(), p_actor_email);
    END IF;
  END LOOP;

  UPDATE public.purchase_orders
     SET stock_applied_at = NULL,
         updated_at = now()
   WHERE id = p_po_id;
END;
$$;

-- 4) Trigger: before delete -> reverse stock first
CREATE OR REPLACE FUNCTION public.trg_po_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.stock_applied_at IS NOT NULL THEN
    PERFORM public.revert_po_inventory(OLD.id, COALESCE(public.current_user_email(), ''));
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS po_before_delete_revert ON public.purchase_orders;
CREATE TRIGGER po_before_delete_revert
BEFORE DELETE ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_po_before_delete();

-- 5) Trigger: after update -> if status flipped to 'cancelled' and stock had been applied, reverse
CREATE OR REPLACE FUNCTION public.trg_po_after_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND COALESCE(OLD.status,'') <> 'cancelled' AND OLD.stock_applied_at IS NOT NULL THEN
    PERFORM public.revert_po_inventory(NEW.id, COALESCE(public.current_user_email(), ''));
    INSERT INTO public.po_status_history (po_id, from_status, to_status, note, actor_id, actor_email)
    VALUES (NEW.id, OLD.status, 'cancelled', 'إلغاء أمر الشراء وعكس المخزون', auth.uid(), public.current_user_email());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS po_after_cancel_revert ON public.purchase_orders;
CREATE TRIGGER po_after_cancel_revert
AFTER UPDATE OF status ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_po_after_cancel();