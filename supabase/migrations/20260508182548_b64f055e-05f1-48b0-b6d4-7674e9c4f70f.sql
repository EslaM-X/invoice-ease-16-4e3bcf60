
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  device_label text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX idx_push_subscriptions_user ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users select own push subs" ON public.push_subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "users insert own push subs" ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users update own push subs" ON public.push_subscriptions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users delete own push subs" ON public.push_subscriptions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
