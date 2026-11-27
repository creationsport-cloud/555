alter table public.orders
  add column if not exists note text not null default '';

alter table public.orders
  add constraint orders_note_length_check
  check (char_length(note) <= 500);

