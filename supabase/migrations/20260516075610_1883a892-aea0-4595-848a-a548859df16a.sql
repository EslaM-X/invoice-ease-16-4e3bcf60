
-- Smart calendar + notifications for X Assistant
CREATE TABLE IF NOT EXISTS public.x_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  company_id UUID NULL,
  title TEXT NOT NULL,
  notes TEXT,
  kind TEXT NOT NULL DEFAULT 'event', -- event | shipment | reminder | milestone
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  all_day BOOLEAN NOT NULL DEFAULT false,
  remind_before_minutes INTEGER[] NOT NULL DEFAULT ARRAY[60, 1440], -- 1h + 1day before
  location TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_x_cal_user_starts ON public.x_calendar_events (user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_x_cal_company_starts ON public.x_calendar_events (company_id, starts_at);

ALTER TABLE public.x_calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own calendar events"
ON public.x_calendar_events
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_x_cal_updated
BEFORE UPDATE ON public.x_calendar_events
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Notifications queue (in-app)
CREATE TABLE IF NOT EXISTS public.x_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  event_id UUID REFERENCES public.x_calendar_events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  kind TEXT NOT NULL DEFAULT 'reminder',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_x_notif_user_unread ON public.x_notifications (user_id, read_at, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_x_notif_event ON public.x_notifications (event_id);

ALTER TABLE public.x_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own notifications"
ON public.x_notifications FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "users update own notifications"
ON public.x_notifications FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "users insert own notifications"
ON public.x_notifications FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users delete own notifications"
ON public.x_notifications FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- Auto-create reminder notifications when an event is inserted/updated
CREATE OR REPLACE FUNCTION public.x_sync_event_reminders()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m INTEGER;
BEGIN
  -- Remove future undelivered reminders for this event
  DELETE FROM public.x_notifications
  WHERE event_id = NEW.id
    AND delivered_at IS NULL;

  -- Recreate them
  IF NEW.remind_before_minutes IS NOT NULL THEN
    FOREACH m IN ARRAY NEW.remind_before_minutes LOOP
      INSERT INTO public.x_notifications (user_id, event_id, title, body, scheduled_for, kind)
      VALUES (
        NEW.user_id,
        NEW.id,
        NEW.title,
        COALESCE(NEW.notes, ''),
        NEW.starts_at - make_interval(mins => m),
        'reminder'
      );
    END LOOP;
  END IF;

  -- Also at exact start time
  INSERT INTO public.x_notifications (user_id, event_id, title, body, scheduled_for, kind)
  VALUES (NEW.user_id, NEW.id, NEW.title, COALESCE(NEW.notes, ''), NEW.starts_at, 'start');

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_x_cal_sync_reminders
AFTER INSERT OR UPDATE OF starts_at, remind_before_minutes, title, notes ON public.x_calendar_events
FOR EACH ROW EXECUTE FUNCTION public.x_sync_event_reminders();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.x_notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.x_calendar_events;
