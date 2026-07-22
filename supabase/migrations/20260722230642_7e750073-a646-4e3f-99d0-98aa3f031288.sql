
-- Membership helper (SECURITY DEFINER, avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.is_chat_room_member(_room_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_room_members
    WHERE room_id = _room_id AND user_id = _user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_chat_room_member(uuid, uuid) TO authenticated;

-- Read receipts table
CREATE TABLE IF NOT EXISTS public.chat_message_reads (
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  room_id uuid NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_reads_room_user ON public.chat_message_reads(room_id, user_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_reads_message ON public.chat_message_reads(message_id);

GRANT SELECT, INSERT, DELETE ON public.chat_message_reads TO authenticated;
GRANT ALL ON public.chat_message_reads TO service_role;

ALTER TABLE public.chat_message_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can see reads in their rooms" ON public.chat_message_reads;
CREATE POLICY "Members can see reads in their rooms"
  ON public.chat_message_reads FOR SELECT TO authenticated
  USING (public.is_chat_room_member(room_id, auth.uid()));

DROP POLICY IF EXISTS "Users mark their own reads" ON public.chat_message_reads;
CREATE POLICY "Users mark their own reads"
  ON public.chat_message_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_chat_room_member(room_id, auth.uid()));

DROP POLICY IF EXISTS "Users remove their own reads" ON public.chat_message_reads;
CREATE POLICY "Users remove their own reads"
  ON public.chat_message_reads FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Chat rooms: avatar + description
ALTER TABLE public.chat_rooms
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS description text;

-- Room members: is_admin
ALTER TABLE public.chat_room_members
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

UPDATE public.chat_room_members m
   SET is_admin = true
  FROM public.chat_rooms r
 WHERE m.room_id = r.id
   AND (r.created_by = m.user_id OR m.role = 'owner')
   AND m.is_admin = false;

-- User UI preferences: chat_wallpaper (jsonb)
ALTER TABLE public.user_ui_preferences
  ADD COLUMN IF NOT EXISTS chat_wallpaper jsonb NOT NULL DEFAULT '{}'::jsonb;

-- User notification preferences: chat_push_enabled
ALTER TABLE public.user_notification_preferences
  ADD COLUMN IF NOT EXISTS chat_push_enabled boolean NOT NULL DEFAULT true;

-- Storage policies (buckets created via storage tools)
DROP POLICY IF EXISTS "Room members read voice notes" ON storage.objects;
CREATE POLICY "Room members read voice notes"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-voice-notes'
    AND public.is_chat_room_member(
      NULLIF(split_part(name, '/', 1), '')::uuid,
      auth.uid()
    )
  );

DROP POLICY IF EXISTS "Room members upload voice notes" ON storage.objects;
CREATE POLICY "Room members upload voice notes"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-voice-notes'
    AND public.is_chat_room_member(
      NULLIF(split_part(name, '/', 1), '')::uuid,
      auth.uid()
    )
  );

DROP POLICY IF EXISTS "Room members read avatars" ON storage.objects;
CREATE POLICY "Room members read avatars"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-room-avatars'
    AND public.is_chat_room_member(
      NULLIF(split_part(name, '/', 1), '')::uuid,
      auth.uid()
    )
  );

DROP POLICY IF EXISTS "Room admins upload avatars" ON storage.objects;
CREATE POLICY "Room admins upload avatars"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-room-avatars'
    AND EXISTS (
      SELECT 1 FROM public.chat_room_members m
      WHERE m.user_id = auth.uid()
        AND m.is_admin = true
        AND m.room_id::text = split_part(name, '/', 1)
    )
  );

DROP POLICY IF EXISTS "Room admins update avatars" ON storage.objects;
CREATE POLICY "Room admins update avatars"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'chat-room-avatars'
    AND EXISTS (
      SELECT 1 FROM public.chat_room_members m
      WHERE m.user_id = auth.uid()
        AND m.is_admin = true
        AND m.room_id::text = split_part(name, '/', 1)
    )
  );

-- Enable realtime for read receipts
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_message_reads;
