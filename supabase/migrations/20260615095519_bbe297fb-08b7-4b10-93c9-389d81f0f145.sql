
-- =====================================================================
-- Phase 1: Shipment typing (G/A/D), versioned receipt codes, spare parts
-- =====================================================================

-- 1) Shipment counters per user/type
CREATE TABLE IF NOT EXISTS public.shipment_counters (
  user_id uuid NOT NULL,
  shipment_type text NOT NULL,
  last_seq integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, shipment_type)
);
GRANT SELECT ON public.shipment_counters TO authenticated;
GRANT ALL ON public.shipment_counters TO service_role;
ALTER TABLE public.shipment_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company members read shipment counters"
  ON public.shipment_counters FOR SELECT
  TO authenticated
  USING (public.can_access_user_data(user_id));

-- 2) Add shipment_type + shipment_code to purchase_orders
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS shipment_type text NOT NULL DEFAULT 'grounded',
  ADD COLUMN IF NOT EXISTS shipment_code text;

-- Validate type
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_shipment_type_check'
  ) THEN
    ALTER TABLE public.purchase_orders
      ADD CONSTRAINT purchase_orders_shipment_type_check
      CHECK (shipment_type IN ('grounded','air','door_to_door'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_user_shipment_code_uidx
  ON public.purchase_orders(user_id, shipment_code)
  WHERE shipment_code IS NOT NULL;

-- 3) Add receipt_code to po_receipts
ALTER TABLE public.po_receipts
  ADD COLUMN IF NOT EXISTS receipt_code text;

CREATE UNIQUE INDEX IF NOT EXISTS po_receipts_po_receipt_code_uidx
  ON public.po_receipts(po_id, receipt_code)
  WHERE receipt_code IS NOT NULL;

-- 4) Spare parts on products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_spare_part boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_is_spare_part_idx ON public.products(user_id, is_spare_part);

-- 5) Trigger function: assign shipment_code on PO insert
CREATE OR REPLACE FUNCTION public.assign_shipment_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_seq integer;
BEGIN
  IF NEW.shipment_code IS NOT NULL AND length(btrim(NEW.shipment_code)) > 0 THEN
    RETURN NEW;
  END IF;

  v_prefix := CASE NEW.shipment_type
    WHEN 'grounded' THEN 'G'
    WHEN 'air' THEN 'A'
    WHEN 'door_to_door' THEN 'D'
    ELSE 'G'
  END;

  INSERT INTO public.shipment_counters(user_id, shipment_type, last_seq)
  VALUES (NEW.user_id, NEW.shipment_type, 1)
  ON CONFLICT (user_id, shipment_type) DO UPDATE
    SET last_seq = public.shipment_counters.last_seq + 1,
        updated_at = now()
  RETURNING last_seq INTO v_seq;

  NEW.shipment_code := v_prefix || v_seq::text;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_shipment_code ON public.purchase_orders;
CREATE TRIGGER trg_assign_shipment_code
  BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_shipment_code();

-- 6) Trigger function: assign receipt_code on po_receipts insert
CREATE OR REPLACE FUNCTION public.assign_po_receipt_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ship_code text;
BEGIN
  IF NEW.receipt_code IS NOT NULL AND length(btrim(NEW.receipt_code)) > 0 THEN
    RETURN NEW;
  END IF;
  SELECT shipment_code INTO v_ship_code
    FROM public.purchase_orders WHERE id = NEW.po_id;
  IF v_ship_code IS NULL THEN
    v_ship_code := 'PO';
  END IF;
  NEW.receipt_code := v_ship_code || '#' || COALESCE(NEW.receipt_number, 1)::text;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_po_receipt_code ON public.po_receipts;
CREATE TRIGGER trg_assign_po_receipt_code
  BEFORE INSERT ON public.po_receipts
  FOR EACH ROW EXECUTE FUNCTION public.assign_po_receipt_code();

-- 7) Backfill existing purchase_orders with shipment_code
DO $$
DECLARE
  r record;
  v_prefix text;
  v_seq integer;
BEGIN
  FOR r IN
    SELECT id, user_id, shipment_type
      FROM public.purchase_orders
     WHERE shipment_code IS NULL
     ORDER BY user_id, created_at
  LOOP
    v_prefix := CASE r.shipment_type
      WHEN 'grounded' THEN 'G'
      WHEN 'air' THEN 'A'
      WHEN 'door_to_door' THEN 'D'
      ELSE 'G'
    END;

    INSERT INTO public.shipment_counters(user_id, shipment_type, last_seq)
    VALUES (r.user_id, r.shipment_type, 1)
    ON CONFLICT (user_id, shipment_type) DO UPDATE
      SET last_seq = public.shipment_counters.last_seq + 1
    RETURNING last_seq INTO v_seq;

    UPDATE public.purchase_orders
       SET shipment_code = v_prefix || v_seq::text
     WHERE id = r.id;
  END LOOP;
END $$;

-- 8) Backfill existing po_receipts with receipt_code
UPDATE public.po_receipts r
   SET receipt_code = po.shipment_code || '#' || r.receipt_number::text
  FROM public.purchase_orders po
 WHERE r.po_id = po.id
   AND r.receipt_code IS NULL
   AND po.shipment_code IS NOT NULL;
