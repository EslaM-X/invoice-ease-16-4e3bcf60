
-- 1) Columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_type TEXT,
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approval_notes TEXT,
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- 2) Constraints (drop+add to be idempotent)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_account_type_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_type_check
  CHECK (account_type IS NULL OR account_type IN ('employee','distributor'));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_approval_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_approval_status_check
  CHECK (approval_status IN ('pending','approved','rejected'));

-- 3) Existing users already in the system are auto-approved
UPDATE public.profiles
SET approval_status = 'approved',
    approved_at = COALESCE(approved_at, now())
WHERE approval_status = 'pending'
  AND created_at < now() - interval '1 minute';

-- 4) Update signup trigger to capture account_type from metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_type TEXT;
BEGIN
  v_type := NULLIF(NEW.raw_user_meta_data->>'account_type', '');
  IF v_type IS NOT NULL AND v_type NOT IN ('employee','distributor') THEN
    v_type := NULL;
  END IF;

  INSERT INTO public.profiles (user_id, email, display_name, account_type, approval_status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    v_type,
    'pending'
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- Notify admins of the new pending request
  INSERT INTO public.notifications (type, title, body, recipient_role, meta)
  VALUES (
    'account_pending_approval',
    'طلب حساب جديد بانتظار الموافقة',
    COALESCE(NEW.email,'') || ' — ' || COALESCE(v_type,'لم يحدد'),
    'admin',
    jsonb_build_object('user_id', NEW.id, 'email', NEW.email, 'account_type', v_type)
  );

  RETURN NEW;
END; $$;

-- 5) Allow admins to update approval status / type via RLS
DROP POLICY IF EXISTS "admins update profiles approval" ON public.profiles;
CREATE POLICY "admins update profiles approval"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- 6) Index
CREATE INDEX IF NOT EXISTS idx_profiles_approval_status ON public.profiles(approval_status);
