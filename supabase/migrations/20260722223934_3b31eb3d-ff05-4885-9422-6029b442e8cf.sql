ALTER TABLE public.chat_presence ADD COLUMN IF NOT EXISTS typing_room_id uuid;
ALTER TABLE public.chat_presence ADD COLUMN IF NOT EXISTS typing_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_chat_presence_typing_room ON public.chat_presence(typing_room_id) WHERE typing_room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_reactions_message ON public.chat_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created ON public.chat_messages(room_id, created_at DESC);