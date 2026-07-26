
CREATE OR REPLACE FUNCTION public.recompute_invoice_delivery_status(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_current text;
  v_needed numeric;
  v_delivered numeric;
  v_next text;
BEGIN
  IF _invoice_id IS NULL THEN RETURN; END IF;

  SELECT status, delivery_status INTO v_status, v_current
  FROM public.invoices WHERE id = _invoice_id;

  IF NOT FOUND THEN RETURN; END IF;
  IF COALESCE(v_status,'') IN ('voided','archived','cancelled') THEN RETURN; END IF;

  SELECT COALESCE(SUM(quantity),0) INTO v_needed
  FROM public.invoice_items WHERE invoice_id = _invoice_id AND product_id IS NOT NULL;

  SELECT COALESCE(SUM(dri.quantity),0) INTO v_delivered
  FROM public.delivery_receipt_items dri
  JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
  WHERE dr.invoice_id = _invoice_id
    AND dr.status IN ('signed','out_for_delivery')
    AND dr.archived_at IS NULL;

  IF v_needed > 0 AND v_delivered >= v_needed THEN
    v_next := 'delivered';
  ELSIF v_delivered > 0 THEN
    v_next := 'in_transit';
  ELSE
    v_next := 'pending';
  END IF;

  IF v_next IS DISTINCT FROM COALESCE(v_current,'pending') THEN
    IF v_next = 'pending' THEN
      UPDATE public.invoices
         SET delivery_status = v_next,
             delivery_assignee_id = NULL,
             delivery_assignee_label = NULL
       WHERE id = _invoice_id;
    ELSE
      UPDATE public.invoices SET delivery_status = v_next WHERE id = _invoice_id;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_dri_recompute_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_inv uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT invoice_id INTO v_inv FROM public.delivery_receipts WHERE id = OLD.receipt_id;
  ELSE
    SELECT invoice_id INTO v_inv FROM public.delivery_receipts WHERE id = NEW.receipt_id;
  END IF;
  IF v_inv IS NOT NULL THEN
    PERFORM public.recompute_invoice_delivery_status(v_inv);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_dr_recompute_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_invoice_delivery_status(OLD.invoice_id);
    RETURN NULL;
  END IF;
  PERFORM public.recompute_invoice_delivery_status(NEW.invoice_id);
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM public.recompute_invoice_delivery_status(OLD.invoice_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_dri_recompute_delivery ON public.delivery_receipt_items;
CREATE TRIGGER trg_dri_recompute_delivery
AFTER INSERT OR UPDATE OR DELETE ON public.delivery_receipt_items
FOR EACH ROW EXECUTE FUNCTION public.tg_dri_recompute_delivery();

DROP TRIGGER IF EXISTS trg_dr_recompute_delivery ON public.delivery_receipts;
CREATE TRIGGER trg_dr_recompute_delivery
AFTER INSERT OR UPDATE OF status, archived_at, invoice_id OR DELETE ON public.delivery_receipts
FOR EACH ROW EXECUTE FUNCTION public.tg_dr_recompute_delivery();

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT i.id
    FROM public.invoices i
    JOIN public.delivery_receipts dr ON dr.invoice_id = i.id
    WHERE COALESCE(i.status,'') NOT IN ('voided','archived','cancelled')
  LOOP
    PERFORM public.recompute_invoice_delivery_status(r.id);
  END LOOP;
END $$;
