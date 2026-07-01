
-- ============================================================
-- PART 1: Fix reservations counter to honor legacy DRs
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_active_invoice_reservations()
RETURNS TABLE(invoice_item_id uuid, invoice_id uuid, invoice_number text, customer_name text, product_id uuid, product_name text, reserved_qty bigint, created_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH dr_lines AS (
    SELECT dri.id AS dri_id, dri.quantity AS qty, dri.invoice_item_id AS direct_item,
           dr.invoice_id AS invoice_id, dri.product_name, dri.color, dri.serial_number
    FROM public.delivery_receipt_items dri
    JOIN public.delivery_receipts dr ON dr.id = dri.receipt_id
    WHERE COALESCE(dr.status, '') <> 'cancelled'
  ),
  path_a AS (
    SELECT l.dri_id, l.direct_item AS invoice_item_id, l.qty
    FROM dr_lines l WHERE l.direct_item IS NOT NULL
  ),
  candidates AS (
    SELECT l.dri_id, l.qty, ii.id AS invoice_item_id, ii.quantity AS ii_qty,
           CASE
             WHEN l.serial_number IS NOT NULL AND p.serial_number IS NOT NULL
                  AND l.serial_number = p.serial_number THEN 3
             WHEN l.color IS NOT NULL AND p.color IS NOT NULL
                  AND lower(l.color) = lower(p.color) THEN 2
             ELSE 1
           END AS score
    FROM dr_lines l
    JOIN public.invoice_items ii ON ii.invoice_id = l.invoice_id AND ii.product_name = l.product_name
    JOIN public.products p ON p.id = ii.product_id
    WHERE l.direct_item IS NULL AND ii.product_id IS NOT NULL
  ),
  best AS (SELECT dri_id, MAX(score) AS top FROM candidates GROUP BY dri_id),
  filtered AS (SELECT c.* FROM candidates c JOIN best b ON b.dri_id=c.dri_id AND b.top=c.score),
  path_b AS (
    SELECT f.dri_id, f.invoice_item_id,
           (f.qty::numeric * (f.ii_qty::numeric / NULLIF(SUM(f.ii_qty) OVER (PARTITION BY f.dri_id), 0)))::bigint AS qty
    FROM filtered f
  ),
  delivered_per_item AS (
    SELECT invoice_item_id, SUM(qty)::bigint AS qty
    FROM (SELECT invoice_item_id, qty FROM path_a UNION ALL SELECT invoice_item_id, qty FROM path_b) u
    GROUP BY invoice_item_id
  )
  SELECT ii.id, i.id, i.invoice_number, i.customer_name, ii.product_id, ii.product_name,
         GREATEST(0, (ii.quantity - COALESCE(d.qty, 0)))::bigint AS reserved_qty,
         i.created_at
  FROM public.invoice_items ii
  JOIN public.invoices i ON i.id = ii.invoice_id
  LEFT JOIN delivered_per_item d ON d.invoice_item_id = ii.id
  WHERE ii.product_id IS NOT NULL
    AND COALESCE(i.status, '') NOT IN ('cancelled', 'voided', 'draft')
    AND COALESCE(i.delivery_status, '') <> 'delivered'
    AND (ii.quantity - COALESCE(d.qty, 0)) > 0
    AND public.can_access_user_data(i.user_id)
  ORDER BY i.created_at DESC;
$$;

-- Reserved-by-product uses same computation
CREATE OR REPLACE FUNCTION public.get_reserved_qty_by_product()
RETURNS TABLE(product_id uuid, reserved_qty bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT product_id, SUM(reserved_qty)::bigint
  FROM public.get_active_invoice_reservations()
  GROUP BY product_id;
$$;

-- Dashboard summary: list reserved invoices with numbers
CREATE OR REPLACE FUNCTION public.get_reserved_invoices_summary()
RETURNS TABLE(invoice_id uuid, invoice_number text, customer_name text, reserved_units bigint, reserved_lines bigint, created_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT invoice_id, invoice_number, customer_name,
         SUM(reserved_qty)::bigint AS reserved_units,
         COUNT(*)::bigint AS reserved_lines,
         MAX(created_at) AS created_at
  FROM public.get_active_invoice_reservations()
  GROUP BY invoice_id, invoice_number, customer_name
  ORDER BY MAX(created_at) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_reserved_invoices_summary() TO authenticated;

-- ============================================================
-- PART 2: Task Management System
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.task_status AS ENUM ('pending','in_progress','done','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.task_priority AS ENUM ('low','normal','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Task-manager identity (only k.elsharbatly)
CREATE OR REPLACE FUNCTION public.is_task_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND lower(email) = 'k.elsharbatly@steinheim-eg.com'
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_task_manager() TO authenticated;

CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  assignee_id uuid NOT NULL,
  assigned_by uuid NOT NULL,
  priority public.task_priority NOT NULL DEFAULT 'normal',
  status public.task_status NOT NULL DEFAULT 'pending',
  due_date timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON public.tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON public.tasks(assigned_by);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status, priority);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
CREATE POLICY "tasks_select" ON public.tasks FOR SELECT TO authenticated
USING (public.is_task_manager() OR assignee_id = auth.uid() OR assigned_by = auth.uid());

DROP POLICY IF EXISTS "tasks_insert_manager" ON public.tasks;
CREATE POLICY "tasks_insert_manager" ON public.tasks FOR INSERT TO authenticated
WITH CHECK (public.is_task_manager() AND assigned_by = auth.uid());

DROP POLICY IF EXISTS "tasks_update" ON public.tasks;
CREATE POLICY "tasks_update" ON public.tasks FOR UPDATE TO authenticated
USING (public.is_task_manager() OR assignee_id = auth.uid())
WITH CHECK (public.is_task_manager() OR assignee_id = auth.uid());

DROP POLICY IF EXISTS "tasks_delete_manager" ON public.tasks;
CREATE POLICY "tasks_delete_manager" ON public.tasks FOR DELETE TO authenticated
USING (public.is_task_manager());

-- Comments
CREATE TABLE IF NOT EXISTS public.task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON public.task_comments(task_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_comments TO authenticated;
GRANT ALL ON public.task_comments TO service_role;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_comments_select" ON public.task_comments;
CREATE POLICY "task_comments_select" ON public.task_comments FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id
       AND (public.is_task_manager() OR t.assignee_id = auth.uid() OR t.assigned_by = auth.uid())));

DROP POLICY IF EXISTS "task_comments_insert" ON public.task_comments;
CREATE POLICY "task_comments_insert" ON public.task_comments FOR INSERT TO authenticated
WITH CHECK (author_id = auth.uid() AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id
       AND (public.is_task_manager() OR t.assignee_id = auth.uid() OR t.assigned_by = auth.uid())));

DROP POLICY IF EXISTS "task_comments_delete_own" ON public.task_comments;
CREATE POLICY "task_comments_delete_own" ON public.task_comments FOR DELETE TO authenticated
USING (author_id = auth.uid() OR public.is_task_manager());

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tasks_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.status = 'in_progress' AND OLD.status <> 'in_progress' AND NEW.started_at IS NULL THEN
    NEW.started_at = now();
  END IF;
  IF NEW.status = 'done' AND OLD.status <> 'done' THEN
    NEW.completed_at = now();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_tasks_touch ON public.tasks;
CREATE TRIGGER trg_tasks_touch BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_touch_updated_at();

-- Notifications on assignment / status change
CREATE OR REPLACE FUNCTION public.tasks_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_prio text;
BEGIN
  v_prio := NEW.priority::text;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications(user_id, type, title, body, link, meta)
    VALUES (NEW.assignee_id, 'task_assigned',
      'مهمة جديدة: ' || NEW.title,
      COALESCE(NEW.description, ''),
      '/tasks?id=' || NEW.id::text,
      jsonb_build_object('task_id', NEW.id, 'priority', v_prio));
  ELSIF TG_OP = 'UPDATE' AND NEW.status <> OLD.status THEN
    IF NEW.status = 'done' THEN
      INSERT INTO public.notifications(user_id, type, title, body, link, meta)
      VALUES (NEW.assigned_by, 'task_completed',
        'تم إتمام مهمة: ' || NEW.title, NULL,
        '/tasks?id=' || NEW.id::text,
        jsonb_build_object('task_id', NEW.id));
    ELSIF NEW.status = 'in_progress' THEN
      INSERT INTO public.notifications(user_id, type, title, body, link, meta)
      VALUES (NEW.assigned_by, 'task_started',
        'بدء تنفيذ مهمة: ' || NEW.title, NULL,
        '/tasks?id=' || NEW.id::text,
        jsonb_build_object('task_id', NEW.id));
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_tasks_notify ON public.tasks;
CREATE TRIGGER trg_tasks_notify AFTER INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_notify();

CREATE OR REPLACE FUNCTION public.task_comments_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_task public.tasks;
  v_target uuid;
BEGIN
  SELECT * INTO v_task FROM public.tasks WHERE id = NEW.task_id;
  IF v_task IS NULL THEN RETURN NEW; END IF;
  -- Notify the other party
  IF NEW.author_id = v_task.assignee_id THEN
    v_target := v_task.assigned_by;
  ELSE
    v_target := v_task.assignee_id;
  END IF;
  IF v_target IS NOT NULL AND v_target <> NEW.author_id THEN
    INSERT INTO public.notifications(user_id, type, title, body, link, meta)
    VALUES (v_target, 'task_comment',
      'تعليق جديد على مهمة: ' || v_task.title,
      LEFT(NEW.body, 200),
      '/tasks?id=' || v_task.id::text,
      jsonb_build_object('task_id', v_task.id, 'comment_id', NEW.id));
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_task_comments_notify ON public.task_comments;
CREATE TRIGGER trg_task_comments_notify AFTER INSERT ON public.task_comments
FOR EACH ROW EXECUTE FUNCTION public.task_comments_notify();

-- Realtime
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
ALTER TABLE public.task_comments REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
