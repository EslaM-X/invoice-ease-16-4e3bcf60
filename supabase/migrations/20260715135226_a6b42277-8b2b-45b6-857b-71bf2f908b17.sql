
-- Reduce needs_order reservations for a product FIFO when new stock lands.
CREATE OR REPLACE FUNCTION public.consume_needs_order_for_product(_product_id uuid, _delta integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining integer := GREATEST(0, COALESCE(_delta, 0));
  r RECORD;
BEGIN
  IF remaining <= 0 THEN RETURN; END IF;
  FOR r IN
    SELECT res.id, res.quantity
    FROM public.invoice_po_reservations res
    JOIN public.invoices i ON i.id = res.invoice_id
    WHERE res.product_id = _product_id
      AND res.status = 'needs_order'
      AND i.status <> 'voided'
    ORDER BY i.created_at ASC, res.created_at ASC
  LOOP
    IF remaining <= 0 THEN EXIT; END IF;
    IF r.quantity <= remaining THEN
      DELETE FROM public.invoice_po_reservations WHERE id = r.id;
      remaining := remaining - r.quantity;
    ELSE
      UPDATE public.invoice_po_reservations
      SET quantity = quantity - remaining
      WHERE id = r.id;
      remaining := 0;
    END IF;
  END LOOP;
END;
$$;

-- Trigger: whenever product.stock_quantity increases, consume outstanding shortage.
CREATE OR REPLACE FUNCTION public.tg_products_consume_shortage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stock_quantity > COALESCE(OLD.stock_quantity, 0) THEN
    PERFORM public.consume_needs_order_for_product(
      NEW.id,
      NEW.stock_quantity - COALESCE(OLD.stock_quantity, 0)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_consume_shortage ON public.products;
CREATE TRIGGER trg_products_consume_shortage
AFTER UPDATE OF stock_quantity ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.tg_products_consume_shortage();

-- Trigger: when a delivery-receipt item is inserted, cover that invoice+product shortage.
CREATE OR REPLACE FUNCTION public.tg_dri_consume_shortage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _invoice_id uuid;
  _product_id uuid;
  remaining integer := GREATEST(0, COALESCE(NEW.quantity, 0));
  r RECORD;
BEGIN
  IF remaining <= 0 THEN RETURN NEW; END IF;
  SELECT ii.invoice_id, ii.product_id
    INTO _invoice_id, _product_id
  FROM public.invoice_items ii
  WHERE ii.id = NEW.invoice_item_id;

  IF _invoice_id IS NULL OR _product_id IS NULL THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT id, quantity
    FROM public.invoice_po_reservations
    WHERE invoice_id = _invoice_id
      AND product_id = _product_id
      AND status = 'needs_order'
    ORDER BY created_at ASC
  LOOP
    IF remaining <= 0 THEN EXIT; END IF;
    IF r.quantity <= remaining THEN
      DELETE FROM public.invoice_po_reservations WHERE id = r.id;
      remaining := remaining - r.quantity;
    ELSE
      UPDATE public.invoice_po_reservations SET quantity = quantity - remaining WHERE id = r.id;
      remaining := 0;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dri_consume_shortage ON public.delivery_receipt_items;
CREATE TRIGGER trg_dri_consume_shortage
AFTER INSERT ON public.delivery_receipt_items
FOR EACH ROW EXECUTE FUNCTION public.tg_dri_consume_shortage();

-- Helper: uncovered shortage lines for one invoice (used to gate invoice closing).
CREATE OR REPLACE FUNCTION public.invoice_uncovered_shortage(_invoice_id uuid)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  serial_number text,
  color text,
  image_url text,
  quantity bigint,
  stock_quantity integer,
  incoming_qty bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH needs AS (
    SELECT r.product_id, SUM(r.quantity)::bigint AS qty
    FROM public.invoice_po_reservations r
    WHERE r.invoice_id = _invoice_id AND r.status = 'needs_order'
    GROUP BY r.product_id
  ),
  incoming AS (
    SELECT poi.product_id,
           SUM(GREATEST(0, poi.quantity - COALESCE(poi.received_qty, 0)))::bigint AS incoming_qty
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.po_id
    WHERE po.status IN ('ordered','shipped','in_warehouse')
    GROUP BY poi.product_id
  )
  SELECT n.product_id,
         COALESCE(p.name, n.product_id::text) AS product_name,
         p.serial_number,
         p.color,
         p.image_url,
         n.qty,
         COALESCE(p.stock_quantity, 0),
         COALESCE(i.incoming_qty, 0)
  FROM needs n
  LEFT JOIN public.products p ON p.id = n.product_id
  LEFT JOIN incoming i ON i.product_id = n.product_id
  WHERE n.qty > 0;
$$;

GRANT EXECUTE ON FUNCTION public.consume_needs_order_for_product(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_uncovered_shortage(uuid) TO authenticated, service_role;
