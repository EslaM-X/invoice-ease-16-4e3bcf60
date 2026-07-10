
CREATE TABLE IF NOT EXISTS public.profit_cost_overrides_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('insert','update','delete')),
  old_cost_egp NUMERIC,
  new_cost_egp NUMERIC,
  old_note TEXT,
  new_note TEXT,
  changed_by UUID,
  changed_by_email TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.profit_cost_overrides_history TO authenticated;
GRANT ALL ON public.profit_cost_overrides_history TO service_role;

ALTER TABLE public.profit_cost_overrides_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read override history"
  ON public.profit_cost_overrides_history
  FOR SELECT TO authenticated
  USING (public.is_company_member());

CREATE POLICY "members insert override history"
  ON public.profit_cost_overrides_history
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member());

CREATE INDEX IF NOT EXISTS idx_pcoh_product_time
  ON public.profit_cost_overrides_history(product_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.log_profit_cost_override()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID := auth.uid();
  actor_email TEXT;
BEGIN
  SELECT email INTO actor_email FROM auth.users WHERE id = actor;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.profit_cost_overrides_history
      (product_id, action, old_cost_egp, new_cost_egp, old_note, new_note, changed_by, changed_by_email)
    VALUES (NEW.product_id, 'insert', NULL, NEW.cost_egp, NULL, NEW.note, actor, actor_email);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.cost_egp IS DISTINCT FROM NEW.cost_egp
       OR OLD.note IS DISTINCT FROM NEW.note THEN
      INSERT INTO public.profit_cost_overrides_history
        (product_id, action, old_cost_egp, new_cost_egp, old_note, new_note, changed_by, changed_by_email)
      VALUES (NEW.product_id, 'update', OLD.cost_egp, NEW.cost_egp, OLD.note, NEW.note, actor, actor_email);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.profit_cost_overrides_history
      (product_id, action, old_cost_egp, new_cost_egp, old_note, new_note, changed_by, changed_by_email)
    VALUES (OLD.product_id, 'delete', OLD.cost_egp, NULL, OLD.note, NULL, actor, actor_email);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_profit_cost_override ON public.profit_cost_overrides;
CREATE TRIGGER trg_log_profit_cost_override
AFTER INSERT OR UPDATE OR DELETE ON public.profit_cost_overrides
FOR EACH ROW EXECUTE FUNCTION public.log_profit_cost_override();

CREATE OR REPLACE FUNCTION public.revert_profit_cost_override(p_history_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  h RECORD;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can revert overrides';
  END IF;

  SELECT * INTO h FROM public.profit_cost_overrides_history WHERE id = p_history_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'History entry not found'; END IF;

  IF h.action = 'insert' THEN
    DELETE FROM public.profit_cost_overrides WHERE product_id = h.product_id;
  ELSE
    INSERT INTO public.profit_cost_overrides (product_id, cost_egp, note, updated_by)
    VALUES (h.product_id, COALESCE(h.old_cost_egp, 0), h.old_note, auth.uid())
    ON CONFLICT (product_id) DO UPDATE SET cost_egp = EXCLUDED.cost_egp, note = EXCLUDED.note, updated_by = auth.uid();
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_profit_cost_override(UUID) TO authenticated;
