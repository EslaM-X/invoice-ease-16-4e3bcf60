
-- 1) Expand allowed statuses
ALTER TABLE public.delivery_receipts
  DROP CONSTRAINT IF EXISTS delivery_receipts_status_check;
ALTER TABLE public.delivery_receipts
  ADD CONSTRAINT delivery_receipts_status_check
  CHECK (status IN ('draft','out_for_delivery','signed','paid','returned','cancelled'));

-- 2) New columns
ALTER TABLE public.delivery_receipts
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- 3) RPC for status change (logged + notified)
CREATE OR REPLACE FUNCTION public.change_delivery_receipt_status(
  _receipt_id uuid,
  _new_status text,
  _reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_rec record;
  v_old text;
  v_label text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  IF _new_status NOT IN ('draft','out_for_delivery','signed','paid','returned','cancelled') THEN
    RAISE EXCEPTION 'INVALID_STATUS:%', _new_status USING ERRCODE='22023';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  SELECT * INTO v_rec FROM public.delivery_receipts
    WHERE id = _receipt_id AND public.can_access_user_data(user_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECEIPT_NOT_FOUND'; END IF;
  v_old := v_rec.status;
  IF v_old = _new_status THEN RETURN _receipt_id; END IF;

  UPDATE public.delivery_receipts
     SET status = _new_status,
         status_reason = NULLIF(_reason,''),
         archived_at = CASE WHEN _new_status IN ('paid','returned','cancelled') THEN now() ELSE NULL END,
         updated_at = now(),
         updated_by = v_uid,
         updated_by_email = v_email
   WHERE id = _receipt_id;

  v_label := CASE _new_status
    WHEN 'out_for_delivery' THEN '🚚 في الطريق'
    WHEN 'signed' THEN '✍️ مستلم وموقَّع'
    WHEN 'paid' THEN '✅ مغلق ومدفوع'
    WHEN 'returned' THEN '↩️ راجع'
    WHEN 'cancelled' THEN '✖️ ملغي'
    ELSE 'مسودة'
  END;

  INSERT INTO public.notifications (recipient_role, type, title, body, link, meta)
  VALUES ('manager', 'delivery_receipt_status',
    'محضر ' || v_rec.receipt_number || ' → ' || v_label,
    COALESCE(NULLIF(_reason,''),'') ,
    '/delivery-receipts/' || _receipt_id::text,
    jsonb_build_object('receipt_id', _receipt_id, 'from', v_old, 'to', _new_status, 'actor_email', v_email));

  RETURN _receipt_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_delivery_receipt_status(uuid, text, text) TO authenticated;

-- 4) Auto-archive: when invoice becomes fully paid → mark its signed receipts as 'paid'
CREATE OR REPLACE FUNCTION public.tg_auto_archive_signed_receipts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.paid_amount,0) >= COALESCE(NEW.total,0) AND COALESCE(NEW.total,0) > 0 THEN
    UPDATE public.delivery_receipts
       SET status = 'paid',
           archived_at = COALESCE(archived_at, now()),
           updated_at = now()
     WHERE invoice_id = NEW.id
       AND status = 'signed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_archive_signed_receipts ON public.invoices;
CREATE TRIGGER auto_archive_signed_receipts
AFTER UPDATE OF paid_amount, total ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_auto_archive_signed_receipts();

-- 5) Realtime publication
ALTER TABLE public.delivery_receipts REPLICA IDENTITY FULL;
ALTER TABLE public.delivery_receipt_audit_log REPLICA IDENTITY FULL;

DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_receipts;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_receipt_audit_log;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
