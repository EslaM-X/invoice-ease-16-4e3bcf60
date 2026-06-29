
-- Allow distributors to read active sales events (so they can attach an event to their invoice)
CREATE POLICY "distributors read active sales events"
  ON public.sales_events FOR SELECT
  USING (is_active = true AND EXISTS (SELECT 1 FROM public.distributors d WHERE d.user_id = auth.uid() AND d.is_active = true));

-- Enable realtime for distributor_payouts so balance cards update instantly
ALTER PUBLICATION supabase_realtime ADD TABLE public.distributor_payouts;
ALTER TABLE public.distributor_payouts REPLICA IDENTITY FULL;
