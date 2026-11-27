-- Existing orders predate payment tracking and are treated as settled.
alter table public.orders
  add column if not exists payment_status text not null default 'paid'
  check (payment_status in ('pending', 'paid'));

-- New checkouts explicitly create pending payments in the kitchen-pin function.
alter table public.orders alter column payment_status set default 'pending';
