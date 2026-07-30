CREATE OR REPLACE FUNCTION public.sync_invoice_archive_from_delivery_receipt(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_state text;
BEGIN
  IF _invoice_id IS NULL THEN
    RETURN;
  END IF;

  v_state := public.compute_invoice_delivery_state_v2(_invoice_id);

  UPDATE public.invoices i
     SET delivery_computed_state = v_state,
         delivery_status = CASE WHEN v_state = 'complete' THEN 'delivered' ELSE COALESCE(i.delivery_status, 'pending') END,
         archive_ready = (
           COALESCE(i.status, '') NOT IN ('draft','voided','void','cancelled','canceled')
           AND COALESCE(i.total, 0) > 0
           AND v_state = 'complete'
           AND (
             COALESCE(i.paid_amount, 0) >= COALESCE(i.total, 0) - 0.001
             OR EXISTS (
               SELECT 1
               FROM public.delivery_receipts dr
               WHERE dr.invoice_id = i.id
                 AND dr.status IN ('signed','paid')
                 AND dr.archived_at IS NOT NULL
             )
           )
         ),
         updated_at = now()
   WHERE i.id = _invoice_id
     AND COALESCE(i.status, '') NOT IN ('draft','voided','void','cancelled','canceled');
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_sync_invoice_archive_from_delivery_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_invoice_archive_from_delivery_receipt(OLD.invoice_id);
    RETURN OLD;
  END IF;

  PERFORM public.sync_invoice_archive_from_delivery_receipt(NEW.invoice_id);

  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM public.sync_invoice_archive_from_delivery_receipt(OLD.invoice_id);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_invoice_archive_from_delivery_receipt ON public.delivery_receipts;
CREATE TRIGGER trg_sync_invoice_archive_from_delivery_receipt
AFTER INSERT OR UPDATE OF status, archived_at, invoice_id OR DELETE ON public.delivery_receipts
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_invoice_archive_from_delivery_receipt();

DROP TRIGGER IF EXISTS trg_sync_invoice_archive_from_delivery_receipt_items ON public.delivery_receipt_items;
CREATE TRIGGER trg_sync_invoice_archive_from_delivery_receipt_items
AFTER INSERT OR UPDATE OR DELETE ON public.delivery_receipt_items
FOR EACH ROW EXECUTE FUNCTION public.tg_dri_recompute_state_v2();

SELECT public.sync_invoice_archive_from_delivery_receipt(id)
FROM public.invoices
WHERE invoice_number = 'INV-2026-00169';

GRANT EXECUTE ON FUNCTION public.sync_invoice_archive_from_delivery_receipt(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_invoice_archive_from_delivery_receipt(uuid) TO service_role;