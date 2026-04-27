CREATE OR REPLACE FUNCTION public.is_allowed_company_email(_email text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT lower(_email) IN (
    'cfo@steinheim-eg.com',
    'e.hesham@steinheim-eg.com',
    'k.elsharbatly@steinheim-eg.com',
    'f.hesham@steinheim-eg.com'
  )
$function$;

INSERT INTO public.company_members (user_id, email)
SELECT id, email FROM auth.users
WHERE lower(email) = 'f.hesham@steinheim-eg.com'
ON CONFLICT (user_id) DO NOTHING;