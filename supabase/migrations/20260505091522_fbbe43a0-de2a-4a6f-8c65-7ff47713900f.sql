-- 1. Add new roles to enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'cashier';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'call_center';

-- 2. Helper: is_admin()
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
$$;

-- 3. Helper: get_my_role() — returns highest-priority role
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role::text FROM public.user_roles
  WHERE user_id = auth.uid()
  ORDER BY CASE role::text
    WHEN 'admin' THEN 1
    WHEN 'manager' THEN 2
    WHEN 'cashier' THEN 3
    WHEN 'call_center' THEN 4
    ELSE 5 END
  LIMIT 1
$$;

-- 4. Hardcoded super-admin email check
CREATE OR REPLACE FUNCTION public.is_super_admin_email(_email text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT lower(_email) = 'eslam.kora60@gmail.com'
$$;

-- 5. Trigger: auto-assign admin role on signup if super admin email
CREATE OR REPLACE FUNCTION public.assign_admin_on_signup()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.is_super_admin_email(NEW.email) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_assign_admin ON auth.users;
CREATE TRIGGER on_auth_user_created_assign_admin
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.assign_admin_on_signup();

-- 6. Backfill: assign admin to existing super admin user
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users
WHERE lower(email) = 'eslam.kora60@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- 7. RLS: admins can manage all user_roles
DROP POLICY IF EXISTS "admins manage all roles" ON public.user_roles;
CREATE POLICY "admins manage all roles" ON public.user_roles
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 8. RLS: admins view all profiles (for admin panel listing)
DROP POLICY IF EXISTS "admins view all profiles" ON public.profiles;
CREATE POLICY "admins view all profiles" ON public.profiles
FOR SELECT TO authenticated
USING (public.is_admin());