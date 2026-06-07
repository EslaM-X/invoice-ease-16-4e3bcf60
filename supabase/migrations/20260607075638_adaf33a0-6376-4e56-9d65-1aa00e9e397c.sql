CREATE TABLE public.fulfillment_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL,
  invoice_number text NOT NULL,
  action text NOT NULL,
  tier text NOT NULL,
  mode text NOT NULL,
  confidence integer NOT NULL DEFAULT 0,
  total_needed integer NOT NULL DEFAULT 0,
  total_from_stock integer NOT NULL DEFAULT 0,
  total_from_incoming integer NOT NULL DEFAULT 0,
  total_shortfall integer NOT NULL DEFAULT 0,
  manual_count integer NOT NULL DEFAULT 0,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  needs jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fulfillment_audit_log TO authenticated;
GRANT ALL ON public.fulfillment_audit_log TO service_role;

ALTER TABLE public.fulfillment_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own fulfillment audit log"
  ON public.fulfillment_audit_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own fulfillment audit log"
  ON public.fulfillment_audit_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own fulfillment audit log"
  ON public.fulfillment_audit_log FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_fulfillment_audit_log_user_created
  ON public.fulfillment_audit_log (user_id, created_at DESC);
CREATE INDEX idx_fulfillment_audit_log_invoice
  ON public.fulfillment_audit_log (invoice_id, created_at DESC);
