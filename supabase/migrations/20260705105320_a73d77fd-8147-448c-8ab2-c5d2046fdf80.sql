INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'task_manager'::app_role
FROM auth.users u
WHERE u.email IN ('e.hesham@steinheim-eg.com','f.hesham@steinheim-eg.com')
ON CONFLICT (user_id, role) DO NOTHING;