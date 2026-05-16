
ALTER TABLE public.x_user_profile
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS nickname text;

CREATE TABLE IF NOT EXISTS public.x_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_name text NOT NULL,
  actor_job_title text,
  action_type text NOT NULL,
  description text NOT NULL,
  route text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_x_activity_log_created_at ON public.x_activity_log (created_at DESC);

ALTER TABLE public.x_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth users read activity"
  ON public.x_activity_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "users insert own activity"
  ON public.x_activity_log FOR INSERT
  TO authenticated
  WITH CHECK (actor_user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.x_activity_log;
