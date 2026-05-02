-- =========================================
-- Zoho Books integration tables
-- =========================================

-- 1. Mirror table for Zoho items
CREATE TABLE public.zoho_items (
  item_id text PRIMARY KEY,
  name text NOT NULL,
  sku text,
  description text,
  unit text,
  status text NOT NULL DEFAULT 'active',
  rate_aed numeric NOT NULL DEFAULT 0,
  rate_egp numeric NOT NULL DEFAULT 0,
  stock_on_hand numeric NOT NULL DEFAULT 0,
  available_stock numeric NOT NULL DEFAULT 0,
  image_url text,
  image_document_id text,
  color text,
  serial_number text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  hash text,
  deleted_from_zoho boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_zoho_items_sku ON public.zoho_items(sku);
CREATE INDEX idx_zoho_items_status ON public.zoho_items(status);
CREATE INDEX idx_zoho_items_deleted ON public.zoho_items(deleted_from_zoho);

ALTER TABLE public.zoho_items ENABLE ROW LEVEL SECURITY;

-- Read-only for company members; writes go through service role only.
CREATE POLICY "company members read zoho items"
  ON public.zoho_items FOR SELECT
  TO authenticated
  USING (public.is_company_member());

-- 2. Settings (one row, AED -> EGP exchange rate)
CREATE TABLE public.zoho_settings (
  id text PRIMARY KEY DEFAULT 'default',
  aed_to_egp_rate numeric NOT NULL DEFAULT 13.25,
  updated_by uuid,
  updated_by_email text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.zoho_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members read zoho settings"
  ON public.zoho_settings FOR SELECT
  TO authenticated
  USING (public.is_company_member());

CREATE POLICY "company members update zoho settings"
  ON public.zoho_settings FOR UPDATE
  TO authenticated
  USING (public.is_company_member());

CREATE POLICY "company members insert zoho settings"
  ON public.zoho_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.is_company_member());

-- Seed default settings row
INSERT INTO public.zoho_settings (id, aed_to_egp_rate)
VALUES ('default', 13.25)
ON CONFLICT (id) DO NOTHING;

-- 3. Sync state tracking
CREATE TABLE public.zoho_sync_state (
  id text PRIMARY KEY DEFAULT 'default',
  last_run_at timestamptz,
  last_success_at timestamptz,
  is_running boolean NOT NULL DEFAULT false,
  items_synced integer NOT NULL DEFAULT 0,
  items_added integer NOT NULL DEFAULT 0,
  items_updated integer NOT NULL DEFAULT 0,
  items_marked_deleted integer NOT NULL DEFAULT 0,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.zoho_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members read zoho sync state"
  ON public.zoho_sync_state FOR SELECT
  TO authenticated
  USING (public.is_company_member());

INSERT INTO public.zoho_sync_state (id) VALUES ('default')
ON CONFLICT (id) DO NOTHING;

-- 4. Updated_at triggers
CREATE TRIGGER update_zoho_items_updated_at
  BEFORE UPDATE ON public.zoho_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_zoho_settings_updated_at
  BEFORE UPDATE ON public.zoho_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_zoho_sync_state_updated_at
  BEFORE UPDATE ON public.zoho_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.zoho_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.zoho_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.zoho_sync_state;
ALTER TABLE public.zoho_items REPLICA IDENTITY FULL;
ALTER TABLE public.zoho_settings REPLICA IDENTITY FULL;
ALTER TABLE public.zoho_sync_state REPLICA IDENTITY FULL;

-- 6. Storage bucket for Zoho images (public read)
INSERT INTO storage.buckets (id, name, public)
VALUES ('zoho-images', 'zoho-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read zoho images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'zoho-images');

-- 7. Required extensions for cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;