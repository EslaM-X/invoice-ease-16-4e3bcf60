
create or replace function public.get_public_price_list()
returns table (
  id uuid,
  name text,
  serial_number text,
  color text,
  collection text,
  price numeric,
  stock_quantity integer,
  low_stock_threshold integer,
  image_url text,
  qr_code text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.serial_number, p.color, p.collection,
         p.price, p.stock_quantity, p.low_stock_threshold,
         p.image_url, p.qr_code, p.updated_at
  from public.products p
  order by p.collection nulls last, p.name, p.color
  limit 2000
$$;

grant execute on function public.get_public_price_list() to anon, authenticated;
