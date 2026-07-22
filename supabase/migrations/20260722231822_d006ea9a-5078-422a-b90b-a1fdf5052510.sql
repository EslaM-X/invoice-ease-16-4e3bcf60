
DROP POLICY IF EXISTS "chat wallpapers owner read" ON storage.objects;
DROP POLICY IF EXISTS "chat wallpapers owner insert" ON storage.objects;
DROP POLICY IF EXISTS "chat wallpapers owner update" ON storage.objects;
DROP POLICY IF EXISTS "chat wallpapers owner delete" ON storage.objects;

CREATE POLICY "chat wallpapers owner read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-wallpapers' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "chat wallpapers owner insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'chat-wallpapers' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "chat wallpapers owner update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'chat-wallpapers' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'chat-wallpapers' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "chat wallpapers owner delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'chat-wallpapers' AND (storage.foldername(name))[1] = auth.uid()::text);
