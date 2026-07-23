ALTER TABLE public.user_ui_preferences
  ADD COLUMN IF NOT EXISTS chat_room_scroll jsonb NOT NULL DEFAULT '{}'::jsonb;