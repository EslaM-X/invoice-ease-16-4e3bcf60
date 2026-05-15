
-- Preferences per user
CREATE TABLE public.user_notification_preferences (
  user_id UUID PRIMARY KEY,
  push_enabled BOOLEAN NOT NULL DEFAULT true,
  sound TEXT NOT NULL DEFAULT 'default',
  vibration TEXT NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users select own notif prefs" ON public.user_notification_preferences
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users insert own notif prefs" ON public.user_notification_preferences
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own notif prefs" ON public.user_notification_preferences
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_unp_updated_at BEFORE UPDATE ON public.user_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Dispatch config (URL + HMAC secret), service-role only
CREATE TABLE public.notification_dispatch_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  dispatch_url TEXT NOT NULL,
  hmac_secret TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_dispatch_config ENABLE ROW LEVEL SECURITY;
-- no policies => only service_role bypass

INSERT INTO public.notification_dispatch_config (id, dispatch_url, hmac_secret)
VALUES (
  1,
  'https://invoice-ease-16.lovable.app/api/public/push-dispatch',
  '7f318309ef5dc64e35d6632039231ace909b8757b844428481001a96f38db38a'
);

-- Trigger function: on new notification, async POST to dispatch URL
CREATE OR REPLACE FUNCTION public.dispatch_push_for_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  cfg RECORD;
  payload JSONB;
  sig TEXT;
BEGIN
  SELECT dispatch_url, hmac_secret INTO cfg
  FROM public.notification_dispatch_config WHERE id = 1;
  IF cfg IS NULL THEN RETURN NEW; END IF;

  payload := jsonb_build_object('notification_id', NEW.id);
  sig := encode(extensions.hmac(payload::text::bytea, cfg.hmac_secret::bytea, 'sha256'), 'hex');

  PERFORM net.http_post(
    url := cfg.dispatch_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-signature', sig
    ),
    body := payload
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- never block the insert
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notifications_dispatch_push
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.dispatch_push_for_notification();
