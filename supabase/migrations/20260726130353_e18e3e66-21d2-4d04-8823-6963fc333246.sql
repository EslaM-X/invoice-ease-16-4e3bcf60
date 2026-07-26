
CREATE OR REPLACE FUNCTION public.recompute_invoice_delivery_status(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _total_items int;
  _fully_delivered int;
  _any_progress int;
  _next text;
  _current text;
BEGIN
  IF _invoice_id IS NULL THEN RETURN; END IF;

  SELECT delivery_status INTO _current FROM public.invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN RETURN; END IF;

  WITH ii AS (
    SELECT id, quantity FROM public.invoice_items WHERE invoice_id = _invoice_id
  ),
  delivered AS (
    SELECT dri.invoice_item_id, COALESCE(SUM(dri.quantity),0) AS q
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    WHERE dr.invoice_id = _invoice_id
      AND dr.status IN ('signed','paid')
      AND dri.invoice_item_id IS NOT NULL
    GROUP BY dri.invoice_item_id
  ),
  in_transit AS (
    SELECT dri.invoice_item_id, COALESCE(SUM(dri.quantity),0) AS q
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    WHERE dr.invoice_id = _invoice_id
      AND dr.status = 'out_for_delivery'
      AND dri.invoice_item_id IS NOT NULL
    GROUP BY dri.invoice_item_id
  )
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE COALESCE(d.q,0) >= ii.quantity)::int,
    COUNT(*) FILTER (WHERE COALESCE(d.q,0) > 0 OR COALESCE(t.q,0) > 0)::int
  INTO _total_items, _fully_delivered, _any_progress
  FROM ii
  LEFT JOIN delivered d ON d.invoice_item_id = ii.id
  LEFT JOIN in_transit t ON t.invoice_item_id = ii.id;

  IF _total_items = 0 THEN
    RETURN;
  ELSIF _fully_delivered = _total_items THEN
    _next := 'delivered';
  ELSIF _any_progress > 0 THEN
    _next := 'in_transit';
  ELSE
    _next := 'pending';
  END IF;

  IF _next IS DISTINCT FROM _current THEN
    UPDATE public.invoices SET delivery_status = _next WHERE id = _invoice_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_recompute_delivery_status_from_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_invoice_delivery_status(OLD.invoice_id);
  ELSE
    PERFORM public.recompute_invoice_delivery_status(NEW.invoice_id);
    IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
      PERFORM public.recompute_invoice_delivery_status(OLD.invoice_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_recompute_delivery_status_from_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _inv uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT invoice_id INTO _inv FROM public.delivery_receipts WHERE id = OLD.receipt_id;
  ELSE
    SELECT invoice_id INTO _inv FROM public.delivery_receipts WHERE id = NEW.receipt_id;
  END IF;
  PERFORM public.recompute_invoice_delivery_status(_inv);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_delivery_from_receipt ON public.delivery_receipts;
CREATE TRIGGER trg_recompute_delivery_from_receipt
AFTER INSERT OR UPDATE OF status, invoice_id OR DELETE ON public.delivery_receipts
FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_delivery_status_from_receipt();

DROP TRIGGER IF EXISTS trg_recompute_delivery_from_item ON public.delivery_receipt_items;
CREATE TRIGGER trg_recompute_delivery_from_item
AFTER INSERT OR UPDATE OR DELETE ON public.delivery_receipt_items
FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_delivery_status_from_item();

-- Backfill every invoice that has at least one receipt
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT invoice_id FROM public.delivery_receipts LOOP
    PERFORM public.recompute_invoice_delivery_status(r.invoice_id);
  END LOOP;
END $$;
