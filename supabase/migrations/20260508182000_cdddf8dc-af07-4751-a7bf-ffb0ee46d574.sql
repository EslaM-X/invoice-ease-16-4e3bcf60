-- Track biometric enrollments per user/device so they can be listed and managed
CREATE TABLE public.biometric_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  device_label TEXT,
  user_agent TEXT,
  platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

ALTER TABLE public.biometric_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users select own biometric credentials"
ON public.biometric_credentials
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "users insert own biometric credentials"
ON public.biometric_credentials
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users update own biometric credentials"
ON public.biometric_credentials
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users delete own biometric credentials"
ON public.biometric_credentials
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX idx_biometric_credentials_user ON public.biometric_credentials(user_id);