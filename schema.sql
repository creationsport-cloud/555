-- Run once in Supabase SQL Editor for the restaurant ordering app.
create table if not exists public.orders (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new','accepted','preparing','ready')),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  total numeric(10,2) not null check (total >= 0)
);

alter table public.orders enable row level security;
grant select, update, delete on public.orders to authenticated;
revoke all on public.orders from anon;

create policy "staff can read orders" on public.orders
  for select to authenticated using (true);
create policy "staff can update orders" on public.orders
  for update to authenticated using (true) with check (true);
create policy "staff can clear completed orders" on public.orders
  for delete to authenticated using (true);

create or replace function public.place_order(p_items jsonb, p_total numeric)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare new_id bigint;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Order must contain at least one item';
  end if;
  if p_total < 0 then raise exception 'Invalid order total'; end if;
  insert into public.orders (items, total) values (p_items, p_total) returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.place_order(jsonb, numeric) from public;
grant execute on function public.place_order(jsonb, numeric) to anon, authenticated;

alter publication supabase_realtime add table public.orders;

