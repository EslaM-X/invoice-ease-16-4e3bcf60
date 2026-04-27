CREATE OR REPLACE FUNCTION public.adjust_stock(_product_id uuid, _change integer, _reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_email text;
  v_product record;
  v_log_id uuid;
  v_new_qty integer;
  v_clean_reason text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF _change = 0 THEN RAISE EXCEPTION 'INVALID_CHANGE' USING ERRCODE = '22023'; END IF;
  v_clean_reason := btrim(COALESCE(_reason, ''));
  IF length(v_clean_reason) < 3 THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023'; END IF;
  IF length(v_clean_reason) > 500 THEN v_clean_reason := substring(v_clean_reason from 1 for 500); END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_product FROM public.products
  WHERE id = _product_id AND public.can_access_user_data(user_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = '22023'; END IF;

  v_new_qty := v_product.stock_quantity + _change;
  IF v_new_qty < 0 THEN RAISE EXCEPTION 'WOULD_GO_NEGATIVE:%', v_product.stock_quantity USING ERRCODE = '22023'; END IF;

  UPDATE public.products SET stock_quantity = v_new_qty, updated_at = now(),
    updated_by = v_user_id, updated_by_email = v_actor_email
  WHERE id = _product_id;

  INSERT INTO public.inventory_logs (user_id, product_id, change, reason, invoice_id, actor_id, actor_email)
  VALUES (v_product.user_id, _product_id, _change, 'manual: ' || v_clean_reason, NULL, v_user_id, v_actor_email)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid, integer, text) TO authenticated;