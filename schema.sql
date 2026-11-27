-- Online restaurant ordering: customers can submit; only allow-listed staff can read/manage orders.
create schema if not exists private;

create table public.menu_items (
  id text primary key,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 240),
  price numeric(10,2) not null check (price > 0 and price <= 100000),
  category text not null check (char_length(category) between 1 and 40),
  icon text not null default '🍽️',
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.menu_items enable row level security;
revoke all on public.menu_items from public, anon, authenticated;
create policy "menu items accessible only through kitchen api"
  on public.menu_items for all to anon, authenticated using (false) with check (false);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('menu-photos','menu-photos',true,2097152,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table public.orders (
  id uuid primary key,
  order_number text not null,
  order_date date not null,
  created_at timestamptz not null default now(),
  constraint orders_order_date_order_number_key unique (order_date, order_number),
  status text not null default 'new' check (status in ('new','accepted','preparing','ready')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid')),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  total numeric(10,2) not null check (total >= 0)
);

create index orders_created_at_idx on public.orders (created_at desc);
create index orders_ready_created_at_idx on public.orders (created_at desc) where status = 'ready';

create table private.order_daily_counters (
  order_date date primary key,
  last_number bigint not null check (last_number > 0)
);
alter table private.order_daily_counters enable row level security;
revoke all on private.order_daily_counters from public, anon, authenticated;
create policy "clients cannot access order counters" on private.order_daily_counters for all to anon, authenticated using (false) with check (false);

create or replace function private.assign_daily_order_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $
declare
  business_date date;
  daily_number bigint;
begin
  business_date := (new.created_at at time zone 'Asia/Bangkok')::date;
  insert into private.order_daily_counters (order_date, last_number)
  values (business_date, 1)
  on conflict (order_date) do update
    set last_number = private.order_daily_counters.last_number + 1
  returning last_number into daily_number;
  new.order_date := business_date;
  new.order_number := case when daily_number < 10000
    then pg_catalog.lpad(daily_number::text, 4, '0')
    else daily_number::text
  end;
  return new;
end;
$;
revoke all on function private.assign_daily_order_number() from public, anon, authenticated;
create trigger orders_assign_daily_order_number
before insert on public.orders
for each row execute function private.assign_daily_order_number();

create table private.staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.orders enable row level security;
alter table private.staff_members enable row level security;

revoke all on public.orders from public, anon, authenticated;
revoke all on private.staff_members from public, anon, authenticated;
grant insert (id, items, total) on public.orders to anon;
grant select, update, delete on public.orders to authenticated;
grant usage on schema private to authenticated;
grant select on private.staff_members to authenticated;

create policy "customers can submit new orders" on public.orders
  for insert to anon
  with check (status = 'new' and jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0 and total >= 0);

create policy "staff can read their membership" on private.staff_members
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "staff can read orders" on public.orders
  for select to authenticated
  using (exists (select 1 from private.staff_members where user_id = (select auth.uid())));

create policy "staff can update orders" on public.orders
  for update to authenticated
  using (exists (select 1 from private.staff_members where user_id = (select auth.uid())))
  with check (exists (select 1 from private.staff_members where user_id = (select auth.uid())));

create policy "staff can clear completed orders" on public.orders
  for delete to authenticated
  using (exists (select 1 from private.staff_members where user_id = (select auth.uid())));

alter publication supabase_realtime add table public.orders;

