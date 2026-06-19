
-- 1) Restrictive deny policies on backups_log: no UPDATE / no DELETE from the API.
DROP POLICY IF EXISTS "backups_log no update" ON public.backups_log;
DROP POLICY IF EXISTS "backups_log no delete" ON public.backups_log;
CREATE POLICY "backups_log no update" ON public.backups_log
  AS RESTRICTIVE FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "backups_log no delete" ON public.backups_log
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

-- 2) chat-attachments UPDATE policy scoped to file owner only.
DROP POLICY IF EXISTS "chat-attachments owner update" ON storage.objects;
CREATE POLICY "chat-attachments owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'chat-attachments' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'chat-attachments' AND owner = auth.uid());
