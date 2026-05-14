CREATE TABLE public.po_profit_scenarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  po_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  discount_mode TEXT NOT NULL DEFAULT 'percent',
  discount_value NUMERIC NOT NULL DEFAULT 0,
  selling_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  updated_by UUID,
  updated_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.po_profit_scenarios
  ADD CONSTRAINT po_profit_scenarios_po_fk
  FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;

ALTER TABLE public.po_profit_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cfo admin select scenarios"
ON public.po_profit_scenarios FOR SELECT TO authenticated
USING (can_access_user_data(user_id) AND (is_admin() OR has_role(auth.uid(), 'cfo'::app_role)));

CREATE POLICY "cfo admin insert scenarios"
ON public.po_profit_scenarios FOR INSERT TO authenticated
WITH CHECK (can_access_user_data(user_id) AND (is_admin() OR has_role(auth.uid(), 'cfo'::app_role)));

CREATE POLICY "cfo admin update scenarios"
ON public.po_profit_scenarios FOR UPDATE TO authenticated
USING (can_access_user_data(user_id) AND (is_admin() OR has_role(auth.uid(), 'cfo'::app_role)))
WITH CHECK (can_access_user_data(user_id) AND (is_admin() OR has_role(auth.uid(), 'cfo'::app_role)));

CREATE POLICY "cfo admin delete scenarios"
ON public.po_profit_scenarios FOR DELETE TO authenticated
USING (can_access_user_data(user_id) AND (is_admin() OR has_role(auth.uid(), 'cfo'::app_role)));

CREATE TRIGGER update_po_profit_scenarios_updated_at
BEFORE UPDATE ON public.po_profit_scenarios
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.po_profit_scenarios;