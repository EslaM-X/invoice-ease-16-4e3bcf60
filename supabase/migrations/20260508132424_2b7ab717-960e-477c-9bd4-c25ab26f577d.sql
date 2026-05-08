
CREATE TABLE IF NOT EXISTS public.invoice_system_notes_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid,
  changed_by_email text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_isnh_invoice ON public.invoice_system_notes_history(invoice_id, changed_at DESC);

ALTER TABLE public.invoice_system_notes_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members read system notes history"
ON public.invoice_system_notes_history FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_system_notes_history.invoice_id
      AND public.can_access_user_data(i.user_id)
  )
);

CREATE POLICY "system insert system notes history"
ON public.invoice_system_notes_history FOR INSERT TO authenticated
WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.log_invoice_system_notes_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF NEW.system_notes IS DISTINCT FROM OLD.system_notes THEN
    IF v_uid IS NOT NULL THEN
      SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
    END IF;
    INSERT INTO public.invoice_system_notes_history (invoice_id, old_value, new_value, changed_by, changed_by_email)
    VALUES (NEW.id, OLD.system_notes, NEW.system_notes, v_uid, COALESCE(v_email, NEW.updated_by_email));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_invoice_system_notes ON public.invoices;
CREATE TRIGGER trg_log_invoice_system_notes
AFTER UPDATE OF system_notes ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.log_invoice_system_notes_change();

ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_system_notes_history;
