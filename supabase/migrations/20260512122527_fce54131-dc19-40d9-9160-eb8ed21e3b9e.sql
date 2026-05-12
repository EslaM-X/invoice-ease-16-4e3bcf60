-- USD cost on products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost_price_usd numeric NOT NULL DEFAULT 0;

-- Purchase orders
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  po_number text NOT NULL,
  supplier_name text,
  notes text,
  status text NOT NULL DEFAULT 'pending_cfo',
  total_usd numeric NOT NULL DEFAULT 0,
  total_qty integer NOT NULL DEFAULT 0,
  usd_rate numeric,
  customs_mode text,
  customs_value numeric,
  taxes_mode text,
  taxes_value numeric,
  shipping_mode text,
  shipping_value numeric,
  other_mode text,
  other_value numeric,
  total_egp numeric,
  cfo_notes text,
  cfo_priced_at timestamptz,
  cfo_priced_by uuid,
  cfo_priced_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_email text
);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  product_name text NOT NULL,
  serial_number text,
  color text,
  image_url text,
  quantity integer NOT NULL,
  unit_cost_usd numeric NOT NULL DEFAULT 0,
  line_total_usd numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_items_po ON public.purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_user ON public.purchase_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON public.purchase_orders(status);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company po select" ON public.purchase_orders
  FOR SELECT TO authenticated USING (can_access_user_data(user_id));

CREATE POLICY "purchasing po insert" ON public.purchase_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    ((auth.uid() = user_id) OR is_company_member())
    AND (is_admin() OR has_role(auth.uid(), 'purchasing'::app_role))
  );

CREATE POLICY "cfo po update" ON public.purchase_orders
  FOR UPDATE TO authenticated
  USING (
    can_access_user_data(user_id)
    AND (is_admin() OR has_role(auth.uid(), 'cfo'::app_role) OR has_role(auth.uid(), 'purchasing'::app_role))
  );

CREATE POLICY "admin po delete" ON public.purchase_orders
  FOR DELETE TO authenticated USING (is_admin());

CREATE POLICY "po items select" ON public.purchase_order_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_orders p WHERE p.id = po_id AND can_access_user_data(p.user_id)));

CREATE POLICY "po items insert" ON public.purchase_order_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.purchase_orders p
    WHERE p.id = po_id AND can_access_user_data(p.user_id)
      AND (is_admin() OR has_role(auth.uid(), 'purchasing'::app_role))
  ));

CREATE POLICY "po items update" ON public.purchase_order_items
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_orders p WHERE p.id = po_id AND can_access_user_data(p.user_id)));

CREATE POLICY "po items delete" ON public.purchase_order_items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_orders p WHERE p.id = po_id AND can_access_user_data(p.user_id) AND is_admin()));

DROP TRIGGER IF EXISTS trg_po_updated_at ON public.purchase_orders;
CREATE TRIGGER trg_po_updated_at BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Assign roles by email (if profiles already exist)
INSERT INTO public.user_roles (user_id, role)
SELECT p.user_id, 'purchasing'::app_role FROM public.profiles p
WHERE lower(p.email) = lower('K.elsharbatly@steinheim-eg.com')
ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT p.user_id, 'cfo'::app_role FROM public.profiles p
WHERE lower(p.email) = lower('Cfo@steinheim-eg.com')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.auto_assign_special_roles()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    IF lower(NEW.email) = lower('K.elsharbatly@steinheim-eg.com') THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.user_id, 'purchasing'::app_role)
      ON CONFLICT DO NOTHING;
    ELSIF lower(NEW.email) = lower('Cfo@steinheim-eg.com') THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.user_id, 'cfo'::app_role)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_assign_special_roles ON public.profiles;
CREATE TRIGGER trg_auto_assign_special_roles
  AFTER INSERT OR UPDATE OF email ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_special_roles();