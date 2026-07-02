
-- Add role-based access replacing hardcoded email checks
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'task_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'po_deleter';
