-- Scan sessions: link a desktop invoice editor to a mobile scanner
CREATE TABLE public.scan_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  pair_code text NOT NULL,
  mode text NOT NULL DEFAULT 'new', -- 'new' | 'edit'
  invoice_id uuid,
  status text NOT NULL DEFAULT 'waiting', -- 'waiting' | 'paired' | 'closed'
  paired_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scan_sessions_user ON public.scan_sessions(user_id, status);
CREATE INDEX idx_scan_sessions_pair_code ON public.scan_sessions(pair_code) WHERE status <> 'closed';

ALTER TABLE public.scan_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own scan sessions select" ON public.scan_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own scan sessions insert" ON public.scan_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own scan sessions update" ON public.scan_sessions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own scan sessions delete" ON public.scan_sessions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_scan_sessions_updated_at
  BEFORE UPDATE ON public.scan_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Scan events: each scan from mobile becomes an event consumed by desktop
CREATE TABLE public.scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.scan_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  product_id uuid,
  product_name text NOT NULL,
  serial_number text,
  color text,
  unit_price numeric NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending', -- 'pending' | 'applied' | 'failed'
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scan_events_session ON public.scan_events(session_id, created_at);

ALTER TABLE public.scan_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own scan events select" ON public.scan_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own scan events insert" ON public.scan_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own scan events update" ON public.scan_events
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own scan events delete" ON public.scan_events
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.scan_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.scan_events;
ALTER TABLE public.scan_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.scan_events REPLICA IDENTITY FULL;

-- Pair a mobile device to a session by 6-digit code (validates same user)
CREATE OR REPLACE FUNCTION public.pair_scan_session(_pair_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;

  SELECT id INTO v_session_id
  FROM public.scan_sessions
  WHERE pair_code = _pair_code
    AND user_id = v_uid
    AND status <> 'closed'
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_OR_EXPIRED_CODE' USING ERRCODE = '22023';
  END IF;

  UPDATE public.scan_sessions
  SET status = 'paired', paired_at = COALESCE(paired_at, now()), updated_at = now()
  WHERE id = v_session_id;

  RETURN v_session_id;
END;
$$;