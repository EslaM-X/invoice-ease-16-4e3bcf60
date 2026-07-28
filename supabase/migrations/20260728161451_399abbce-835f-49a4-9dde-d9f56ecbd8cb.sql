
-- ============ Wave 1: Schema ============
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS reserved_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivered_qty integer NOT NULL DEFAULT 0;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS reserved_quantity integer NOT NULL DEFAULT 0;

-- available_quantity as generated column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products' AND column_name='available_quantity'
  ) THEN
    EXECUTE 'ALTER TABLE public.products ADD COLUMN available_quantity integer GENERATED ALWAYS AS (COALESCE(stock_quantity,0) - COALESCE(reserved_quantity,0)) STORED';
  END IF;
END$$;

-- ============ Backfill delivered_qty from signed delivery receipts ============
-- Match by invoice_item_id when present, else by (invoice_id, normalized name+serial+color)
WITH signed_items AS (
  SELECT dri.invoice_item_id,
         dr.invoice_id,
         lower(btrim(dri.product_name))  AS name_key,
         lower(coalesce(btrim(dri.serial_number),'')) AS sn_key,
         lower(coalesce(btrim(dri.color),''))         AS color_key,
         SUM(dri.quantity)::int AS qty
  FROM public.delivery_receipt_items dri
  JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
  WHERE dr.status = 'signed'
  GROUP BY dri.invoice_item_id, dr.invoice_id, name_key, sn_key, color_key
),
matched AS (
  SELECT ii.id AS invoice_item_id, SUM(s.qty)::int AS delivered
  FROM public.invoice_items ii
  JOIN signed_items s
    ON (s.invoice_item_id = ii.id)
    OR ( s.invoice_item_id IS NULL
         AND s.invoice_id = ii.invoice_id
         AND s.name_key = lower(btrim(ii.product_name))
         AND s.sn_key   = lower(coalesce(btrim(ii.serial_number),''))
         AND s.color_key= lower(coalesce(btrim(ii.color),'')) )
  GROUP BY ii.id
)
UPDATE public.invoice_items ii
SET delivered_qty = LEAST(m.delivered, ii.quantity)
FROM matched m
WHERE m.invoice_item_id = ii.id;

-- ============ Backfill reserved_qty for active invoices ============
-- Active = not draft, not voided, not fully paid AND fully delivered (i.e. still consuming stock reservation logically)
UPDATE public.invoice_items ii
SET reserved_qty = GREATEST(ii.quantity - ii.delivered_qty, 0)
FROM public.invoices inv
WHERE inv.id = ii.invoice_id
  AND COALESCE(inv.status,'') NOT IN ('draft','voided','cancelled')
  AND COALESCE(inv.archive_ready, false) = false;

-- Everything else: no active reservation
UPDATE public.invoice_items ii
SET reserved_qty = 0
FROM public.invoices inv
WHERE inv.id = ii.invoice_id
  AND (COALESCE(inv.status,'') IN ('draft','voided','cancelled')
       OR COALESCE(inv.archive_ready,false) = true);

-- ============ Rebuild products.reserved_quantity from truth ============
UPDATE public.products p
SET reserved_quantity = COALESCE(agg.total, 0)
FROM (
  SELECT ii.product_id, SUM(ii.reserved_qty)::int AS total
  FROM public.invoice_items ii
  WHERE ii.product_id IS NOT NULL
  GROUP BY ii.product_id
) agg
WHERE p.id = agg.product_id;

UPDATE public.products p
SET reserved_quantity = 0
WHERE NOT EXISTS (
  SELECT 1 FROM public.invoice_items ii WHERE ii.product_id = p.id AND ii.reserved_qty > 0
);

-- ============ Trigger to keep products.reserved_quantity in sync ============
CREATE OR REPLACE FUNCTION public.sync_product_reserved_qty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_pid uuid;
  new_pid uuid;
  old_qty int;
  new_qty int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.product_id IS NOT NULL AND COALESCE(NEW.reserved_qty,0) <> 0 THEN
      UPDATE public.products
        SET reserved_quantity = GREATEST(COALESCE(reserved_quantity,0) + NEW.reserved_qty, 0)
        WHERE id = NEW.product_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    old_pid := OLD.product_id; new_pid := NEW.product_id;
    old_qty := COALESCE(OLD.reserved_qty,0); new_qty := COALESCE(NEW.reserved_qty,0);
    IF old_pid IS NOT DISTINCT FROM new_pid THEN
      IF old_qty <> new_qty AND new_pid IS NOT NULL THEN
        UPDATE public.products
          SET reserved_quantity = GREATEST(COALESCE(reserved_quantity,0) + (new_qty - old_qty), 0)
          WHERE id = new_pid;
      END IF;
    ELSE
      IF old_pid IS NOT NULL AND old_qty <> 0 THEN
        UPDATE public.products
          SET reserved_quantity = GREATEST(COALESCE(reserved_quantity,0) - old_qty, 0)
          WHERE id = old_pid;
      END IF;
      IF new_pid IS NOT NULL AND new_qty <> 0 THEN
        UPDATE public.products
          SET reserved_quantity = GREATEST(COALESCE(reserved_quantity,0) + new_qty, 0)
          WHERE id = new_pid;
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.product_id IS NOT NULL AND COALESCE(OLD.reserved_qty,0) <> 0 THEN
      UPDATE public.products
        SET reserved_quantity = GREATEST(COALESCE(reserved_quantity,0) - OLD.reserved_qty, 0)
        WHERE id = OLD.product_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_reserved_qty ON public.invoice_items;
CREATE TRIGGER trg_sync_product_reserved_qty
AFTER INSERT OR UPDATE OF reserved_qty, product_id OR DELETE
ON public.invoice_items
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_reserved_qty();

-- ============ Helpful indexes ============
CREATE INDEX IF NOT EXISTS idx_invoice_items_product_reserved
  ON public.invoice_items(product_id) WHERE reserved_qty > 0;
