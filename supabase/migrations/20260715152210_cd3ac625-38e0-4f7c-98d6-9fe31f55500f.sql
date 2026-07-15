
-- Access Studio: per-user UI preferences + super-admin gate

-- 1) Super-admin function (email allowlist)
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = _user_id
      AND lower(u.email) IN ('e.hesham@steinheim-eg.com', 'k.elsharbatly@steinheim-eg.com')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;

-- 2) UI preferences table
CREATE TABLE IF NOT EXISTS public.user_ui_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nav_hidden jsonb NOT NULL DEFAULT '[]'::jsonb,          -- string[] of nav keys hidden
  nav_order jsonb NOT NULL DEFAULT '[]'::jsonb,           -- string[] ordered top-level nav keys
  cards_hidden jsonb NOT NULL DEFAULT '[]'::jsonb,        -- string[] of dashboard card keys hidden
  cards_order jsonb NOT NULL DEFAULT '[]'::jsonb,         -- string[] ordered card keys
  mobile_tabs jsonb NOT NULL DEFAULT '[]'::jsonb,         -- optional string[] override for mobile tab bar
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ui_preferences TO authenticated;
GRANT ALL ON public.user_ui_preferences TO service_role;

ALTER TABLE public.user_ui_preferences ENABLE ROW LEVEL SECURITY;

-- Anyone signed in can read their OWN prefs
CREATE POLICY ui_prefs_self_read ON public.user_ui_preferences
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_super_admin(auth.uid()));

-- Only super admins can INSERT / UPDATE / DELETE prefs (for any user)
CREATE POLICY ui_prefs_super_write ON public.user_ui_preferences
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY ui_prefs_super_update ON public.user_ui_preferences
  FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY ui_prefs_super_delete ON public.user_ui_preferences
  FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_ui_preferences;

-- Update trigger
CREATE OR REPLACE FUNCTION public.tg_ui_prefs_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = COALESCE(NEW.updated_by, auth.uid());
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ui_prefs_touch
  BEFORE INSERT OR UPDATE ON public.user_ui_preferences
  FOR EACH ROW EXECUTE FUNCTION public.tg_ui_prefs_touch();
