
-- Tighten notifications INSERT: any company member could previously target any user_id or recipient_role.
DROP POLICY IF EXISTS "company members create notifications" ON public.notifications;
CREATE POLICY "notifications insert scoped"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  is_admin()
  OR (user_id = auth.uid())
  OR (user_id IS NULL AND recipient_role IS NOT NULL AND is_company_member())
);

-- Prevent distributors from modifying sensitive columns (email, commission, active flag, etc.) on their own row.
CREATE OR REPLACE FUNCTION public.prevent_distributor_sensitive_self_edit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Company members / admins bypass this restriction.
  IF is_company_member() THEN
    RETURN NEW;
  END IF;

  -- Distributor editing their own row: block changes to sensitive fields.
  IF NEW.user_id = auth.uid() THEN
    IF NEW.email IS DISTINCT FROM OLD.email
       OR NEW.commission_percent IS DISTINCT FROM OLD.commission_percent
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
      RAISE EXCEPTION 'Distributors cannot modify email, commission, or activation status';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_distributor_sensitive_self_edit ON public.distributors;
CREATE TRIGGER trg_prevent_distributor_sensitive_self_edit
BEFORE UPDATE ON public.distributors
FOR EACH ROW
EXECUTE FUNCTION public.prevent_distributor_sensitive_self_edit();
