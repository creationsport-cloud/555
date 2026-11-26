-- Online restaurant ordering: customers can submit; only allow-listed staff can read/manage orders.
create schema if not exists private;

create table public.orders (
  id uuid primary key,
  order_number text not null unique,
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new','accepted','preparing','ready')),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  total numeric(10,2) not null check (total >= 0)
);

create index orders_created_at_idx on public.orders (created_at desc);
create index orders_ready_created_at_idx on public.orders (created_at desc) where status = 'ready';

create table private.staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.orders enable row level security;
alter table private.staff_members enable row level security;

revoke all on public.orders from public, anon, authenticated;
revoke all on private.staff_members from public, anon, authenticated;
grant insert (id, order_number, items, total) on public.orders to anon;
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

