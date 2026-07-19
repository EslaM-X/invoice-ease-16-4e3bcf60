
-- Restrict updates to profiles.hide_from_leadership_card so only the COO
-- (e.hesham@steinheim-eg.com) can toggle his own flag. Admins and service
-- role are unaffected. Any other user attempting to change this column on
-- any row (their own or someone else's) gets an exception.
CREATE OR REPLACE FUNCTION public.prevent_hide_from_leadership_card_edit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email text;
  is_admin_user boolean := false;
BEGIN
  -- No change → nothing to enforce.
  IF NEW.hide_from_leadership_card IS NOT DISTINCT FROM OLD.hide_from_leadership_card THEN
    RETURN NEW;
  END IF;

  -- Service role / no auth context (server jobs) → allow.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admins bypass.
  BEGIN
    is_admin_user := public.is_admin(auth.uid());
  EXCEPTION WHEN OTHERS THEN
    is_admin_user := false;
  END;
  IF is_admin_user THEN
    RETURN NEW;
  END IF;

  -- Only the COO himself may toggle his own row.
  SELECT lower(email) INTO caller_email FROM auth.users WHERE id = auth.uid();
  IF caller_email = 'e.hesham@steinheim-eg.com' AND NEW.user_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Not allowed to modify hide_from_leadership_card'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS prevent_hide_from_leadership_card_edit ON public.profiles;
CREATE TRIGGER prevent_hide_from_leadership_card_edit
  BEFORE UPDATE OF hide_from_leadership_card ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_hide_from_leadership_card_edit();
