
-- 1) handle_new_user: auto-create distributors row from metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_type TEXT; v_name TEXT;
BEGIN
  v_type := NULLIF(NEW.raw_user_meta_data->>'account_type', '');
  IF v_type IS NOT NULL AND v_type NOT IN ('employee','distributor') THEN v_type := NULL; END IF;
  v_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1));

  INSERT INTO public.profiles (user_id, email, display_name, account_type, approval_status)
  VALUES (NEW.id, NEW.email, v_name, v_type, 'pending')
  ON CONFLICT (user_id) DO NOTHING;

  IF v_type = 'distributor' THEN
    INSERT INTO public.distributors (
      user_id, name, showroom_name, location, city, address, phone, email, branches_count, notes, is_active
    ) VALUES (
      NEW.id, v_name,
      NULLIF(NEW.raw_user_meta_data->>'showroom_name',''),
      NULLIF(NEW.raw_user_meta_data->>'location',''),
      NULLIF(NEW.raw_user_meta_data->>'city',''),
      NULLIF(NEW.raw_user_meta_data->>'address',''),
      NULLIF(NEW.raw_user_meta_data->>'phone',''),
      NEW.email,
      COALESCE(NULLIF(NEW.raw_user_meta_data->>'branches_count','')::int, 1),
      NULLIF(NEW.raw_user_meta_data->>'notes',''),
      false
    ) ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.notifications (type, title, body, recipient_role, meta)
  VALUES ('account_pending_approval','طلب حساب جديد بانتظار الموافقة',
    COALESCE(NEW.email,'') || ' — ' || COALESCE(v_type,'لم يحدد'),
    'admin', jsonb_build_object('user_id', NEW.id, 'email', NEW.email, 'account_type', v_type));
  RETURN NEW;
END; $function$;

-- 2) approve / reject RPCs
CREATE OR REPLACE FUNCTION public.approve_user_account(_user_id uuid, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only admins can approve accounts'; END IF;
  UPDATE public.profiles SET approval_status='approved', approval_notes=_notes,
    approved_by=auth.uid(), approved_at=now() WHERE user_id=_user_id;
  UPDATE public.distributors SET is_active=true WHERE user_id=_user_id;
END; $$;

CREATE OR REPLACE FUNCTION public.reject_user_account(_user_id uuid, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only admins can reject accounts'; END IF;
  UPDATE public.profiles SET approval_status='rejected', approval_notes=_notes,
    approved_by=auth.uid(), approved_at=now() WHERE user_id=_user_id;
  UPDATE public.distributors SET is_active=false WHERE user_id=_user_id;
END; $$;

REVOKE ALL ON FUNCTION public.approve_user_account(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_user_account(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_user_account(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_user_account(uuid,text) TO authenticated;

-- 3) Seed test distributor account (bypass approval-self-edit trigger for seed only)
DO $$
DECLARE
  v_uid uuid := 'a0000000-0000-4000-8000-000000000d01';
  v_email text := 'test.distributor@steinheim.test';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid) THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      v_email, crypt('Test1234!', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'full_name','الموزع التجريبي',
        'account_type','distributor',
        'showroom_name','معرض شتاينهايم — التجريبي',
        'location','مدينة نصر','city','القاهرة',
        'phone','+201000000000','branches_count','2','address','شارع التجارب 1'),
      now(), now(), '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
      'email', v_uid::text, now(), now(), now());
  END IF;

  ALTER TABLE public.profiles DISABLE TRIGGER prevent_profile_approval_self_edit;
  INSERT INTO public.profiles (user_id, email, display_name, account_type, approval_status, approved_at)
  VALUES (v_uid, v_email, 'الموزع التجريبي', 'distributor', 'approved', now())
  ON CONFLICT (user_id) DO UPDATE
    SET approval_status='approved', account_type='distributor',
        approved_at=COALESCE(public.profiles.approved_at, now());
  ALTER TABLE public.profiles ENABLE TRIGGER prevent_profile_approval_self_edit;

  INSERT INTO public.distributors (user_id, name, showroom_name, location, city, address, phone, email, branches_count, is_active)
  VALUES (v_uid, 'الموزع التجريبي', 'معرض شتاينهايم — التجريبي', 'مدينة نصر', 'القاهرة', 'شارع التجارب 1', '+201000000000', v_email, 2, true)
  ON CONFLICT DO NOTHING;
END $$;
