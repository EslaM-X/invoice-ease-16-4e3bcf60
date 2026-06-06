
DROP POLICY IF EXISTS "anyone view price history" ON public.price_list_price_history;

CREATE POLICY "authenticated view price history"
ON public.price_list_price_history
FOR SELECT
TO authenticated
USING (true);

REVOKE SELECT ON public.price_list_price_history FROM anon;
