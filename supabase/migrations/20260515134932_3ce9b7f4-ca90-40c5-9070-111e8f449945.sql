
-- Helper: insert one notification per company member with optional role filter
CREATE OR REPLACE FUNCTION public.notify_company(
  p_type TEXT,
  p_title TEXT,
  p_body TEXT,
  p_link TEXT,
  p_meta JSONB,
  p_only_roles app_role[] DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_only_roles IS NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, meta)
    SELECT cm.user_id, p_type, p_title, p_body, p_link, COALESCE(p_meta, '{}'::jsonb)
    FROM public.company_members cm;
  ELSE
    INSERT INTO public.notifications (user_id, type, title, body, link, meta)
    SELECT DISTINCT ur.user_id, p_type, p_title, p_body, p_link, COALESCE(p_meta, '{}'::jsonb)
    FROM public.user_roles ur
    WHERE ur.role = ANY (p_only_roles);
  END IF;
END;
$$;

-- ───── Purchase Order shipment status changes ─────
CREATE OR REPLACE FUNCTION public.notify_po_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_type TEXT;
  v_title TEXT;
  v_body TEXT;
  v_link TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_link := '/purchase-orders/' || NEW.id;

  IF NEW.status IN ('shipped','in_transit') THEN
    v_type := 'shipment_in_transit';
    v_title := '🚚 شحنة في الطريق — ' || NEW.po_number;
    v_body := COALESCE('المورد: ' || NEW.supplier_name || E'\n', '') ||
              'الكمية: ' || NEW.total_qty ||
              CASE WHEN NEW.expected_arrival_at IS NOT NULL
                   THEN E'\nالوصول المتوقع: ' || to_char(NEW.expected_arrival_at, 'YYYY-MM-DD')
                   ELSE '' END;
  ELSIF NEW.status IN ('received','arrived') THEN
    v_type := 'shipment_arrived';
    v_title := '📦 وصلت الشحنة — ' || NEW.po_number;
    v_body := COALESCE('المورد: ' || NEW.supplier_name || E'\n', '') ||
              'الكمية: ' || NEW.total_qty;
  ELSIF NEW.status = 'delayed' THEN
    v_type := 'shipment_delayed';
    v_title := '⏳ تأخير في الشحنة — ' || NEW.po_number;
    v_body := COALESCE('المورد: ' || NEW.supplier_name, '');
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.notify_company(v_type, v_title, v_body, v_link,
    jsonb_build_object(
      'po_id', NEW.id, 'po_number', NEW.po_number,
      'supplier', NEW.supplier_name, 'qty', NEW.total_qty,
      'status', NEW.status, 'expected_at', NEW.expected_arrival_at
    ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_po_status_notify ON public.purchase_orders;
CREATE TRIGGER trg_po_status_notify
AFTER INSERT OR UPDATE OF status ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.notify_po_status_change();

-- ───── Low stock notifications ─────
CREATE OR REPLACE FUNCTION public.notify_low_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_was_above BOOLEAN;
BEGIN
  IF NEW.stock_quantity IS NULL OR NEW.low_stock_threshold IS NULL THEN
    RETURN NEW;
  END IF;
  -- Only fire when crossing the threshold downward
  v_was_above := (TG_OP = 'INSERT') OR (OLD.stock_quantity > OLD.low_stock_threshold);
  IF NEW.stock_quantity <= NEW.low_stock_threshold AND v_was_above THEN
    PERFORM public.notify_company(
      'low_stock',
      '⚠️ مخزون منخفض — ' || NEW.name,
      COALESCE('اللون: ' || NEW.color || E'\n', '') ||
      'المتاح: ' || NEW.stock_quantity || ' / الحد الأدنى: ' || NEW.low_stock_threshold,
      '/products/' || NEW.id,
      jsonb_build_object(
        'product_id', NEW.id, 'name', NEW.name, 'color', NEW.color,
        'stock', NEW.stock_quantity, 'threshold', NEW.low_stock_threshold
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_low_stock_notify ON public.products;
CREATE TRIGGER trg_low_stock_notify
AFTER INSERT OR UPDATE OF stock_quantity, low_stock_threshold ON public.products
FOR EACH ROW EXECUTE FUNCTION public.notify_low_stock();

-- ───── Invoice created + paid ─────
CREATE OR REPLACE FUNCTION public.notify_invoice_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.notify_company(
      'invoice_created',
      '🧾 فاتورة جديدة — ' || NEW.invoice_number,
      COALESCE('العميل: ' || NEW.customer_name || E'\n', '') ||
      'الإجمالي: ' || to_char(NEW.total, 'FM999,999,990.00') || ' ج.م',
      '/invoices/' || NEW.id,
      jsonb_build_object(
        'invoice_id', NEW.id, 'number', NEW.invoice_number,
        'customer', NEW.customer_name, 'total', NEW.total
      )
    );
    RETURN NEW;
  END IF;

  -- payment received
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.paid_amount, 0) > COALESCE(OLD.paid_amount, 0) THEN
    PERFORM public.notify_company(
      'payment_received',
      '💰 دفعة جديدة — ' || NEW.invoice_number,
      COALESCE('العميل: ' || NEW.customer_name || E'\n', '') ||
      'المدفوع: ' || to_char(NEW.paid_amount, 'FM999,999,990.00') || ' / ' ||
      to_char(NEW.total, 'FM999,999,990.00') || ' ج.م',
      '/invoices/' || NEW.id,
      jsonb_build_object(
        'invoice_id', NEW.id, 'number', NEW.invoice_number,
        'paid', NEW.paid_amount, 'total', NEW.total
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_notify ON public.invoices;
CREATE TRIGGER trg_invoice_notify
AFTER INSERT OR UPDATE OF paid_amount ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.notify_invoice_event();

-- Lock down helper
REVOKE EXECUTE ON FUNCTION public.notify_company(TEXT,TEXT,TEXT,TEXT,JSONB,app_role[]) FROM PUBLIC, anon, authenticated;
