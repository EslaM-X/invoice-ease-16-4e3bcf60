
-- Tighten biometric_auth_log INSERTs: force email to caller's profile email and user_id to auth.uid()
CREATE OR REPLACE FUNCTION public.enforce_biometric_auth_log_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  NEW.user_id := auth.uid();
  SELECT email INTO v_email FROM public.profiles WHERE id = auth.uid();
  IF v_email IS NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  END IF;
  NEW.email := v_email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_biometric_auth_log_actor_trg ON public.biometric_auth_log;
CREATE TRIGGER enforce_biometric_auth_log_actor_trg
BEFORE INSERT ON public.biometric_auth_log
FOR EACH ROW EXECUTE FUNCTION public.enforce_biometric_auth_log_actor();

DROP POLICY IF EXISTS "authenticated insert biometric attempts" ON public.biometric_auth_log;
CREATE POLICY "authenticated insert biometric attempts"
ON public.biometric_auth_log
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Tighten x_activity_log INSERTs: derive actor_name and actor_job_title from profile
CREATE OR REPLACE FUNCTION public.enforce_x_activity_log_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_job text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  NEW.actor_user_id := auth.uid();
  SELECT display_name, job_title INTO v_name, v_job FROM public.profiles WHERE id = auth.uid();
  NEW.actor_name := COALESCE(v_name, NEW.actor_name);
  NEW.actor_job_title := COALESCE(v_job, NEW.actor_job_title);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_x_activity_log_actor_trg ON public.x_activity_log;
CREATE TRIGGER enforce_x_activity_log_actor_trg
BEFORE INSERT ON public.x_activity_log
FOR EACH ROW EXECUTE FUNCTION public.enforce_x_activity_log_actor();
