
-- 1. Roles on room members
ALTER TABLE public.chat_room_members
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member'
  CHECK (role IN ('admin','member'));

-- 2. Room wallpaper (admin-set, applies to all members unless they override)
ALTER TABLE public.chat_rooms
  ADD COLUMN IF NOT EXISTS wallpaper jsonb;

-- 3. Backfill: creator of each room becomes admin
UPDATE public.chat_room_members m
SET role = 'admin'
FROM public.chat_rooms r
WHERE m.room_id = r.id AND m.user_id = r.created_by AND m.role <> 'admin';

-- 4. Ensure e.hesham@steinheim-eg.com is admin on every existing group room
DO $$
DECLARE
  eslam uuid;
BEGIN
  SELECT user_id INTO eslam FROM public.profiles WHERE lower(email) = 'e.hesham@steinheim-eg.com' LIMIT 1;
  IF eslam IS NOT NULL THEN
    INSERT INTO public.chat_room_members (room_id, user_id, role, joined_at)
    SELECT r.id, eslam, 'admin', now()
    FROM public.chat_rooms r
    WHERE (r.type = 'group' OR r.type = 'channel')
      AND NOT EXISTS (
        SELECT 1 FROM public.chat_room_members m
        WHERE m.room_id = r.id AND m.user_id = eslam
      );

    UPDATE public.chat_room_members
    SET role = 'admin'
    WHERE user_id = eslam AND role <> 'admin';
  END IF;
END $$;

-- 5. Trigger: whenever a new group/channel room is created, auto-add Eslam as admin
CREATE OR REPLACE FUNCTION public.chat_rooms_autojoin_eslam()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  eslam uuid;
BEGIN
  IF NEW.type IN ('group','channel') THEN
    SELECT user_id INTO eslam FROM public.profiles WHERE lower(email) = 'e.hesham@steinheim-eg.com' LIMIT 1;
    IF eslam IS NOT NULL AND eslam <> NEW.created_by THEN
      INSERT INTO public.chat_room_members (room_id, user_id, role, joined_at)
      VALUES (NEW.id, eslam, 'admin', now())
      ON CONFLICT (room_id, user_id) DO UPDATE SET role = 'admin';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_chat_rooms_autojoin_eslam ON public.chat_rooms;
CREATE TRIGGER trg_chat_rooms_autojoin_eslam
  AFTER INSERT ON public.chat_rooms
  FOR EACH ROW EXECUTE FUNCTION public.chat_rooms_autojoin_eslam();

-- 6. Admin-only RPCs for member management + room wallpaper
CREATE OR REPLACE FUNCTION public.chat_is_room_admin(_room_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_room_members
    WHERE room_id = _room_id AND user_id = _user_id AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.chat_is_room_admin(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_set_member_role(_room_id uuid, _target_user uuid, _role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _role NOT IN ('admin','member') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  IF NOT public.chat_is_room_admin(_room_id, auth.uid()) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  UPDATE public.chat_room_members SET role = _role
  WHERE room_id = _room_id AND user_id = _target_user;
END $$;
GRANT EXECUTE ON FUNCTION public.chat_set_member_role(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_remove_member(_room_id uuid, _target_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  eslam uuid;
BEGIN
  IF NOT public.chat_is_room_admin(_room_id, auth.uid()) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  SELECT user_id INTO eslam FROM public.profiles WHERE lower(email) = 'e.hesham@steinheim-eg.com' LIMIT 1;
  IF _target_user = eslam THEN RAISE EXCEPTION 'cannot_remove_super_admin'; END IF;
  DELETE FROM public.chat_room_members WHERE room_id = _room_id AND user_id = _target_user;
END $$;
GRANT EXECUTE ON FUNCTION public.chat_remove_member(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_set_room_wallpaper(_room_id uuid, _wallpaper jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.chat_is_room_admin(_room_id, auth.uid()) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  UPDATE public.chat_rooms SET wallpaper = _wallpaper WHERE id = _room_id;
END $$;
GRANT EXECUTE ON FUNCTION public.chat_set_room_wallpaper(uuid,jsonb) TO authenticated;
