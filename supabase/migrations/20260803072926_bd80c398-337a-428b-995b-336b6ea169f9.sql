-- 1. delivery_match_log: scope reads to company members
DROP POLICY IF EXISTS "auth can read delivery match log" ON public.delivery_match_log;
CREATE POLICY "company members read delivery match log"
ON public.delivery_match_log FOR SELECT TO authenticated
USING (public.is_company_member());

-- 2. leadership_card_viewers: scope reads to company members
DROP POLICY IF EXISTS "Authenticated can read leadership viewers" ON public.leadership_card_viewers;
CREATE POLICY "Company members read leadership viewers"
ON public.leadership_card_viewers FOR SELECT TO authenticated
USING (public.is_company_member() OR public.is_admin());

-- 3. system_flags: scope reads to company members
DROP POLICY IF EXISTS "system_flags_read_all" ON public.system_flags;
CREATE POLICY "system_flags_read_company"
ON public.system_flags FOR SELECT TO authenticated
USING (public.is_company_member() OR public.has_role(auth.uid(), 'admin'::app_role));

-- 4. chat_room_members: block self-granting room admin
DROP POLICY IF EXISTS "creator or admin adds members" ON public.chat_room_members;
CREATE POLICY "creator or admin adds members"
ON public.chat_room_members FOR INSERT TO authenticated
WITH CHECK (
  public.is_company_member()
  AND (
    (user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.chat_rooms r WHERE r.id = chat_room_members.room_id AND r.created_by = auth.uid())
    OR public.is_admin()
  )
  AND (
    COALESCE(is_admin, false) = false
    OR EXISTS (SELECT 1 FROM public.chat_rooms r WHERE r.id = chat_room_members.room_id AND r.created_by = auth.uid())
    OR public.chat_is_room_admin(room_id, auth.uid())
    OR public.is_admin()
  )
);

-- also prevent escalating is_admin via UPDATE by a non-admin member
DROP POLICY IF EXISTS "members update own membership" ON public.chat_room_members;
CREATE POLICY "members update own membership"
ON public.chat_room_members FOR UPDATE TO authenticated
USING (
  (user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.chat_rooms r WHERE r.id = chat_room_members.room_id AND r.created_by = auth.uid())
  OR public.is_admin()
)
WITH CHECK (
  COALESCE(is_admin, false) = false
  OR EXISTS (SELECT 1 FROM public.chat_rooms r WHERE r.id = chat_room_members.room_id AND r.created_by = auth.uid())
  OR public.chat_is_room_admin(room_id, auth.uid())
  OR public.is_admin()
);