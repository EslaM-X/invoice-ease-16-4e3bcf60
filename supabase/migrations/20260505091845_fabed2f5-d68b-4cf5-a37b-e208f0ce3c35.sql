-- ============ Call Logs ============
CREATE TABLE public.call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text,
  customer_phone text,
  call_type text NOT NULL DEFAULT 'incoming' CHECK (call_type IN ('incoming','outgoing')),
  duration_seconds int DEFAULT 0,
  outcome text CHECK (outcome IN ('resolved','follow_up','no_answer','complaint','sale','other')),
  summary text,
  notes text,
  agent_id uuid NOT NULL,
  agent_email text,
  called_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

-- ============ Customer Ratings ============
CREATE TABLE public.customer_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text,
  call_log_id uuid REFERENCES public.call_logs(id) ON DELETE SET NULL,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  rated_by uuid NOT NULL,
  rated_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customer_ratings ENABLE ROW LEVEL SECURITY;

-- ============ Service Reviews (internal QA) ============
CREATE TABLE public.service_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_log_id uuid REFERENCES public.call_logs(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL,
  reviewer_email text,
  quality_score int CHECK (quality_score BETWEEN 1 AND 10),
  feedback text,
  flags text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.service_reviews ENABLE ROW LEVEL SECURITY;

-- ============ Helper: can use call center ============
CREATE OR REPLACE FUNCTION public.can_access_call_center()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin','manager','call_center')
  )
$$;

-- ============ RLS: call_logs ============
CREATE POLICY "call center select" ON public.call_logs
  FOR SELECT TO authenticated USING (public.can_access_call_center());
CREATE POLICY "call center insert" ON public.call_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_call_center() AND auth.uid() = agent_id);
CREATE POLICY "call center update" ON public.call_logs
  FOR UPDATE TO authenticated
  USING (public.can_access_call_center() AND (auth.uid() = agent_id OR public.is_admin()));
CREATE POLICY "call center delete" ON public.call_logs
  FOR DELETE TO authenticated USING (public.is_admin());

-- ============ RLS: customer_ratings ============
CREATE POLICY "ratings select" ON public.customer_ratings
  FOR SELECT TO authenticated USING (public.can_access_call_center());
CREATE POLICY "ratings insert" ON public.customer_ratings
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_call_center() AND auth.uid() = rated_by);
CREATE POLICY "ratings delete" ON public.customer_ratings
  FOR DELETE TO authenticated USING (public.is_admin());

-- ============ RLS: service_reviews (admin/manager only) ============
CREATE POLICY "reviews select" ON public.service_reviews
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.has_role(auth.uid(), 'manager'));
CREATE POLICY "reviews insert" ON public.service_reviews
  FOR INSERT TO authenticated
  WITH CHECK ((public.is_admin() OR public.has_role(auth.uid(), 'manager')) AND auth.uid() = reviewer_id);

-- ============ updated_at triggers ============
CREATE TRIGGER trg_call_logs_updated_at BEFORE UPDATE ON public.call_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Indexes ============
CREATE INDEX idx_call_logs_customer ON public.call_logs(customer_id);
CREATE INDEX idx_call_logs_agent ON public.call_logs(agent_id);
CREATE INDEX idx_call_logs_called_at ON public.call_logs(called_at DESC);
CREATE INDEX idx_ratings_customer ON public.customer_ratings(customer_id);
CREATE INDEX idx_reviews_call ON public.service_reviews(call_log_id);

-- ============ Realtime ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_ratings;