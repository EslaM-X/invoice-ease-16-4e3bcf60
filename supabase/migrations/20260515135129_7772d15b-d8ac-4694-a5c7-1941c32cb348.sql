
ALTER TABLE public.user_notification_preferences
  ADD COLUMN IF NOT EXISTS custom_sound_url text,
  ADD COLUMN IF NOT EXISTS custom_sound_name text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'notification-sounds',
  'notification-sounds',
  true,
  5242880,
  ARRAY['audio/mpeg','audio/mp3','audio/wav','audio/ogg','audio/aac','audio/x-m4a','audio/mp4','audio/webm']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Notification sounds are publicly readable" ON storage.objects;
CREATE POLICY "Notification sounds are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'notification-sounds');

DROP POLICY IF EXISTS "Users upload their own notification sounds" ON storage.objects;
CREATE POLICY "Users upload their own notification sounds"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'notification-sounds'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Users update their own notification sounds" ON storage.objects;
CREATE POLICY "Users update their own notification sounds"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'notification-sounds'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Users delete their own notification sounds" ON storage.objects;
CREATE POLICY "Users delete their own notification sounds"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'notification-sounds'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
