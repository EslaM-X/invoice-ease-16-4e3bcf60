
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS hide_job_title boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.prevent_hide_job_title_edit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email text;
  is_admin_user boolean := false;
BEGIN
  IF NEW.hide_job_title IS NOT DISTINCT FROM OLD.hide_job_title THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    is_admin_user := public.is_admin(auth.uid());
  EXCEPTION WHEN OTHERS THEN
    is_admin_user := false;
  END;
  IF is_admin_user THEN
    RETURN NEW;
  END IF;
  -- Only allow a user to toggle the flag on their own profile row.
  IF NEW.user_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Not allowed to modify hide_job_title'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS prevent_hide_job_title_edit ON public.profiles;
CREATE TRIGGER prevent_hide_job_title_edit
  BEFORE UPDATE OF hide_job_title ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_hide_job_title_edit();
