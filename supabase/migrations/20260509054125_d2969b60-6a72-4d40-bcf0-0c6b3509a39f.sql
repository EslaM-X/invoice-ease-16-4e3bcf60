CREATE TABLE IF NOT EXISTS public.biometric_auth_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  email text,
  credential_id text,
  status text NOT NULL CHECK (status IN ('success','failed')),
  error_message text,
  device_label text,
  platform text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_biometric_auth_log_user ON public.biometric_auth_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_biometric_auth_log_email ON public.biometric_auth_log(email, created_at DESC);

ALTER TABLE public.biometric_auth_log ENABLE ROW LEVEL SECURITY;

-- Anyone (including unauthenticated) can insert their attempt — biometric verify happens before sign-in
CREATE POLICY "anyone insert biometric attempts"
  ON public.biometric_auth_log
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Users can view their own attempts; admins/company members view all
CREATE POLICY "users view own biometric attempts"
  ON public.biometric_auth_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR is_admin() OR is_company_member());