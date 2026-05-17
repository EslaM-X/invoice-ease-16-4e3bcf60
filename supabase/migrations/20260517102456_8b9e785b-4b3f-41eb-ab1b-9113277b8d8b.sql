-- Auto-update chat_rooms.last_message_at + last_message_preview on new chat_messages
CREATE OR REPLACE FUNCTION public.touch_chat_room_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  preview text;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  preview := CASE
    WHEN NEW.message_type = 'text' THEN left(coalesce(NEW.body, ''), 120)
    WHEN NEW.message_type = 'image' THEN '📷 ' || coalesce(NEW.body, 'صورة')
    WHEN NEW.message_type = 'voice' THEN '🎙️ ملاحظة صوتية'
    WHEN NEW.message_type = 'file' THEN '📎 ملف'
    ELSE coalesce(NEW.body, '')
  END;
  UPDATE public.chat_rooms
  SET last_message_at = NEW.created_at,
      last_message_preview = preview,
      updated_at = now()
  WHERE id = NEW.room_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_messages_touch_room ON public.chat_messages;
CREATE TRIGGER trg_chat_messages_touch_room
AFTER INSERT ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.touch_chat_room_on_message();