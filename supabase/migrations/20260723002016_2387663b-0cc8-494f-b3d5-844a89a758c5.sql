
-- 1) Keep is_admin in sync with role (admin/owner => true)
CREATE OR REPLACE FUNCTION public.chat_room_members_sync_is_admin()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.is_admin := (NEW.role IN ('admin','owner'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_room_members_sync_is_admin ON public.chat_room_members;
CREATE TRIGGER trg_chat_room_members_sync_is_admin
BEFORE INSERT OR UPDATE OF role ON public.chat_room_members
FOR EACH ROW EXECUTE FUNCTION public.chat_room_members_sync_is_admin();

-- Backfill
UPDATE public.chat_room_members
   SET is_admin = (role IN ('admin','owner'))
 WHERE is_admin IS DISTINCT FROM (role IN ('admin','owner'));

-- 2) RPC to rename / set avatar of a chat room (creator or admin only)
CREATE OR REPLACE FUNCTION public.chat_update_room_profile(
  _room_id uuid,
  _name text DEFAULT NULL,
  _avatar_url text DEFAULT NULL,
  _clear_avatar boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _allowed boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.chat_rooms r
    WHERE r.id = _room_id
      AND (
        r.created_by = _uid
        OR EXISTS (
          SELECT 1 FROM public.chat_room_members m
          WHERE m.room_id = _room_id AND m.user_id = _uid AND m.role IN ('admin','owner')
        )
      )
  ) INTO _allowed;

  IF NOT _allowed THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.chat_rooms
     SET name       = COALESCE(NULLIF(_name, ''), name),
         avatar_url = CASE WHEN _clear_avatar THEN NULL
                           WHEN _avatar_url IS NOT NULL THEN _avatar_url
                           ELSE avatar_url END,
         updated_at = now()
   WHERE id = _room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.chat_update_room_profile(uuid, text, text, boolean) TO authenticated;
