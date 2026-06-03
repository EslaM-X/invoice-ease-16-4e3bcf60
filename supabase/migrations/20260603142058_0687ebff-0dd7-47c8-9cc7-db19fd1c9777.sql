
-- invoices-pdf: add write policies (company members only)
CREATE POLICY "invoices pdf company insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'invoices-pdf' AND is_company_member());

CREATE POLICY "invoices pdf company update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'invoices-pdf' AND is_company_member())
WITH CHECK (bucket_id = 'invoices-pdf' AND is_company_member());

CREATE POLICY "invoices pdf company delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'invoices-pdf' AND is_company_member());

-- whatsapp-media: add write policies (company members only)
CREATE POLICY "wa media company insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'whatsapp-media' AND is_company_member());

CREATE POLICY "wa media company update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'whatsapp-media' AND is_company_member())
WITH CHECK (bucket_id = 'whatsapp-media' AND is_company_member());

CREATE POLICY "wa media company delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'whatsapp-media' AND is_company_member());

-- zoho-images: add write policies (company members only); public read kept
CREATE POLICY "zoho images company insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'zoho-images' AND is_company_member());

CREATE POLICY "zoho images company update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'zoho-images' AND is_company_member())
WITH CHECK (bucket_id = 'zoho-images' AND is_company_member());

CREATE POLICY "zoho images company delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'zoho-images' AND is_company_member());

-- x_activity_log: restrict reads to company members
DROP POLICY IF EXISTS "auth users read activity" ON public.x_activity_log;
CREATE POLICY "company members read activity"
ON public.x_activity_log FOR SELECT TO authenticated
USING (is_company_member());
