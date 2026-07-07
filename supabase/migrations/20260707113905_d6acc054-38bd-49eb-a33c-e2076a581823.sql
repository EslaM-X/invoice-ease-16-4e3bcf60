
-- 1) Outbox table
CREATE TABLE IF NOT EXISTS public.warranty_outbox_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  last_status INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.warranty_outbox_events TO service_role;

ALTER TABLE public.warranty_outbox_events ENABLE ROW LEVEL SECURITY;

-- No user-facing policies: outbox is server-only via service role.
CREATE POLICY "warranty_outbox no user access"
  ON public.warranty_outbox_events FOR SELECT
  TO authenticated
  USING (false);

CREATE INDEX IF NOT EXISTS idx_warranty_outbox_pending
  ON public.warranty_outbox_events (next_retry_at)
  WHERE delivered_at IS NULL;

CREATE OR REPLACE FUNCTION public.warranty_outbox_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_warranty_outbox_touch ON public.warranty_outbox_events;
CREATE TRIGGER trg_warranty_outbox_touch
  BEFORE UPDATE ON public.warranty_outbox_events
  FOR EACH ROW EXECUTE FUNCTION public.warranty_outbox_touch();

-- 2) Enqueue helpers (SECURITY DEFINER so triggers on user-writable tables can insert)
CREATE OR REPLACE FUNCTION public.warranty_enqueue(_event TEXT, _payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.warranty_outbox_events (event, payload)
  VALUES (_event, _payload || jsonb_build_object('event', _event));
END;
$$;

-- 3) Trigger: customers
CREATE OR REPLACE FUNCTION public.warranty_on_customer_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _event TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'customer.created' ELSE 'customer.updated' END;
  _payload JSONB;
BEGIN
  _payload := jsonb_build_object(
    'customer', jsonb_build_object(
      'external_id', NEW.id::text,
      'name', NEW.name,
      'phone', NEW.phone,
      'category', NEW.category,
      'company_name', NEW.company_name,
      'contact_person', NEW.contact_person,
      'address', NEW.address
    )
  );
  PERFORM public.warranty_enqueue(_event, _payload);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_warranty_customers ON public.customers;
CREATE TRIGGER trg_warranty_customers
  AFTER INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.warranty_on_customer_change();

-- 4) Trigger: invoices (includes items snapshot + customer)
CREATE OR REPLACE FUNCTION public.warranty_on_invoice_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _event TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'invoice.created' ELSE 'invoice.updated' END;
  _customer JSONB;
  _items JSONB;
  _payload JSONB;
BEGIN
  SELECT jsonb_build_object(
    'external_id', c.id::text,
    'name', c.name,
    'phone', c.phone,
    'category', c.category
  ) INTO _customer
  FROM public.customers c WHERE c.id = NEW.customer_id;

  IF _customer IS NULL AND NEW.customer_name IS NOT NULL THEN
    _customer := jsonb_build_object(
      'external_id', COALESCE(NEW.customer_id::text, 'inv:' || NEW.id::text),
      'name', NEW.customer_name,
      'phone', NEW.customer_phone
    );
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'external_id', ii.id::text,
    'invoice_external_id', NEW.id::text,
    'product_name', ii.product_name,
    'sku', ii.serial_number,
    'serial_no', ii.serial_number,
    'quantity', ii.quantity,
    'unit_price', ii.unit_price,
    'color', ii.color,
    'purchased_at', NEW.created_at
  )), '[]'::jsonb) INTO _items
  FROM public.invoice_items ii WHERE ii.invoice_id = NEW.id;

  _payload := jsonb_build_object(
    'invoice', jsonb_build_object(
      'external_id', NEW.id::text,
      'invoice_no', NEW.invoice_number,
      'customer_external_id', COALESCE(NEW.customer_id::text, _customer->>'external_id'),
      'subtotal', NEW.subtotal,
      'discount', NEW.discount,
      'total', NEW.total,
      'currency', 'EGP',
      'status', NEW.status,
      'delivery_status', NEW.delivery_status,
      'language', NEW.language,
      'created_at', NEW.created_at
    ),
    'customer', _customer,
    'items', _items
  );

  PERFORM public.warranty_enqueue(_event, _payload);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_warranty_invoices ON public.invoices;
CREATE TRIGGER trg_warranty_invoices
  AFTER INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.warranty_on_invoice_change();

-- 5) Trigger: invoice_items (items-only delta)
CREATE OR REPLACE FUNCTION public.warranty_on_invoice_item_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row RECORD;
  _payload JSONB;
BEGIN
  _row := COALESCE(NEW, OLD);
  _payload := jsonb_build_object(
    'items', jsonb_build_array(jsonb_build_object(
      'external_id', _row.id::text,
      'invoice_external_id', _row.invoice_id::text,
      'product_name', _row.product_name,
      'sku', _row.serial_number,
      'serial_no', _row.serial_number,
      'quantity', _row.quantity,
      'unit_price', _row.unit_price,
      'deleted', (TG_OP = 'DELETE')
    ))
  );
  PERFORM public.warranty_enqueue('items.updated', _payload);
  RETURN _row;
END;
$$;

DROP TRIGGER IF EXISTS trg_warranty_invoice_items ON public.invoice_items;
CREATE TRIGGER trg_warranty_invoice_items
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.warranty_on_invoice_item_change();
