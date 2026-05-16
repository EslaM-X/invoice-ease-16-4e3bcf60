
-- =========================
-- price_list_items table
-- =========================
CREATE TABLE public.price_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_ar TEXT,
  collection TEXT NOT NULL CHECK (collection IN ('JOY','UP','ART','QUATRO')),
  category TEXT NOT NULL,
  color TEXT,
  color_hex TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'LE',
  image_url TEXT,
  qr_payload TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  updated_by_email TEXT
);

CREATE INDEX idx_price_list_items_collection ON public.price_list_items(collection);
CREATE INDEX idx_price_list_items_category ON public.price_list_items(category);
CREATE INDEX idx_price_list_items_active ON public.price_list_items(is_active);

ALTER TABLE public.price_list_items ENABLE ROW LEVEL SECURITY;

-- Public read (anyone, even anonymous)
CREATE POLICY "anyone can view active price list"
ON public.price_list_items
FOR SELECT
TO anon, authenticated
USING (is_active = true);

-- Admins full write
CREATE POLICY "admins insert price list"
ON public.price_list_items
FOR INSERT
TO authenticated
WITH CHECK (is_admin());

CREATE POLICY "admins update price list"
ON public.price_list_items
FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

CREATE POLICY "admins delete price list"
ON public.price_list_items
FOR DELETE
TO authenticated
USING (is_admin());

-- Trigger to bump updated_at
CREATE TRIGGER update_price_list_items_updated_at
BEFORE UPDATE ON public.price_list_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- price_list_price_history
-- =========================
CREATE TABLE public.price_list_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.price_list_items(id) ON DELETE CASCADE,
  old_price NUMERIC,
  new_price NUMERIC,
  changed_by UUID,
  changed_by_email TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_plph_item ON public.price_list_price_history(item_id, changed_at DESC);

ALTER TABLE public.price_list_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone view price history"
ON public.price_list_price_history
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "admins insert price history"
ON public.price_list_price_history
FOR INSERT
TO authenticated
WITH CHECK (is_admin());

-- Trigger: log price changes
CREATE OR REPLACE FUNCTION public.log_price_list_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.price IS DISTINCT FROM NEW.price) THEN
    INSERT INTO public.price_list_price_history(item_id, old_price, new_price, changed_by, changed_by_email)
    VALUES (NEW.id, OLD.price, NEW.price, auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_price_list_price_change
AFTER UPDATE ON public.price_list_items
FOR EACH ROW
EXECUTE FUNCTION public.log_price_list_price_change();

-- =========================
-- Storage bucket
-- =========================
INSERT INTO storage.buckets (id, name, public)
VALUES ('price-list-images', 'price-list-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "anyone read price list images"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'price-list-images');

CREATE POLICY "admins upload price list images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'price-list-images' AND is_admin());

CREATE POLICY "admins update price list images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'price-list-images' AND is_admin());

CREATE POLICY "admins delete price list images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'price-list-images' AND is_admin());

-- =========================
-- Realtime
-- =========================
ALTER PUBLICATION supabase_realtime ADD TABLE public.price_list_items;

-- =========================
-- Seed data — Steinheim 2026 catalog
-- qr_payload uses format: PL1:<id-without-hyphens-shortened>:<sku>
-- (computed at insert time via id)
-- =========================
INSERT INTO public.price_list_items (sku, name_en, name_ar, collection, category, color, color_hex, price, qr_payload, sort_order) VALUES
-- JOY BASIN MIXERS
('STM-60-M500-001','Single Lever Basin Mixer','خلاط حوض - مقبض واحد','JOY','Basin Mixer','CHROME PLATED','#C0C0C0',4950,'PL1:STM-60-M500-001',1),
('STM-60-M-500-004','Single Lever Basin Mixer','خلاط حوض - مقبض واحد','JOY','Basin Mixer','BRUSHED GOLD','#D4AF37',6000,'PL1:STM-60-M-500-004',2),
('STM-60-M500-002','Single Lever Basin Mixer','خلاط حوض - مقبض واحد','JOY','Basin Mixer','BRUSHED NICKEL','#A9A9A9',5350,'PL1:STM-60-M500-002',3),
('STM-60-M500-003','Single Lever Basin Mixer','خلاط حوض - مقبض واحد','JOY','Basin Mixer','MATTE BLACK','#1A1A1A',5350,'PL1:STM-60-M500-003',4),
('STM-60-M500-009','Single Lever Basin Mixer','خلاط حوض - مقبض واحد','JOY','Basin Mixer','COFFEE GOLD','#8B6F47',6300,'PL1:STM-60-M500-009',5),
('STM-60-M501-001','Single Lever Tall Basin Mixer','خلاط حوض طويل','JOY','Basin Mixer','CHROME PLATED','#C0C0C0',6550,'PL1:STM-60-M501-001',6),
('STM-60-M-501-004','Single Lever Tall Basin Mixer','خلاط حوض طويل','JOY','Basin Mixer','BRUSHED GOLD','#D4AF37',7450,'PL1:STM-60-M-501-004',7),
('STM-60-M501-002','Single Lever Tall Basin Mixer','خلاط حوض طويل','JOY','Basin Mixer','BRUSHED NICKEL','#A9A9A9',7050,'PL1:STM-60-M501-002',8),
('STM-60-M501-003','Single Lever Tall Basin Mixer','خلاط حوض طويل','JOY','Basin Mixer','MATTE BLACK','#1A1A1A',7050,'PL1:STM-60-M501-003',9),
('STM-60-M501-009','Single Lever Tall Basin Mixer','خلاط حوض طويل','JOY','Basin Mixer','COFFEE GOLD','#8B6F47',8300,'PL1:STM-60-M501-009',10),
('STM-60-M502-001','Wall Mounted Two-Hole Basin Mixer','خلاط حوض حائط فتحتين','JOY','Basin Mixer','CHROME PLATED','#C0C0C0',6600,'PL1:STM-60-M502-001',11),
('STM-60-M502-002','Wall Mounted Two-Hole Basin Mixer','خلاط حوض حائط فتحتين','JOY','Basin Mixer','BRUSHED NICKEL','#A9A9A9',7250,'PL1:STM-60-M502-002',12),

-- UP BASIN MIXERS
('STM-50-M500-001','Single Lever Basin Mixer','خلاط حوض - مقبض واحد','UP','Basin Mixer','CHROME PLATED','#C0C0C0',5500,'PL1:STM-50-M500-001',20),
('STM-50-M-500-004','Single Lever Basin Mixer','خلاط حوض - مقبض واحد','UP','Basin Mixer','BRUSHED GOLD','#D4AF37',6500,'PL1:STM-50-M-500-004',21),
('STM-50-M500-002','Single Lever Basin Mixer','خلاط حوض - مقبض واحد','UP','Basin Mixer','BRUSHED NICKEL','#A9A9A9',5950,'PL1:STM-50-M500-002',22),
('STM-50-M500-003','Single Lever Basin Mixer','خلاط حوض - مقبض واحد','UP','Basin Mixer','MATTE BLACK','#1A1A1A',5950,'PL1:STM-50-M500-003',23),
('STM-50-M500-005','Single Lever Basin Mixer','خلاط حوض - مقبض واحد','UP','Basin Mixer','METAL GUN','#5C5C5C',6500,'PL1:STM-50-M500-005',24),
('STM-50-M501-001','Single Lever Tall Basin Mixer','خلاط حوض طويل','UP','Basin Mixer','CHROME PLATED','#C0C0C0',8200,'PL1:STM-50-M501-001',25),
('STM-50-M-501-004','Single Lever Tall Basin Mixer','خلاط حوض طويل','UP','Basin Mixer','BRUSHED GOLD','#D4AF37',9900,'PL1:STM-50-M-501-004',26),
('STM-50-M501-002','Single Lever Tall Basin Mixer','خلاط حوض طويل','UP','Basin Mixer','BRUSHED NICKEL','#A9A9A9',8750,'PL1:STM-50-M501-002',27),
('STM-50-M501-003','Single Lever Tall Basin Mixer','خلاط حوض طويل','UP','Basin Mixer','MATTE BLACK','#1A1A1A',8750,'PL1:STM-50-M501-003',28),
('STM-50-M501-005','Single Lever Tall Basin Mixer','خلاط حوض طويل','UP','Basin Mixer','METAL GUN','#5C5C5C',9900,'PL1:STM-50-M501-005',29),
('STM-50-M502-004','Wall Mounted Two-Hole Basin Mixer','خلاط حوض حائط فتحتين','UP','Basin Mixer','BRUSHED GOLD','#D4AF37',7900,'PL1:STM-50-M502-004',30),
('STM-50-M502-005','Wall Mounted Two-Hole Basin Mixer','خلاط حوض حائط فتحتين','UP','Basin Mixer','METAL GUN','#5C5C5C',7900,'PL1:STM-50-M502-005',31),

-- QUATRO BASIN MIXERS
('STM-40-M500-001','Single Lever Basin Mixer','خلاط حوض - مقبض واحد','QUATRO','Basin Mixer','CHROME PLATED','#C0C0C0',5250,'PL1:STM-40-M500-001',40),
('STM-40-M503-004','Wall Mounted Two-Hole Basin Mixer','خلاط حوض حائط فتحتين','QUATRO','Basin Mixer','BRUSHED GOLD','#D4AF37',8300,'PL1:STM-40-M503-004',41),

-- ART BASIN MIXERS
('STM-70-M503-003','Wall Mounted Two-Hole Basin Mixer','خلاط حوض حائط فتحتين','ART','Basin Mixer','MATTE BLACK','#1A1A1A',9350,'PL1:STM-70-M503-003',50),

-- JOY SHOWER MIXERS
('STM-60-M611-009','Shower Column with Bath Mixer (30cm Round Head)','عمود دش مع خلاط بانيو','JOY','Shower','COFFEE GOLD','#8B6F47',17100,'PL1:STM-60-M611-009',60),

-- UP SHOWER MIXERS
('STM-50-M611-003','Shower Column with Bath Mixer','عمود دش مع خلاط بانيو','UP','Shower','MATTE BLACK','#1A1A1A',14450,'PL1:STM-50-M611-003',70),
('STM-50-M611-005','Shower Column with Bath Mixer','عمود دش مع خلاط بانيو','UP','Shower','METAL GUN','#5C5C5C',16750,'PL1:STM-50-M611-005',71),

-- QUATRO SHOWER MIXERS
('STM-40-M605-001','Concealed Bath/Shower Mixer (30cm Head)','دش مخفي مع خلاط بانيو','QUATRO','Shower','CHROME PLATED','#C0C0C0',11700,'PL1:STM-40-M605-001',80),

-- ART SHOWER MIXERS
('STM-70-M605-003','Concealed Bath/Shower Mixer (30cm Head)','دش مخفي مع خلاط بانيو','ART','Shower','MATTE BLACK','#1A1A1A',15300,'PL1:STM-70-M605-003',90),
('STM-70-M605-002','Concealed Bath/Shower Mixer (30cm Head)','دش مخفي مع خلاط بانيو','ART','Shower','BRUSHED','#B8B8B8',15300,'PL1:STM-70-M605-002',91),

-- UP BATH MIXERS
('STM-50-M620-004','Free Standing Bath Mixer','خلاط بانيو حر','UP','Bath Mixer','BRUSHED GOLD','#D4AF37',32400,'PL1:STM-50-M620-004',100),
('STM-50-M620-005','Free Standing Bath Mixer','خلاط بانيو حر','UP','Bath Mixer','METAL GUN','#5C5C5C',32400,'PL1:STM-50-M620-005',101),

-- ART BATH MIXERS
('STM-70-M620-001','Free Standing Bath Mixer','خلاط بانيو حر','ART','Bath Mixer','CHROME PLATED','#C0C0C0',37200,'PL1:STM-70-M620-001',110),
('STM-70-M620-003','Free Standing Bath Mixer','خلاط بانيو حر','ART','Bath Mixer','MATTE BLACK','#1A1A1A',39000,'PL1:STM-70-M620-003',111),

-- JOY ACCESSORIES
('STM-60-A900-001','4 Pieces Accessories Set (Stainless Steel)','طقم اكسسوارات 4 قطع','JOY','Accessories','POLISHED','#E5E5E5',4200,'PL1:STM-60-A900-001',120),
('STM-60-A900-002','4 Pieces Accessories Set (Stainless Steel)','طقم اكسسوارات 4 قطع','JOY','Accessories','BRUSHED','#B8B8B8',4200,'PL1:STM-60-A900-002',121),

-- UP ACCESSORIES
('STM-50-A900-004','4 Pieces Accessories Set (Stainless Steel)','طقم اكسسوارات 4 قطع','UP','Accessories','BRUSHED GOLD','#D4AF37',4700,'PL1:STM-50-A900-004',130),
('STM-50-A900-005','4 Pieces Accessories Set (Stainless Steel)','طقم اكسسوارات 4 قطع','UP','Accessories','METAL GUN','#5C5C5C',4700,'PL1:STM-50-A900-005',131),

-- JOY BIDET SPRAY
('STM-50-F800-001','Stainless Steel Bidet Spray with Angle Valve','شطاف ستانلس مع محبس زاوية','JOY','Bidet Spray','CHROME PLATED','#C0C0C0',3250,'PL1:STM-50-F800-001',140),

-- JOY ANGLE VALVE
('STM-60-ANG122-001','Angle Valve 1/2 x 1/2 Brass','محبس زاوية نحاس','JOY','Angle Valve','CHROME PLATED','#C0C0C0',650,'PL1:STM-60-ANG122-001',150),
('STM-60-ANG122-003','Angle Valve 1/2 x 1/2 Brass','محبس زاوية نحاس','JOY','Angle Valve','MATTE BLACK','#1A1A1A',800,'PL1:STM-60-ANG122-003',151);
