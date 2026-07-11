DO $$ BEGIN
  CREATE POLICY "Avatars are publicly readable"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can upload their own avatar"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update their own avatar"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete their own avatar"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_type TEXT; v_name TEXT; v_avatar TEXT;
BEGIN
  v_type := NULLIF(NEW.raw_user_meta_data->>'account_type', '');
  IF v_type IS NOT NULL AND v_type NOT IN ('employee','distributor') THEN v_type := NULL; END IF;
  v_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1));
  v_avatar := COALESCE(NULLIF(NEW.raw_user_meta_data->>'avatar_url',''), NULLIF(NEW.raw_user_meta_data->>'picture',''));

  INSERT INTO public.profiles (user_id, email, display_name, avatar_url, account_type, approval_status)
  VALUES (NEW.id, NEW.email, v_name, v_avatar, v_type, 'pending')
  ON CONFLICT (user_id) DO UPDATE
    SET avatar_url = COALESCE(public.profiles.avatar_url, EXCLUDED.avatar_url);

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