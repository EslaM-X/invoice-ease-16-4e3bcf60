-- 1) Avatars bucket (public so it can render anywhere by URL)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage policies on avatars
DROP POLICY IF EXISTS "avatars public read" ON storage.objects;
CREATE POLICY "avatars public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars user upload own" ON storage.objects;
CREATE POLICY "avatars user upload own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "avatars user update own" ON storage.objects;
CREATE POLICY "avatars user update own"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "avatars user delete own" ON storage.objects;
CREATE POLICY "avatars user delete own"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- 2) Add avatar_url to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- 3) Make profiles readable by all company members so we can show avatars next to emails
DROP POLICY IF EXISTS "company members view profiles" ON public.profiles;
CREATE POLICY "company members view profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR (
    EXISTS (SELECT 1 FROM public.company_members WHERE user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id = profiles.user_id)
  )
);

-- 4) Enable realtime for audit_log (for the live feed)
ALTER TABLE public.audit_log REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_log;