-- Platforms enum
DO $$ BEGIN
  CREATE TYPE public.app_platform AS ENUM ('android','ios','windows','macos','web');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.app_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  platform public.app_platform NOT NULL,
  download_url text NOT NULL,
  release_notes text,
  is_mandatory boolean NOT NULL DEFAULT false,
  released_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, version)
);

CREATE INDEX IF NOT EXISTS idx_app_updates_platform_released
  ON public.app_updates (platform, released_at DESC);

ALTER TABLE public.app_updates ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can list available updates (so they can download)
CREATE POLICY "Authenticated users can view updates"
  ON public.app_updates FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can manage updates
CREATE POLICY "Admins can insert updates"
  ON public.app_updates FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update updates"
  ON public.app_updates FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete updates"
  ON public.app_updates FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- Updated_at trigger
DROP TRIGGER IF EXISTS trg_app_updates_updated_at ON public.app_updates;
CREATE TRIGGER trg_app_updates_updated_at
  BEFORE UPDATE ON public.app_updates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Notify all company members on new release
CREATE OR REPLACE FUNCTION public.notify_on_new_app_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_platform_label text;
BEGIN
  v_platform_label := CASE NEW.platform::text
    WHEN 'android' THEN '📱 أندرويد'
    WHEN 'ios'     THEN '🍎 آيفون'
    WHEN 'windows' THEN '🪟 ويندوز'
    WHEN 'macos'   THEN '💻 ماك'
    ELSE '🌐 ويب'
  END;

  PERFORM public.notify_company(
    'app_update_available',
    '🚀 تحديث جديد متاح — نسخة ' || NEW.version || ' (' || v_platform_label || ')',
    COALESCE(NEW.release_notes, 'في تحديث جديد للتطبيق متاح للتحميل دلوقتي.') ||
      CASE WHEN NEW.is_mandatory THEN E'\n\n⚠️ التحديث ده إجباري.' ELSE '' END,
    '/download',
    jsonb_build_object(
      'update_id', NEW.id,
      'version', NEW.version,
      'platform', NEW.platform,
      'download_url', NEW.download_url,
      'is_mandatory', NEW.is_mandatory
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_app_update ON public.app_updates;
CREATE TRIGGER trg_notify_app_update
  AFTER INSERT ON public.app_updates
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_new_app_update();

-- Audit columns
DROP TRIGGER IF EXISTS trg_app_updates_audit ON public.app_updates;
CREATE TRIGGER trg_app_updates_audit
  BEFORE INSERT OR UPDATE ON public.app_updates
  FOR EACH ROW EXECUTE FUNCTION public.set_audit_columns();