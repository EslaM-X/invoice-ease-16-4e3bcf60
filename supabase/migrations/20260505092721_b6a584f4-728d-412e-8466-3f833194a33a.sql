
-- Update super admin email check to include the company admin emails
CREATE OR REPLACE FUNCTION public.is_super_admin_email(_email text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(_email) IN (
    'eslam.kora60@gmail.com',
    'e.hesham@steinheim-eg.com',
    'cfo@steinheim-eg.com'
  )
$$;

-- Assign admin role to existing accounts matching super admin emails
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::app_role
FROM auth.users u
WHERE public.is_super_admin_email(u.email)
ON CONFLICT (user_id, role) DO NOTHING;
