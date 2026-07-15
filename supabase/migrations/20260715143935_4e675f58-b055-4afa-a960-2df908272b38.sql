
CREATE TABLE IF NOT EXISTS public.collections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  color_hex TEXT NOT NULL DEFAULT '#8B5CF6',
  sort_order INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_email TEXT
);

GRANT SELECT ON public.collections TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.collections TO authenticated;
GRANT ALL ON public.collections TO service_role;

ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collections_read_authenticated"
  ON public.collections FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "collections_admin_insert"
  ON public.collections FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "collections_admin_update"
  ON public.collections FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "collections_admin_delete"
  ON public.collections FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.collections_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_collections_touch
BEFORE UPDATE ON public.collections
FOR EACH ROW EXECUTE FUNCTION public.collections_touch_updated_at();

INSERT INTO public.collections (code, label, color_hex, sort_order) VALUES
  ('JOY', 'JOY', '#F43F5E', 10),
  ('UP', 'UP', '#0EA5E9', 20),
  ('ART', 'ART', '#8B5CF6', 30),
  ('QUATRO', 'QUATRO', '#F59E0B', 40)
ON CONFLICT (code) DO NOTHING;
