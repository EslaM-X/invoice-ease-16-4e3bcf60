
CREATE TABLE public.leadership_card_viewers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.leadership_card_viewers TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.leadership_card_viewers TO authenticated;
GRANT ALL ON public.leadership_card_viewers TO service_role;

ALTER TABLE public.leadership_card_viewers ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read the list (so the card can check its own viewer)
CREATE POLICY "Authenticated can read leadership viewers"
  ON public.leadership_card_viewers FOR SELECT TO authenticated USING (true);

-- Only admins can add / update / remove viewers
CREATE POLICY "Admins insert leadership viewers"
  ON public.leadership_card_viewers FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "Admins update leadership viewers"
  ON public.leadership_card_viewers FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins delete leadership viewers"
  ON public.leadership_card_viewers FOR DELETE TO authenticated
  USING (public.is_admin());

CREATE TRIGGER trg_leadership_card_viewers_updated_at
  BEFORE UPDATE ON public.leadership_card_viewers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed with the currently hard-coded ALLOWED_VIEWERS
INSERT INTO public.leadership_card_viewers (email, note) VALUES
  ('esraa@steinheim-eg.com',    'Seed: initial viewer'),
  ('f.hesham@steinheim-eg.com', 'Seed: initial viewer'),
  ('cfo@steinheim-eg.com',      'Seed: CFO'),
  ('e.hesham@steinheim-eg.com', 'Seed: COO (self)')
ON CONFLICT (email) DO NOTHING;
