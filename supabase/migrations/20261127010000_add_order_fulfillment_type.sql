alter table public.orders
  add column if not exists fulfillment_type text not null default 'dine_in';

alter table public.orders
  add constraint orders_fulfillment_type_check
  check (fulfillment_type in ('dine_in', 'takeaway'));