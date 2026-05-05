
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.backups_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'success',
  storage_path text,
  size_bytes bigint default 0,
  tables_count int default 0,
  rows_count int default 0,
  error text,
  triggered_by text default 'cron'
);
alter table public.backups_log enable row level security;
drop policy if exists "admins read backups" on public.backups_log;
create policy "admins read backups" on public.backups_log
  for select to authenticated using (public.is_admin());
drop policy if exists "system insert backups" on public.backups_log;
create policy "system insert backups" on public.backups_log
  for insert to authenticated with check (true);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  recipient_role app_role,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  meta jsonb default '{}'::jsonb
);
create index if not exists idx_notifications_user on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_role on public.notifications(recipient_role, created_at desc);
alter table public.notifications enable row level security;

drop policy if exists "users see own + role notifications" on public.notifications;
create policy "users see own + role notifications" on public.notifications
  for select to authenticated
  using (
    user_id = auth.uid()
    or (recipient_role is not null and public.has_role(auth.uid(), recipient_role))
    or public.is_admin()
  );
drop policy if exists "company members create notifications" on public.notifications;
create policy "company members create notifications" on public.notifications
  for insert to authenticated with check (public.is_company_member());
drop policy if exists "users mark own notifications read" on public.notifications;
create policy "users mark own notifications read" on public.notifications
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create or replace function public.notify_on_invoice_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_role, type, title, body, link, meta)
  values ('manager', 'invoice_created',
    'فاتورة جديدة ' || NEW.invoice_number,
    coalesce(NEW.customer_name,'عميل نقدي') || ' · ' || NEW.total::text,
    '/invoices/' || NEW.id::text,
    jsonb_build_object('invoice_id', NEW.id, 'total', NEW.total));
  return NEW;
end $$;
drop trigger if exists trg_notify_invoice on public.invoices;
create trigger trg_notify_invoice after insert on public.invoices
  for each row execute function public.notify_on_invoice_created();

create or replace function public.notify_on_call_logged()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_role, type, title, body, meta)
  values ('manager', 'call_logged',
    'مكالمة ' || case when NEW.call_type='incoming' then 'واردة' else 'صادرة' end,
    coalesce(NEW.customer_name, NEW.customer_phone, 'غير معروف'),
    jsonb_build_object('call_log_id', NEW.id));
  return NEW;
end $$;
drop trigger if exists trg_notify_call on public.call_logs;
create trigger trg_notify_call after insert on public.call_logs
  for each row execute function public.notify_on_call_logged();

create or replace function public.notify_on_low_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.stock_quantity <= NEW.low_stock_threshold
     and (OLD.stock_quantity is null or OLD.stock_quantity > NEW.low_stock_threshold) then
    insert into public.notifications (recipient_role, type, title, body, link, meta)
    values ('manager', 'low_stock',
      'مخزون منخفض: ' || NEW.name,
      'الكمية ' || NEW.stock_quantity::text || ' / حد التنبيه ' || NEW.low_stock_threshold::text,
      '/inventory',
      jsonb_build_object('product_id', NEW.id));
  end if;
  return NEW;
end $$;
drop trigger if exists trg_notify_low_stock on public.products;
create trigger trg_notify_low_stock after update of stock_quantity on public.products
  for each row execute function public.notify_on_low_stock();

-- Realtime: only add tables not already in publication
do $$
begin
  begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.customer_ratings; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.invoices; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.products; exception when duplicate_object then null; end;
end $$;

insert into storage.buckets (id, name, public) values ('backups', 'backups', false)
  on conflict (id) do nothing;

drop policy if exists "admins read backups bucket" on storage.objects;
create policy "admins read backups bucket" on storage.objects
  for select to authenticated using (bucket_id = 'backups' and public.is_admin());
drop policy if exists "admins write backups bucket" on storage.objects;
create policy "admins write backups bucket" on storage.objects
  for insert to authenticated with check (bucket_id = 'backups' and public.is_admin());
