-- Profile: job title shown in chat + color tag
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS job_title_color text;

-- Storage policies for chat-voice-notes (mirror chat-attachments)
DROP POLICY IF EXISTS "chat voice room members upload" ON storage.objects;
DROP POLICY IF EXISTS "chat voice room members read" ON storage.objects;
DROP POLICY IF EXISTS "chat voice owner delete" ON storage.objects;

CREATE POLICY "chat voice room members upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-voice-notes'
  AND public.is_chat_room_member(((storage.foldername(name))[1])::uuid, auth.uid())
);

CREATE POLICY "chat voice room members read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-voice-notes'
  AND public.is_chat_room_member(((storage.foldername(name))[1])::uuid, auth.uid())
);

CREATE POLICY "chat voice owner delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'chat-voice-notes' AND owner = auth.uid());