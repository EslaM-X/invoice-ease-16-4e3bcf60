
-- Helper: check if the current user is a member of a chat room
CREATE OR REPLACE FUNCTION public.is_chat_room_member(_room_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_room_members
    WHERE room_id = _room_id AND user_id = auth.uid()
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_chat_room_member(uuid) TO authenticated;

-- 1) chat_calls
CREATE TABLE public.chat_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  initiator_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('audio','video')),
  scope text NOT NULL CHECK (scope IN ('dm','group')),
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','active','ended','missed','declined','failed','cancelled')),
  livekit_room text NOT NULL UNIQUE,
  started_at timestamptz NOT NULL DEFAULT now(),
  connected_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_calls_room_id_idx ON public.chat_calls(room_id, started_at DESC);
CREATE INDEX chat_calls_status_idx ON public.chat_calls(status) WHERE status IN ('ringing','active');

GRANT SELECT, INSERT, UPDATE ON public.chat_calls TO authenticated;
GRANT ALL ON public.chat_calls TO service_role;

ALTER TABLE public.chat_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Room members can view calls"
  ON public.chat_calls FOR SELECT TO authenticated
  USING (public.is_chat_room_member(room_id));

CREATE POLICY "Room members can start calls"
  ON public.chat_calls FOR INSERT TO authenticated
  WITH CHECK (initiator_id = auth.uid() AND public.is_chat_room_member(room_id));

CREATE POLICY "Room members can update calls"
  ON public.chat_calls FOR UPDATE TO authenticated
  USING (public.is_chat_room_member(room_id))
  WITH CHECK (public.is_chat_room_member(room_id));

-- 2) chat_call_participants
CREATE TABLE public.chat_call_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.chat_calls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  join_status text NOT NULL DEFAULT 'invited' CHECK (join_status IN ('invited','joined','declined','missed','left')),
  joined_at timestamptz,
  left_at timestamptz,
  leave_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (call_id, user_id)
);

CREATE INDEX chat_call_participants_call_idx ON public.chat_call_participants(call_id);
CREATE INDEX chat_call_participants_user_idx ON public.chat_call_participants(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.chat_call_participants TO authenticated;
GRANT ALL ON public.chat_call_participants TO service_role;

ALTER TABLE public.chat_call_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Room members can view call participants"
  ON public.chat_call_participants FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.chat_calls c
    WHERE c.id = call_id AND public.is_chat_room_member(c.room_id)
  ));

CREATE POLICY "Room members can insert participants"
  ON public.chat_call_participants FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.chat_calls c
    WHERE c.id = call_id AND public.is_chat_room_member(c.room_id)
  ));

CREATE POLICY "Users can update their own participant row"
  ON public.chat_call_participants FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 3) updated_at triggers
CREATE OR REPLACE FUNCTION public.tg_chat_calls_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER chat_calls_touch BEFORE UPDATE ON public.chat_calls
  FOR EACH ROW EXECUTE FUNCTION public.tg_chat_calls_touch();
CREATE TRIGGER chat_call_participants_touch BEFORE UPDATE ON public.chat_call_participants
  FOR EACH ROW EXECUTE FUNCTION public.tg_chat_calls_touch();

-- 4) Extend chat_messages with a call_id link
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS call_id uuid REFERENCES public.chat_calls(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS chat_messages_call_id_idx ON public.chat_messages(call_id) WHERE call_id IS NOT NULL;

-- 5) Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_call_participants;
