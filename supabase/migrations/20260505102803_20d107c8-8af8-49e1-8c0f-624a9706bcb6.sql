ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme_preference text,
  ADD COLUMN IF NOT EXISTS accent_preference text;