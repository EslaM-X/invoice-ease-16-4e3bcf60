
-- 1) Restrict notification-sounds storage write policies to authenticated users
DROP POLICY IF EXISTS "Users upload their own notification sounds" ON storage.objects;
DROP POLICY IF EXISTS "Users update their own notification sounds" ON storage.objects;
DROP POLICY IF EXISTS "Users delete their own notification sounds" ON storage.objects;

CREATE POLICY "Users upload their own notification sounds"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'notification-sounds'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users update their own notification sounds"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'notification-sounds'
  AND (auth.uid())::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'notification-sounds'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users delete their own notification sounds"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'notification-sounds'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

-- 2) Restrict price_list_items SELECT to authenticated users and remove from realtime publication
DROP POLICY IF EXISTS "anyone can view active price list" ON public.price_list_items;
CREATE POLICY "authenticated can view active price list"
ON public.price_list_items FOR SELECT TO authenticated
USING (is_active = true);

ALTER PUBLICATION supabase_realtime DROP TABLE public.price_list_items;
